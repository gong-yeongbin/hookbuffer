import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { DestinationService } from './destination.service';
import type { CreateCheck, DestinationRecord, DestinationRepository, DestinationWrite } from './ports/destination.repository';

const PROJECT = 10;
const URL = 'https://api.example.com/hooks';

// port를 in-memory fake로 둔다. headers는 평문 그대로 들고 있는다(암호화는 adapter 몫)
class FakeDestinations implements DestinationRepository {
	plan: Plan = 'team';
	rows: DestinationRecord[] = [];
	nextId = 1;

	create(projectId: number, data: DestinationWrite, check: CreateCheck) {
		check({ plan: this.plan, count: this.rows.filter((r) => r.project_id === projectId).length });
		const row: DestinationRecord = {
			id: this.nextId++,
			project_id: projectId,
			name: data.name,
			url: data.url,
			headers: data.headers,
			timeout_ms: data.timeout_ms ?? 5000,
			concurrency: data.concurrency ?? 10,
			created_at: new Date(0),
			updated_at: new Date(0),
		};
		this.rows.push(row);
		return Promise.resolve(row);
	}
	list(projectId: number, cursor: number | null, take: number) {
		const rows = this.rows.filter((r) => r.project_id === projectId && (cursor === null || r.id < cursor)).sort((a, b) => b.id - a.id);
		return Promise.resolve(rows.slice(0, take));
	}
	find(projectId: number, id: number) {
		return Promise.resolve(this.rows.find((r) => r.project_id === projectId && r.id === id) ?? null);
	}
	update(projectId: number, id: number, data: Partial<DestinationWrite>) {
		const row = this.rows.find((r) => r.project_id === projectId && r.id === id);
		if (!row) return Promise.resolve(null);
		Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
		return Promise.resolve(row);
	}
	remove(projectId: number, id: number) {
		const before = this.rows.length;
		this.rows = this.rows.filter((r) => !(r.project_id === projectId && r.id === id));
		return Promise.resolve(this.rows.length < before);
	}
}

async function errorOf(promise: Promise<unknown>) {
	const error = await promise.catch((e: unknown) => e);
	return { type: (error as object).constructor, code: ((error as ForbiddenException).getResponse() as { code: string }).code };
}

describe('DestinationService', () => {
	let repo: FakeDestinations;
	let service: DestinationService;

	beforeEach(() => {
		repo = new FakeDestinations();
		service = new DestinationService(repo);
	});

	it('create — headers를 안 보내면 빈 객체, 한도는 기본값', async () => {
		expect(await service.create(PROJECT, { name: 'orders', url: URL })).toMatchObject({
			project_id: PROJECT,
			name: 'orders',
			url: URL,
			headers: {},
			timeout_ms: 5000,
			concurrency: 10,
		});
	});

	it('응답의 headers는 비밀 값을 가리고, 저장소에는 원문이 간다', async () => {
		const headers = { Authorization: 'Bearer real-token', 'X-Source': 'munjigi' };
		const masked = { Authorization: 'Bearer ****', 'X-Source': 'munjigi' };

		const created = await service.create(PROJECT, { name: 'orders', url: URL, headers, timeout_ms: 3000 });
		expect(created).toMatchObject({ headers: masked, timeout_ms: 3000 });
		expect(repo.rows[0]!.headers).toEqual(headers);

		expect((await service.get(PROJECT, created.id)).headers).toEqual(masked);
		expect((await service.list(PROJECT, { limit: 50 })).data[0]!.headers).toEqual(masked);
		expect((await service.update(PROJECT, created.id, { name: 'renamed' })).headers).toEqual(masked);
		expect(repo.rows[0]!.headers).toEqual(headers);
	});

	it('create — free는 project당 3개, 넘으면 403 plan_limit. 유료와 다른 project는 걸리지 않는다', async () => {
		repo.plan = 'free';
		for (const name of ['a', 'b', 'c']) await service.create(PROJECT, { name, url: URL });
		expect(await errorOf(service.create(PROJECT, { name: 'd', url: URL }))).toEqual({ type: ForbiddenException, code: 'plan_limit' });
		await service.create(PROJECT + 1, { name: 'other project', url: URL });

		repo.plan = 'team';
		await service.create(PROJECT, { name: 'd', url: URL });
		expect(repo.rows).toHaveLength(5);
	});

	it('update — 보내지 않은 필드는 그대로, headers는 통째로 바뀌고 null이면 지운다', async () => {
		const { id } = await service.create(PROJECT, { name: 'a', url: URL, headers: { 'X-A': '1' }, concurrency: 3 });

		expect(await service.update(PROJECT, id, { url: 'https://new.example.com', timeout_ms: 2000 })).toMatchObject({
			name: 'a',
			url: 'https://new.example.com',
			headers: { 'X-A': '1' },
			timeout_ms: 2000,
			concurrency: 3,
		});
		expect((await service.update(PROJECT, id, { headers: { 'X-B': '2' } })).headers).toEqual({ 'X-B': '2' });
		expect((await service.update(PROJECT, id, { headers: null })).headers).toEqual({});
	});

	it('list — id 내림차순 페이지', async () => {
		for (const name of ['a', 'b', 'c']) await service.create(PROJECT, { name, url: URL });
		const page = await service.list(PROJECT, { limit: 2 });
		expect(page.data.map((d) => d.name)).toEqual(['c', 'b']);
		expect(page.next_cursor).toBe('2');
	});

	it('get·update·remove — 없거나 다른 project면 404 destination_not_found', async () => {
		const { id } = await service.create(PROJECT, { name: 'a', url: URL });
		expect(await errorOf(service.get(PROJECT + 1, id))).toEqual({ type: NotFoundException, code: 'destination_not_found' });

		await service.remove(PROJECT, id);
		for (const call of [service.get(PROJECT, id), service.update(PROJECT, id, { name: 'x' }), service.remove(PROJECT, id)]) {
			expect((await errorOf(call)).code).toBe('destination_not_found');
		}
	});
});
