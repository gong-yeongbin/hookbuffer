import type { DestinationDto, DestinationPageDto } from '@/modules/destinations/dto/get-destination.dto';
import { createTestApp, errorOf, type LoggedIn, type TestApp } from './support';

describe('destinations (e2e)', () => {
	let t: TestApp;
	let owner: LoggedIn;
	let member: LoggedIn;
	let free: LoggedIn;
	let projectId: number;
	let otherProjectId: number;
	let freeProjectId: number;

	const URL = 'https://api.example.com/webhooks';
	const auth = (who: LoggedIn) => ({ Authorization: `Bearer ${who.token}` });
	const path = (who: LoggedIn, project: number, destinationId?: number) => `/orgs/${who.org_id}/projects/${project}/destinations${destinationId ? `/${destinationId}` : ''}`;
	// org는 경로의 조직, as는 호출하는 사람
	const create = (body: object, opts: { org?: LoggedIn; as?: LoggedIn; project?: number } = {}) => {
		const org = opts.org ?? owner;
		return t
			.http()
			.post(path(org, opts.project ?? projectId))
			.set(auth(opts.as ?? org))
			.send(body);
	};

	beforeAll(async () => {
		t = await createTestApp();
		[owner, member, free] = [await t.login(), await t.login(), await t.login()];
		await t.prisma.organization.update({ where: { id: owner.org_id }, data: { plan: 'team' } });
		await t.prisma.organization_member.create({ data: { organization_id: owner.org_id, user_id: member.user_id, role: 'member' } });
		projectId = (await t.prisma.project.create({ data: { organization_id: owner.org_id, name: 'shop' } })).id;
		otherProjectId = (await t.prisma.project.create({ data: { organization_id: owner.org_id, name: 'blog' } })).id;
		freeProjectId = (await t.prisma.project.create({ data: { organization_id: free.org_id, name: 'trial' } })).id;
	});

	afterAll(() => t.close());

	it('이름과 url만 보내면 기본값으로 만든다', async () => {
		const created = (await create({ name: 'orders', url: URL }).expect(201)).body as DestinationDto;
		expect(created).toMatchObject({ project_id: projectId, name: 'orders', url: URL, headers: {}, timeout_ms: 5000, concurrency: 10 });
		expect(created).not.toHaveProperty('headers_enc');
	});

	it('응답의 headers는 비밀 값이 가려지고 DB에는 암호문으로 저장된다', async () => {
		const headers = { Authorization: 'Bearer real-server-token', 'X-Source': 'munjigi' };
		const masked = { Authorization: 'Bearer ****', 'X-Source': 'munjigi' };

		const response = await create({ name: 'with headers', url: URL, headers, timeout_ms: 3000, concurrency: 2 }).expect(201);
		const created = response.body as DestinationDto;
		expect(created).toMatchObject({ headers: masked, timeout_ms: 3000, concurrency: 2 });
		expect(response.text).not.toMatch(/real-server-token|headers_enc/);

		const row = await t.prisma.destination.findUniqueOrThrow({ where: { id: created.id } });
		expect(row.headers_enc).toBeTruthy();
		expect(row.headers_enc).not.toContain('real-server-token');

		const got = await t.http().get(path(owner, projectId, created.id)).set(auth(owner)).expect(200);
		const listed = await t.http().get(path(owner, projectId)).set(auth(owner)).expect(200);
		expect((got.body as DestinationDto).headers).toEqual(masked);
		for (const text of [got.text, listed.text]) expect(text).not.toMatch(/real-server-token|headers_enc/);
	});

	it.each([
		['url이 http(s)가 아님', { name: 'a', url: 'ftp://example.com/x' }, 'url'],
		['url 없음', { name: 'a' }, 'url'],
		['timeout_ms 범위 밖', { name: 'a', url: URL, timeout_ms: 500 }, 'timeout_ms'],
		['모르는 필드(max_attempts는 connection의 retry_count로 옮겼다)', { name: 'a', url: URL, max_attempts: 5 }, 'max_attempts'],
		['concurrency 범위 밖', { name: 'a', url: URL, concurrency: 0 }, 'concurrency'],
		['headers 값에 줄바꿈', { name: 'a', url: URL, headers: { 'X-A': 'a\r\nX-Injected: 1' } }, 'headers'],
		['headers 값이 문자열이 아님', { name: 'a', url: URL, headers: { 'X-A': 1 } }, 'headers'],
	])('400 validation_failed — %s', async (_name, body, field) => {
		const error = errorOf(await create(body).expect(400));
		expect(error.code).toBe('validation_failed');
		// 한 필드에 규칙이 여러 개 걸리면 details도 여러 개다
		expect(new Set(error.details?.map((d) => d.field))).toEqual(new Set([field]));
	});

	it('수정 — 보내지 않은 필드는 그대로, headers는 통째로 바뀌고 null이면 지운다', async () => {
		const created = (await create({ name: 'a', url: URL, headers: { 'X-Api-Key': 'k-123' }, concurrency: 3 }).expect(201)).body as DestinationDto;
		const patch = (body: object) => t.http().patch(path(owner, projectId, created.id)).set(auth(owner)).send(body);
		const stored = async () => (await t.prisma.destination.findUniqueOrThrow({ where: { id: created.id } })).headers_enc;
		const before = await stored();

		expect((await patch({ name: 'b', timeout_ms: 2000 }).expect(200)).body).toMatchObject({ name: 'b', url: URL, headers: { 'X-Api-Key': '****' }, timeout_ms: 2000, concurrency: 3 });
		expect(await stored()).toBe(before);

		expect(((await patch({ headers: { 'X-Source': 'munjigi' } }).expect(200)).body as DestinationDto).headers).toEqual({ 'X-Source': 'munjigi' });
		expect(((await patch({ headers: null }).expect(200)).body as DestinationDto).headers).toEqual({});
		expect(await stored()).toBeNull();
		await patch({ timeout_ms: 31_000 }).expect(400);
	});

	it('member도 만들고·바꾸고·지운다. 지운 뒤에는 404 destination_not_found', async () => {
		const created = (await create({ name: 'by member', url: URL }, { as: member }).expect(201)).body as DestinationDto;
		await t.http().patch(path(owner, projectId, created.id)).set(auth(member)).send({ name: 'renamed' }).expect(200);
		await t.http().delete(path(owner, projectId, created.id)).set(auth(member)).expect(204);

		const response = await t.http().get(path(owner, projectId, created.id)).set(auth(member)).expect(404);
		expect(errorOf(response).code).toBe('destination_not_found');
	});

	it('free 조직은 project당 3개까지, 4번째는 403 plan_limit', async () => {
		for (const name of ['a', 'b', 'c']) await create({ name, url: URL }, { org: free, project: freeProjectId }).expect(201);
		const response = await create({ name: 'd', url: URL }, { org: free, project: freeProjectId }).expect(403);
		expect(errorOf(response).code).toBe('plan_limit');
	});

	it('같은 조직의 다른 project에서는 404 destination_not_found, 타 조직 project는 404 project_not_found', async () => {
		const created = (await create({ name: 'scoped', url: URL }).expect(201)).body as DestinationDto;

		// 요청은 하나씩 만든다. supertest 요청을 미리 여러 개 만들어 두면 먼저 끝난 요청이 서버를 닫는다
		for (const request of [
			() => t.http().get(path(owner, otherProjectId, created.id)),
			() => t.http().patch(path(owner, otherProjectId, created.id)).send({ name: 'x' }),
			() => t.http().delete(path(owner, otherProjectId, created.id)),
		]) {
			expect(errorOf(await request().set(auth(owner)).expect(404)).code).toBe('destination_not_found');
		}

		const foreign = await t.http().get(path(owner, freeProjectId)).set(auth(owner)).expect(404);
		expect(errorOf(foreign).code).toBe('project_not_found');
		await t.http().get(path(free, projectId)).set(auth(free)).expect(404);
	});

	it('토큰이 없으면 401', async () => {
		await t.http().get(path(owner, projectId)).expect(401);
	});

	it('목록 커서로 두 페이지 순회 후 next_cursor null', async () => {
		for (const name of ['p1', 'p2', 'p3']) await create({ name, url: URL }, { project: otherProjectId }).expect(201);
		const first = (await t.http().get(`${path(owner, otherProjectId)}?limit=2`).set(auth(member)).expect(200)).body as DestinationPageDto;
		const second = (await t.http().get(`${path(owner, otherProjectId)}?limit=2&cursor=${first.next_cursor}`).set(auth(member)).expect(200)).body as DestinationPageDto;
		expect([...first.data, ...second.data].map((d) => d.name)).toEqual(['p3', 'p2', 'p1']);
		expect(second.next_cursor).toBeNull();
	});
});
