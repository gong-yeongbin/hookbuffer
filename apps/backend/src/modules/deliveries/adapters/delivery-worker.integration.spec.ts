import { createHmac, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CipherService } from '@/infra/cipher/cipher.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { ValkeyService } from '@/infra/valkey/valkey.service';
import { QueuedHeldDeliveries } from '@/modules/connections/adapters/queued-held-deliveries';
import { newSlug } from '@/modules/sources/domain/slug';
import { DeliveryRunner, MAX_DELIVERIES } from '../delivery.runner';
import { DeliveryWorker } from '../delivery.worker';
import type { DeliveryRepository } from '../ports/delivery.repository';
import { NodeDestinationClient } from './node-destination.client';
import { PrismaDeliveryRepository } from './prisma-delivery.repository';
import { ValkeyDeliveryQueue } from './valkey-delivery.queue';
import { ValkeyDestinationGuard, guardKeys } from './valkey-destination.guard';

type Received = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

// 실제 Postgres·Valkey와 가짜 목적지 서버를 붙여 큐 → 워커 → 목적지 → 기록까지 본다
// (`pnpm docker:up && pnpm db:deploy` 선행). 다른 테스트와 섞이지 않게 큐 키를 따로 쓴다
describe('전달 워커 (통합)', () => {
	const config = new ConfigService({
		DATABASE_URL: process.env.DATABASE_URL,
		ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
		REDIS_URL: process.env.REDIS_URL,
		ALLOW_PRIVATE_DESTINATIONS: 'true',
	});
	const prisma = new PrismaService(config);
	const cipher = new CipherService(config);
	const valkey = new ValkeyService(config);
	const run = randomUUID();
	const keys = { stream: `test:delivery:${run}`, group: 'workers', scheduled: `test:delivery:scheduled:${run}` };
	const queue = new ValkeyDeliveryQueue(valkey, keys);
	const deliveries = new PrismaDeliveryRepository(prisma, cipher);
	const guard = new ValkeyDestinationGuard(valkey);
	const worker = new DeliveryWorker(deliveries, new NodeDestinationClient(config), queue, guard, 'https://app.hookbuffer.io');
	const runner = new DeliveryRunner(worker, queue, deliveries);
	// sweeper는 DB 전체에서 오래된 것을 찾는다. 같은 DB의 다른 데이터(개발용, 다른 테스트)가 이 테스트의 큐로
	// 들어오지 않게, 이 테스트가 만든 delivery만 다시 넣는 runner를 따로 둔다
	const mine = new Set<bigint>();
	const scopedRepository: DeliveryRepository = {
		load: (id) => deliveries.load(id),
		recordAttempt: (...args) => deliveries.recordAttempt(...args),
		close: (...args) => deliveries.close(...args),
		defer: (...args) => deliveries.defer(...args),
		findStale: async (...args) => (await deliveries.findStale(...args)).filter((id) => mine.has(id)),
	};
	const sweeping = new DeliveryRunner(worker, queue, scopedRepository);
	const held = new QueuedHeldDeliveries(prisma, queue);
	const SECRET = 'rdsec_integration';
	const BODY = Buffer.from('{ "order": 1,\n  "note": "받은 그대로" }');
	const FAR = () => new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

	let server: http.Server;
	let base: string;
	let received: Received[];
	let respond: (request: IncomingMessage, response: ServerResponse) => void;
	let orgId: number;
	let projectId: number;
	let sourceId: number;

	// 이 테스트가 만든 목적지. 끝나면 Valkey의 보호 상태 키를 지운다
	const destinations = new Set<number>();

	// 목적지와 연결을 하나씩 만들고, 그 연결로 가는 pending delivery가 달린 event를 만든다
	async function setup(options: { retry?: { retry_strategy?: 'linear' | 'exponential'; retry_interval_ms?: number; retry_count?: number }; event?: object; headers?: object; concurrency?: number } = {}) {
		const source = await prisma.source.create({ data: { project_id: projectId, slug: newSlug(), name: '토스 결제' } });
		const destination = await prisma.destination.create({
			data: { project_id: projectId, name: 'orders', url: `${base}/webhooks`, timeout_ms: 2000, concurrency: options.concurrency, headers_enc: cipher.encrypt(JSON.stringify(options.headers ?? { Authorization: 'Bearer destination-token' })) },
		});
		destinations.add(destination.id);
		const connection = await prisma.connection.create({ data: { source_id: source.id, destination_id: destination.id, retry_strategy: 'linear', retry_interval_ms: 1000, retry_count: 2, ...options.retry } });
		const event = await prisma.event.create({
			data: {
				project_id: projectId,
				source_id: source.id,
				idempotency_key: `id:${randomUUID()}`,
				headers: { 'content-type': 'application/json', 'x-toss-event': 'PAYMENT', host: 'api.hookbuffer.io' },
				body: new Uint8Array(BODY),
				content_type: 'application/json',
				size: BODY.length,
				source_ip: '203.0.113.7',
				verified: true,
				...options.event,
			},
		});
		const delivery = await prisma.delivery.create({ data: { event_id: event.id, destination_id: destination.id, connection_id: connection.id } });
		sourceId = source.id;
		mine.add(delivery.id);
		return { source, destination, connection, event, delivery };
	}
	// 같은 소스·목적지·연결로 가는 delivery를 하나 더 만든다
	async function another(fixture: Awaited<ReturnType<typeof setup>>) {
		const event = await prisma.event.create({ data: { project_id: projectId, source_id: fixture.source.id, idempotency_key: `id:${randomUUID()}`, headers: {}, body: new Uint8Array(BODY), size: BODY.length } });
		const delivery = await prisma.delivery.create({ data: { event_id: event.id, destination_id: fixture.destination.id, connection_id: fixture.connection.id } });
		mine.add(delivery.id);
		return delivery.id;
	}
	const state = (id: bigint) => prisma.delivery.findUniqueOrThrow({ where: { id }, include: { attempts: { orderBy: { attempt_no: 'asc' } } } });
	const enqueue = (id: bigint) => queue.enqueue([{ delivery_id: id, trigger: 'initial' }]);
	const consume = () => runner.consumeOnce(50);
	const streamLength = () => valkey.xlen(keys.stream);

	beforeAll(async () => {
		await valkey.onModuleInit();
		await queue.ensureGroup();
		server = http.createServer((incoming, response) => {
			const chunks: Buffer[] = [];
			incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
			incoming.on('end', () => {
				received.push({ method: incoming.method ?? '', url: incoming.url ?? '', headers: incoming.headers, body: Buffer.concat(chunks) });
				respond(incoming, response);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

		orgId = (await prisma.organization.create({ data: { name: 'delivery 통합', plan: 'team' } })).id;
		projectId = (await prisma.project.create({ data: { organization_id: orgId, name: 'shop', signing_secret_enc: cipher.encrypt(SECRET) } })).id;
	});

	beforeEach(() => {
		received = [];
		respond = (_incoming, response) => response.writeHead(200).end('{"ok":true}');
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => void server.close(() => resolve()));
		// source·destination·event·delivery·attempt는 project를 지우면 같이 지워진다(FK cascade)
		await prisma.project.deleteMany({ where: { organization_id: orgId } });
		await prisma.organization.deleteMany({ where: { id: orgId } });
		await valkey.del(keys.stream, keys.scheduled, ...[...destinations].flatMap((id) => Object.values(guardKeys(id))));
		await queue.onModuleDestroy();
		await valkey.onModuleDestroy();
		await prisma.$disconnect();
	});

	it('큐에서 꺼내 목적지로 보내고 succeeded로 남긴다. 받은 요청 방식·경로·쿼리·헤더·본문이 그대로 가고 서명이 맞다', async () => {
		const { delivery, event } = await setup({ event: { method: 'PUT', path: '/orders/42', query: 'v=2&tag=a%20b' } });
		await enqueue(delivery.id);

		expect(await consume()).toBe(1);

		expect(received).toHaveLength(1);
		const got = received[0]!;
		expect(got.method).toBe('PUT');
		expect(got.url).toBe('/webhooks/orders/42?v=2&tag=a%20b');
		expect(got.body.equals(BODY)).toBe(true);
		expect(got.headers).toMatchObject({
			'content-type': 'application/json',
			'x-toss-event': 'PAYMENT',
			authorization: 'Bearer destination-token',
			'x-hookbuffer-event-id': event.id.toString(),
			'x-hookbuffer-delivery-id': delivery.id.toString(),
			'x-hookbuffer-attempt-count': '1',
			'x-hookbuffer-attempt-trigger': 'initial',
			'x-hookbuffer-will-retry-after': '1',
			'x-hookbuffer-event-url': `https://app.hookbuffer.io/orgs/${orgId}/projects/${projectId}/events/${event.id}`,
			'x-hookbuffer-source-name': encodeURIComponent('토스 결제'),
			'x-hookbuffer-destination-name': 'orders',
			'x-hookbuffer-original-ip': '203.0.113.7',
			'x-hookbuffer-verified': 'true',
		});
		// 고객 서버가 하는 확인: project 서명 키로 받은 본문의 HMAC-SHA256을 계산해 비교한다
		expect(got.headers['x-hookbuffer-signature']).toBe(createHmac('sha256', SECRET).update(got.body).digest('base64'));
		// 받은 host는 넘기지 않고 목적지의 것이다
		expect(got.headers.host).toBe(base.replace('http://', ''));

		const after = await state(delivery.id);
		expect(after).toMatchObject({ status: 'succeeded', attempt: 1, next_attempt_at: null, last_status_code: 200, last_error: null });
		expect(after.attempts).toHaveLength(1);
		expect(after.attempts[0]).toMatchObject({ attempt_no: 1, trigger: 'initial', status_code: 200, error: null, response_body: '{"ok":true}' });
		// 끝난 항목은 큐에서 지워진다
		expect(await streamLength()).toBe(0);
	});

	it('500이 반복되면 연결 설정대로 재시도하다 다 쓰면 dead로 남긴다', async () => {
		respond = (_incoming, response) => response.writeHead(500).end('boom');
		const { delivery } = await setup({ retry: { retry_count: 2 } });
		await enqueue(delivery.id);

		// 1번째 시도 실패 → 약 1초 뒤로 예약
		await consume();
		const first = await state(delivery.id);
		expect(first).toMatchObject({ status: 'failed', attempt: 1, last_status_code: 500 });
		const delay = first.next_attempt_at!.getTime() - Date.now();
		expect(delay).toBeGreaterThan(500);
		expect(delay).toBeLessThanOrEqual(1300);
		expect(await valkey.zscore(keys.scheduled, delivery.id.toString())).toBe(String(first.next_attempt_at!.getTime()));

		// 아직 시각이 안 됐으면 스케줄러가 옮기지 않는다
		expect(await runner.runScheduler(new Date())).toBe(0);
		// 시각이 되면 큐로 옮기고 예약에서 뺀다
		expect(await runner.runScheduler(FAR())).toBe(1);
		expect(await valkey.zscore(keys.scheduled, delivery.id.toString())).toBeNull();

		// 2번째 시도 실패 → 다시 예약
		await consume();
		expect(await state(delivery.id)).toMatchObject({ status: 'failed', attempt: 2 });
		await runner.runScheduler(FAR());

		// 3번째 시도 실패 → 재시도 2회를 다 썼다
		await consume();
		const dead = await state(delivery.id);
		expect(dead).toMatchObject({ status: 'dead', attempt: 3, next_attempt_at: null, last_status_code: 500 });
		expect(dead.attempts.map((a) => [a.attempt_no, a.trigger, a.status_code, a.response_body])).toEqual([
			[1, 'initial', 500, 'boom'],
			[2, 'automatic', 500, 'boom'],
			[3, 'automatic', 500, 'boom'],
		]);
		expect(received).toHaveLength(3);
		expect(received.map((r) => r.headers['x-hookbuffer-attempt-count'])).toEqual(['1', '2', '3']);
		// 마지막 시도에는 다음 재시도 안내가 없다
		expect(received[2]!.headers).not.toHaveProperty('x-hookbuffer-will-retry-after');
		expect(await valkey.zscore(keys.scheduled, delivery.id.toString())).toBeNull();
	});

	it('두 번 실패한 뒤 목적지가 복구되면 succeeded가 된다', async () => {
		let calls = 0;
		respond = (_incoming, response) => (++calls <= 2 ? response.writeHead(503).end() : response.writeHead(200).end('ok'));
		const { delivery } = await setup({ retry: { retry_count: 5 } });
		await enqueue(delivery.id);

		await consume();
		await runner.runScheduler(FAR());
		await consume();
		await runner.runScheduler(FAR());
		await consume();

		const after = await state(delivery.id);
		expect(after).toMatchObject({ status: 'succeeded', attempt: 3, last_status_code: 200 });
		expect(after.attempts.map((a) => a.status_code)).toEqual([503, 503, 200]);
	});

	it('목적지가 Retry-After를 주면 그 시각으로 예약한다', async () => {
		respond = (_incoming, response) => response.writeHead(429, { 'retry-after': '120' }).end();
		const { delivery } = await setup();
		await enqueue(delivery.id);
		await consume();

		const delay = (await state(delivery.id)).next_attempt_at!.getTime() - Date.now();
		expect(delay).toBeGreaterThan(115_000);
		expect(delay).toBeLessThanOrEqual(120_000);
	});

	it('목적지에 연결할 수 없으면 오류를 남기고 재시도한다. 리다이렉트는 따라가지 않고 실패로 친다', async () => {
		const down = await setup();
		await prisma.destination.update({ where: { id: down.destination.id }, data: { url: 'http://127.0.0.1:1/webhooks' } });
		await enqueue(down.delivery.id);
		await consume();
		const failed = await state(down.delivery.id);
		expect(failed).toMatchObject({ status: 'failed', last_status_code: null, last_error: 'ECONNREFUSED' });
		expect(failed.attempts[0]).toMatchObject({ status_code: null, error: 'ECONNREFUSED', response_body: null });

		respond = (_incoming, response) => response.writeHead(302, { location: `${base}/elsewhere` }).end();
		const redirected = await setup();
		await enqueue(redirected.delivery.id);
		await consume();
		expect(await state(redirected.delivery.id)).toMatchObject({ status: 'failed', last_status_code: 302 });
		expect(received.map((r) => r.url)).toEqual(['/webhooks']);
	});

	it('큐 적재가 빠진 delivery를 sweeper가 다시 넣어 전달한다', async () => {
		const { delivery } = await setup();
		// 큐에 넣지 않았다. 만든 지 오래된 것으로 만든다
		await prisma.$executeRaw`UPDATE delivery SET updated_at = now() - interval '10 minutes' WHERE id = ${delivery.id}`;
		expect(await consume()).toBe(0);

		expect(await sweeping.runSweeper(new Date())).toBe(1);
		// 방금 본 것으로 표시돼 다음 번에는 다시 나오지 않는다
		expect(await deliveries.findStale(new Date(), 120_000, 500)).not.toContain(delivery.id);

		expect(await consume()).toBe(1);
		expect(await state(delivery.id)).toMatchObject({ status: 'succeeded', attempt: 1 });
		expect((await state(delivery.id)).attempts[0]).toMatchObject({ trigger: 'initial' });
	});

	it('예약이 사라진 failed delivery도 sweeper가 다시 넣는다. 방금 만든 것과 끝난 것은 건드리지 않는다', async () => {
		const lost = await setup();
		const fresh = await setup();
		const done = await setup();
		await prisma.$executeRaw`UPDATE delivery SET status = 'failed', attempt = 1, next_attempt_at = now() - interval '5 minutes', updated_at = now() - interval '10 minutes' WHERE id = ${lost.delivery.id}`;
		await prisma.$executeRaw`UPDATE delivery SET status = 'succeeded', updated_at = now() - interval '10 minutes' WHERE id = ${done.delivery.id}`;

		const stale = await deliveries.findStale(new Date(), 120_000, 500);
		expect(stale).toContain(lost.delivery.id);
		expect(stale).not.toContain(fresh.delivery.id);
		expect(stale).not.toContain(done.delivery.id);
	});

	it('일시 정지한 연결의 delivery는 보내지 않고 held로 둔다. 풀면 이어서 전달한다', async () => {
		const { delivery, connection } = await setup();
		await prisma.connection.update({ where: { id: connection.id }, data: { paused_at: new Date() } });
		await enqueue(delivery.id);

		await consume();
		expect(received).toHaveLength(0);
		expect(await state(delivery.id)).toMatchObject({ status: 'held', attempt: 0 });
		expect((await state(delivery.id)).attempts).toHaveLength(0);

		// 풀기 전에는 sweeper도 건드리지 않는다
		await prisma.$executeRaw`UPDATE delivery SET updated_at = now() - interval '10 minutes' WHERE id = ${delivery.id}`;
		expect(await deliveries.findStale(new Date(), 120_000, 500)).not.toContain(delivery.id);

		await prisma.connection.update({ where: { id: connection.id }, data: { paused_at: null } });
		expect(await held.release(connection.id)).toBe(1);
		expect(await held.release(connection.id)).toBe(0);

		await consume();
		const after = await state(delivery.id);
		expect(after).toMatchObject({ status: 'succeeded', attempt: 1 });
		expect(after.attempts[0]).toMatchObject({ trigger: 'unpause' });
		expect(received[0]!.headers['x-hookbuffer-attempt-trigger']).toBe('unpause');
	});

	it('정지된 project의 delivery도 held로 둔다', async () => {
		const suspended = await prisma.project.create({ data: { organization_id: orgId, name: 'suspended', suspended_at: new Date(), signing_secret_enc: cipher.encrypt(SECRET) } });
		const original = projectId;
		projectId = suspended.id;
		const { delivery } = await setup();
		projectId = original;
		await enqueue(delivery.id);

		await consume();
		expect(received).toHaveLength(0);
		expect(await state(delivery.id)).toMatchObject({ status: 'held', attempt: 0 });
	});

	it('목적지나 연결이 지워진 delivery는 보내지 않고 canceled로 닫는다', async () => {
		const noDestination = await setup();
		await prisma.destination.delete({ where: { id: noDestination.destination.id } });
		const noConnection = await setup();
		await prisma.connection.delete({ where: { id: noConnection.connection.id } });
		await queue.enqueue([{ delivery_id: noDestination.delivery.id }, { delivery_id: noConnection.delivery.id }]);

		await consume();
		expect(received).toHaveLength(0);
		expect(await state(noDestination.delivery.id)).toMatchObject({ status: 'canceled', destination_id: null });
		expect(await state(noConnection.delivery.id)).toMatchObject({ status: 'canceled', connection_id: null });
	});

	it('이미 끝난 delivery와 지워진 delivery가 큐에 있어도 다시 보내지 않고 큐에서 지운다', async () => {
		const { delivery } = await setup();
		await enqueue(delivery.id);
		await consume();
		expect(received).toHaveLength(1);

		await queue.enqueue([{ delivery_id: delivery.id }, { delivery_id: 999_999_999_999n }]);
		expect(await consume()).toBe(2);
		expect(received).toHaveLength(1);
		expect(await state(delivery.id)).toMatchObject({ status: 'succeeded', attempt: 1 });
		expect(await streamLength()).toBe(0);
	});

	it('서명 키가 없는 예전 project는 처음 보낼 때 키를 만들어 그 키로 서명한다', async () => {
		const legacy = await prisma.project.create({ data: { organization_id: orgId, name: 'legacy' } });
		const original = projectId;
		projectId = legacy.id;
		const { delivery } = await setup();
		projectId = original;
		await enqueue(delivery.id);
		await consume();

		const stored = (await prisma.project.findUniqueOrThrow({ where: { id: legacy.id } })).signing_secret_enc;
		expect(stored).not.toBeNull();
		const secret = cipher.decrypt(stored!);
		expect(secret).toMatch(/^rdsec_/);
		expect(received[0]!.headers['x-hookbuffer-signature']).toBe(createHmac('sha256', secret).update(BODY).digest('base64'));
	});

	describe('목적지 보호', () => {
		const statuses = (ids: bigint[]) => prisma.delivery.findMany({ where: { id: { in: ids } }, select: { status: true, attempt: true } });
		// 미룬 것이 시각이 될 때까지 기다리지 않고 바로 옮겨 다시 처리한다
		const again = async () => {
			await runner.runScheduler(FAR());
			await consume();
		};
		// 스케줄러를 앞당기면 앞 테스트가 예약해 둔 것도 같이 큐로 온다. 목적지 헤더로 이 테스트의 요청만 센다
		let tag: string;
		const isMine = (headers: http.IncomingHttpHeaders) => headers['x-fixture'] === tag;
		const sent = () => received.filter((r) => isMine(r.headers));
		// 큐에 남은 것을 다 처리해 다음 테스트가 빈 큐에서 시작하게 한다
		const drain = async () => {
			while ((await consume()) > 0) {
				// 비울 때까지
			}
		};

		beforeEach(() => {
			tag = randomUUID();
		});
		afterEach(drain);

		it('동시 20건에 concurrency 2 → 목적지에는 한 번에 2건만 간다. 나머지는 미뤘다가 보낸다', async () => {
			let inflight = 0;
			let maxInflight = 0;
			respond = (incoming, response) => {
				const counted = isMine(incoming.headers);
				if (counted) maxInflight = Math.max(maxInflight, ++inflight);
				setTimeout(() => {
					if (counted) inflight--;
					response.writeHead(200).end('ok');
				}, 100);
			};
			const fixture = await setup({ concurrency: 2, headers: { 'x-fixture': tag } });
			const ids = [fixture.delivery.id];
			for (let i = 1; i < 20; i++) ids.push(await another(fixture));
			await queue.enqueue(ids.map((delivery_id) => ({ delivery_id })));

			// 10건씩 두 묶음을 동시에 읽어 20건을 한꺼번에 처리한다
			await Promise.all([consume(), consume()]);
			expect(sent()).toHaveLength(2);
			expect(maxInflight).toBe(2);
			// 미룬 18건은 시도 횟수를 쓰지 않고 1~5초 뒤로 예약됐다
			const deferred = (await statuses(ids)).filter((row) => row.status === 'pending');
			expect(deferred).toHaveLength(18);
			expect(deferred.every((row) => row.attempt === 0)).toBe(true);
			for (const id of ids) {
				const row = await state(id);
				if (row.status !== 'pending') continue;
				const delay = row.next_attempt_at!.getTime() - Date.now();
				expect(delay).toBeGreaterThan(0);
				expect(delay).toBeLessThanOrEqual(5_000);
				expect(await valkey.zscore(keys.scheduled, id.toString())).toBe(String(row.next_attempt_at!.getTime()));
			}

			for (let round = 0; round < 12 && sent().length < 20; round++) {
				await runner.runScheduler(FAR());
				await Promise.all([consume(), consume()]);
			}
			expect(sent()).toHaveLength(20);
			expect(maxInflight).toBe(2);
			expect((await statuses(ids)).every((row) => row.status === 'succeeded' && row.attempt === 1)).toBe(true);
			// 자리는 다 돌려줬다
			expect(await valkey.zcard(guardKeys(fixture.destination.id).inflight)).toBe(0);
		});

		it('연속 5회 실패 → 60초 open(보내지 않고 미룬다) → 프로브 1건 실패면 다시 open, 성공이면 close', async () => {
			respond = (_incoming, response) => response.writeHead(500).end('down');
			const fixture = await setup({ retry: { retry_count: 10 }, headers: { 'x-fixture': tag } });
			const circuit = guardKeys(fixture.destination.id);
			const failing = [fixture.delivery.id];
			for (let i = 1; i < 5; i++) failing.push(await another(fixture));
			await queue.enqueue(failing.map((delivery_id) => ({ delivery_id })));
			await consume();
			expect(sent()).toHaveLength(5);
			expect(await valkey.get(circuit.failures)).toBe('5');
			const ttl = await valkey.pttl(circuit.open);
			expect(ttl).toBeGreaterThan(55_000);
			expect(ttl).toBeLessThanOrEqual(60_000);

			// 열려 있는 동안 들어온 2건은 보내지 않고 풀리는 시각 뒤로 미룬다. 시도 횟수를 쓰지 않는다
			const waiting = [await another(fixture), await another(fixture)];
			await queue.enqueue(waiting.map((delivery_id) => ({ delivery_id })));
			await consume();
			expect(sent()).toHaveLength(5);
			for (const id of waiting) {
				const row = await state(id);
				expect(row).toMatchObject({ status: 'pending', attempt: 0 });
				const delay = row.next_attempt_at!.getTime() - Date.now();
				expect(delay).toBeGreaterThan(55_000);
				expect(delay).toBeLessThanOrEqual(65_000);
				expect(await valkey.zscore(keys.scheduled, id.toString())).toBe(String(row.next_attempt_at!.getTime()));
			}

			// 60초를 기다리지 않고 열린 키를 지워 시간이 지난 것으로 한다. half_open에서는 프로브 자리를 잡은 하나만 보낸다
			await valkey.del(circuit.open);
			expect(await guard.circuit(fixture.destination.id)).toEqual({ state: 'half_open', probe: true });
			expect(await guard.circuit(fixture.destination.id)).toEqual({ state: 'half_open', probe: false });
			await valkey.del(circuit.probe);

			// 프로브가 실패하면 다시 60초 연다. 같이 들어온 다른 건(7건 중 프로브 1건을 뺀 나머지)은 보내지 않는다
			await again();
			expect(sent()).toHaveLength(6);
			expect(await valkey.get(circuit.failures)).toBe('6');
			expect(await valkey.pttl(circuit.open)).toBeGreaterThan(55_000);
			expect((await statuses([...failing, ...waiting])).reduce((sum, row) => sum + row.attempt, 0)).toBe(6);

			// 목적지가 살아나면 프로브 1건이 성공해 닫히고, 그 뒤로는 그냥 보낸다
			await valkey.del(circuit.open);
			respond = (_incoming, response) => setTimeout(() => response.writeHead(200).end('ok'), 100);
			for (let round = 0; round < 3 && (await statuses(waiting)).some((row) => row.status !== 'succeeded'); round++) await again();
			expect((await statuses(waiting)).every((row) => row.status === 'succeeded')).toBe(true);
			expect(await valkey.exists(circuit.failures, circuit.open, circuit.probe)).toBe(0);
			expect(await guard.circuit(fixture.destination.id)).toEqual({ state: 'closed' });
		});
	});

	it('내부망 주소 목적지는 보내지 않고 blocked_address 실패로 기록한다(ALLOW_PRIVATE_DESTINATIONS가 true가 아님)', async () => {
		// 가짜 목적지 서버가 127.0.0.1이라 평소 설정으로는 허용돼 있다. 차단이 켜진 client로 워커를 하나 더 둔다
		const strict = new DeliveryWorker(deliveries, new NodeDestinationClient(new ConfigService({ ALLOW_PRIVATE_DESTINATIONS: 'false' })), queue, guard, 'https://app.hookbuffer.io');
		const { delivery } = await setup();

		expect(await strict.process({ delivery_id: delivery.id }, new Date(), 0.5)).toBe('failed');
		expect(received).toHaveLength(0);
		const after = await state(delivery.id);
		expect(after).toMatchObject({ status: 'failed', attempt: 1, last_status_code: null, last_error: 'blocked_address' });
		expect(after.attempts[0]).toMatchObject({ attempt_no: 1, status_code: null, error: 'blocked_address', response_body: null });
	});

	it('예약을 지우면(unschedule) 스케줄러가 옮기지 않는다', async () => {
		const { delivery } = await setup();
		await queue.schedule(delivery.id, new Date());
		await queue.unschedule([delivery.id]);
		await queue.unschedule([]);
		expect(await valkey.zscore(keys.scheduled, delivery.id.toString())).toBeNull();
	});

	describe('처리하다 죽은 항목', () => {
		// 처리 중에 던지는 워커. DB 장애나 프로세스 종료를 흉내 낸다
		const broken = new DeliveryRunner({ process: () => Promise.reject(new Error('db down')) } as unknown as DeliveryWorker, queue, deliveries);

		it('처리가 끝나지 않은 항목은 큐에 남고, 다른 워커가 넘겨받아 전달한다', async () => {
			const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
			const { delivery } = await setup();
			await enqueue(delivery.id);

			expect(await broken.consumeOnce(50)).toBe(1);
			expect(logged).toHaveBeenCalledWith(expect.stringContaining('db down'));
			expect(await streamLength()).toBe(1);
			// 새 항목으로는 다시 읽히지 않는다
			expect(await consume()).toBe(0);
			// 아직 기준 시간이 안 됐으면 넘겨받지 않는다
			expect(await runner.runReclaim(60_000)).toBe(0);

			expect(await runner.runReclaim(0)).toBe(1);
			expect(await state(delivery.id)).toMatchObject({ status: 'succeeded', attempt: 1 });
			expect(await streamLength()).toBe(0);
			logged.mockRestore();
		});

		it(`같은 항목이 ${MAX_DELIVERIES}번 넘게 건네지고도 안 끝나면 그 delivery를 dead로 닫고 큐에서 지운다`, async () => {
			const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
			const { delivery } = await setup();
			await enqueue(delivery.id);

			await broken.consumeOnce(50);
			for (let i = 1; i < MAX_DELIVERIES; i++) expect(await broken.runReclaim(0)).toBe(1);
			expect(await state(delivery.id)).toMatchObject({ status: 'pending', attempt: 0 });

			// 다음에 넘겨받는 워커는 처리하지 않고 닫는다
			expect(await broken.runReclaim(0)).toBe(1);
			expect(await state(delivery.id)).toMatchObject({ status: 'dead', attempt: 0, last_error: 'worker_failed' });
			expect(received).toHaveLength(0);
			expect(await streamLength()).toBe(0);
			logged.mockRestore();
		});
	});

	it('같은 delivery를 두 워커가 동시에 처리해도 기록은 한 번만 남는다', async () => {
		const { delivery } = await setup();
		const loaded = (await deliveries.load(delivery.id))!;
		const attempt = { attempt_no: 1, trigger: 'initial' as const, status_code: 200, error: null, duration_ms: 5, response_body: 'ok' };
		const outcome = { status: 'succeeded' as const, next_attempt_at: null, last_status_code: 200, last_error: null };

		const results = await Promise.all([deliveries.recordAttempt(delivery.id, loaded.attempt, attempt, outcome), deliveries.recordAttempt(delivery.id, loaded.attempt, attempt, outcome)]);
		expect(results.sort()).toEqual([false, true]);
		expect((await state(delivery.id)).attempts).toHaveLength(1);
	});

	it('소스가 지워진 event도 전달한다. 소스 이름 헤더만 빠진다', async () => {
		const { delivery, source } = await setup();
		await prisma.source.delete({ where: { id: source.id } });
		// 소스를 지우면 연결도 지워진다. 전달 자체를 보려고 연결을 다른 소스에 다시 건다
		const other = await prisma.source.create({ data: { project_id: projectId, slug: newSlug(), name: 'other' } });
		const connection = await prisma.connection.create({ data: { source_id: other.id, destination_id: (await state(delivery.id)).destination_id! } });
		await prisma.delivery.update({ where: { id: delivery.id }, data: { connection_id: connection.id } });
		await enqueue(delivery.id);
		await consume();

		expect(await state(delivery.id)).toMatchObject({ status: 'succeeded' });
		expect(received[0]!.headers).not.toHaveProperty('x-hookbuffer-source-name');
		expect(sourceId).toBeGreaterThan(0);
	});
});
