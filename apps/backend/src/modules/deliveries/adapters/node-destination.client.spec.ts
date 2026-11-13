import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import type { DestinationRequest } from '../ports/destination.client';
import { NodeDestinationClient, RESPONSE_BODY_LIMIT } from './node-destination.client';

type Received = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

// 실제 HTTP 서버를 띄워 통합으로 본다. 서버가 127.0.0.1이라 차단을 끈 클라이언트로 보낸다
describe('NodeDestinationClient (통합)', () => {
	const client = new NodeDestinationClient(new ConfigService({ ALLOW_PRIVATE_DESTINATIONS: 'true' }));
	const guarded = new NodeDestinationClient(new ConfigService({ ALLOW_PRIVATE_DESTINATIONS: 'false' }));
	let server: http.Server;
	let base: string;
	let received: Received[];
	// 경로마다 목적지 서버가 어떻게 답할지
	let respond: (request: IncomingMessage, response: ServerResponse) => void;

	const request = (overrides: Partial<DestinationRequest> = {}): DestinationRequest => ({
		method: 'POST',
		url: `${base}/webhooks`,
		headers: { 'content-type': 'application/json' },
		body: Buffer.from('{"order":1}'),
		timeout_ms: 2000,
		...overrides,
	});

	beforeAll(async () => {
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
	});

	beforeEach(() => {
		received = [];
		respond = (_incoming, response) => response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
	});

	afterAll(() => new Promise<void>((resolve) => void server.close(() => resolve())));

	it('요청 방식·경로·쿼리·헤더·본문을 준 그대로 보내고, 상태 코드와 응답 본문을 돌려준다', async () => {
		const body = Buffer.from([0x7b, 0xff, 0xfe, 0x00, 0x7d]);
		const result = await client.send(
			request({ method: 'PUT', url: `${base}/webhooks/orders/42?v=2&tag=a%20b`, headers: { 'content-type': 'application/x-custom', 'x-munjigi-event-id': '120', 'x-multi': ['a', 'b'] }, body }),
		);

		expect(result).toMatchObject({ status_code: 200, response_body: '{"ok":true}', retry_after: undefined });
		expect((result as { duration_ms: number }).duration_ms).toBeGreaterThanOrEqual(0);

		expect(received).toHaveLength(1);
		const got = received[0]!;
		expect(got.method).toBe('PUT');
		expect(got.url).toBe('/webhooks/orders/42?v=2&tag=a%20b');
		expect(got.body.equals(body)).toBe(true);
		expect(got.headers).toMatchObject({ 'content-type': 'application/x-custom', 'x-munjigi-event-id': '120', 'x-multi': 'a, b', 'content-length': '5' });
	});

	it('본문이 없는 DELETE도 보낸다', async () => {
		await client.send(request({ method: 'DELETE', body: Buffer.alloc(0) }));
		expect(received[0]).toMatchObject({ method: 'DELETE', headers: { 'content-length': '0' } });
		expect(received[0]!.body).toHaveLength(0);
	});

	it('2xx가 아니어도 던지지 않고 상태 코드·응답 본문·Retry-After를 돌려준다', async () => {
		respond = (_incoming, response) => response.writeHead(503, { 'retry-after': '120' }).end('잠시 후 다시');
		expect(await client.send(request())).toMatchObject({ status_code: 503, response_body: '잠시 후 다시', retry_after: '120' });
	});

	it('리다이렉트는 따라가지 않고 그 응답을 그대로 돌려준다', async () => {
		respond = (_incoming, response) => response.writeHead(302, { location: `${base}/elsewhere` }).end();
		expect(await client.send(request())).toMatchObject({ status_code: 302 });
		expect(received.map((r) => r.url)).toEqual(['/webhooks']);
	});

	it('응답 본문은 앞 4KB만 남긴다', async () => {
		respond = (_incoming, response) => response.writeHead(200).end('a'.repeat(RESPONSE_BODY_LIMIT * 3));
		const result = await client.send(request());
		expect((result as { response_body: string }).response_body).toBe('a'.repeat(RESPONSE_BODY_LIMIT));
	});

	it('제한 시간 안에 응답이 없으면 timeout', async () => {
		respond = () => undefined;
		const result = await client.send(request({ timeout_ms: 100 }));
		expect(result).toMatchObject({ error: 'timeout' });
		expect((result as { duration_ms: number }).duration_ms).toBeGreaterThanOrEqual(90);
	});

	it('연결할 수 없으면 오류 코드를 돌려준다', async () => {
		expect(await client.send(request({ url: 'http://127.0.0.1:1/webhooks' }))).toMatchObject({ error: 'ECONNREFUSED' });
	});

	it('주소나 헤더 값이 잘못돼도 던지지 않고 오류로 돌려준다', async () => {
		expect(await client.send(request({ url: 'not a url' }))).toHaveProperty('error');
		expect(await client.send(request({ headers: { 'x-name': '한글 값' } }))).toHaveProperty('error');
		expect(received).toHaveLength(0);
	});

	describe('내부망 차단', () => {
		it('IP로 적힌 내부망 주소는 보내지 않는다', async () => {
			expect(await guarded.send(request())).toMatchObject({ error: 'blocked_address' });
			expect(await guarded.send(request({ url: 'http://169.254.169.254/latest/meta-data/' }))).toMatchObject({ error: 'blocked_address' });
			expect(await guarded.send(request({ url: 'http://[::1]:3001/orgs' }))).toMatchObject({ error: 'blocked_address' });
			expect(received).toHaveLength(0);
		});

		it('이름이 내부망 주소로 풀려도 보내지 않는다', async () => {
			const port = (server.address() as AddressInfo).port;
			expect(await guarded.send(request({ url: `http://localhost:${port}/webhooks` }))).toMatchObject({ error: 'blocked_address' });
			expect(received).toHaveLength(0);
		});

		it('차단을 끈 클라이언트는 같은 주소로 보낸다', async () => {
			const port = (server.address() as AddressInfo).port;
			expect(await client.send(request({ url: `http://localhost:${port}/webhooks` }))).toMatchObject({ status_code: 200 });
		});

		it('환경 변수가 없으면 차단한다', async () => {
			// ConfigService는 process.env로 폴백하는데 test/setup.ts가 'true'를 채워 둔다
			vi.stubEnv('ALLOW_PRIVATE_DESTINATIONS', undefined);
			const unset = new NodeDestinationClient(new ConfigService({}));
			vi.unstubAllEnvs();
			expect(await unset.send(request())).toMatchObject({ error: 'blocked_address' });
		});
	});
});
