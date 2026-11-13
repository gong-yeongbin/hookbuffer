import { ConfigService } from '@nestjs/config';
import { CipherService } from '@/infra/cipher/cipher.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { CreateCheck } from '../ports/destination.repository';
import { PrismaDestinationRepository } from './prisma-destination.repository';

// adapter는 docker compose의 postgres 위에서 통합으로 본다(`pnpm docker:up && pnpm db:deploy` 선행).
describe('PrismaDestinationRepository (통합)', () => {
	const config = new ConfigService({ DATABASE_URL: process.env.DATABASE_URL, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY });
	const prisma = new PrismaService(config);
	const cipher = new CipherService(config);
	const destinations = new PrismaDestinationRepository(prisma, cipher);
	const allow: CreateCheck = () => undefined;
	const plain = (name: string) => ({ name, url: 'https://api.example.com/hooks', headers: {} });
	let orgId: number;
	let projectId: number;
	let otherProjectId: number;

	beforeAll(async () => {
		orgId = (await prisma.organization.create({ data: { name: 'destination 테스트', plan: 'team' } })).id;
		projectId = (await prisma.project.create({ data: { organization_id: orgId, name: 'a' } })).id;
		otherProjectId = (await prisma.project.create({ data: { organization_id: orgId, name: 'b' } })).id;
	});

	afterAll(async () => {
		// destination은 project를 지우면 같이 지워진다(FK cascade)
		await prisma.project.deleteMany({ where: { organization_id: orgId } });
		await prisma.organization.deleteMany({ where: { id: orgId } });
		await prisma.$disconnect();
	});

	it('create — 잠근 상태의 plan·그 project의 개수를 check에 넘기고, check가 던지면 만들지 않는다. 한도는 기본값', async () => {
		const seen: unknown[] = [];
		const created = await destinations.create(projectId, plain('first'), (state) => void seen.push(state));
		expect(created).toMatchObject({ project_id: projectId, name: 'first', headers: {}, timeout_ms: 5000, concurrency: 10 });
		expect(created).not.toHaveProperty('headers_enc');
		expect(seen).toEqual([{ plan: 'team', count: 0 }]);

		await expect(
			destinations.create(projectId, plain('rejected'), () => {
				throw new Error('limit');
			}),
		).rejects.toThrow('limit');
		expect(await prisma.destination.count({ where: { project_id: projectId, name: 'rejected' } })).toBe(0);
	});

	it('create — 동시에 들어와도 잠금으로 줄 서서 상한(1)을 넘지 않는다', async () => {
		// 커넥션을 미리 열어 둔다. 근거는 context-notes.md "상한 검사는 조직 행 잠금 안에서"
		await Promise.all(Array.from({ length: 10 }, () => prisma.$queryRaw`SELECT pg_sleep(0.05)::text`));
		const limitOne: CreateCheck = ({ count }) => {
			if (count >= 1) throw new Error('limit');
		};
		const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => destinations.create(otherProjectId, plain(`r${i}`), limitOne)));

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await prisma.destination.count({ where: { project_id: otherProjectId } })).toBe(1);
	});

	it('headers는 암호화해 저장하고 읽을 때 원문으로 돌려준다. 비우면 NULL', async () => {
		const headers = { Authorization: 'Bearer real-token', 'X-Source': 'munjigi' };
		const created = await destinations.create(projectId, { ...plain('with headers'), headers, timeout_ms: 3000 }, allow);
		expect(created).toMatchObject({ headers, timeout_ms: 3000 });
		const stored = async () => (await prisma.destination.findUniqueOrThrow({ where: { id: created.id } })).headers_enc;

		const first = await stored();
		expect(first).not.toContain('real-token');
		expect(JSON.parse(cipher.decrypt(first!))).toEqual(headers);
		expect((await destinations.find(projectId, created.id))!.headers).toEqual(headers);

		// headers를 안 보내면 그대로다
		expect(await destinations.update(projectId, created.id, { name: 'renamed', concurrency: 2 })).toMatchObject({ name: 'renamed', concurrency: 2, headers });
		expect(await stored()).toBe(first);

		expect((await destinations.update(projectId, created.id, { headers: { 'X-Only': '1' } }))!.headers).toEqual({ 'X-Only': '1' });
		expect((await destinations.update(projectId, created.id, { headers: {} }))!.headers).toEqual({});
		expect(await stored()).toBeNull();
	});

	it('list — id 내림차순, cursor보다 작은 것부터', async () => {
		await destinations.create(projectId, plain('second'), allow);
		const all = await destinations.list(projectId, null, 100);
		expect(all.length).toBeGreaterThanOrEqual(2);
		expect(all.map((d) => d.id)).toEqual([...all.map((d) => d.id)].sort((x, y) => y - x));
		expect((await destinations.list(projectId, all[0]!.id, 100)).map((d) => d.id)).toEqual(all.slice(1).map((d) => d.id));
	});

	it('find·update·remove — 다른 project의 id는 null/false', async () => {
		const d = await destinations.create(projectId, plain('mine'), allow);

		expect(await destinations.find(otherProjectId, d.id)).toBeNull();
		expect(await destinations.update(otherProjectId, d.id, { name: 'hacked' })).toBeNull();
		expect(await destinations.remove(otherProjectId, d.id)).toBe(false);

		expect(await destinations.remove(projectId, d.id)).toBe(true);
		expect(await destinations.find(projectId, d.id)).toBeNull();
	});
});
