import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PrismaMemberRepository } from './prisma-member.repository';

// adapter는 docker compose의 postgres 위에서 통합으로 본다(`pnpm docker:up && pnpm db:deploy` 선행).
describe('PrismaMemberRepository (통합)', () => {
	const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
	const members = new PrismaMemberRepository(prisma);
	let orgId: number;
	// [owner, admin, member]
	const userIds: number[] = [];
	const user = (i: number) => userIds[i]!;

	beforeAll(async () => {
		orgId = (await prisma.organization.create({ data: { name: '멤버 테스트', plan: 'team' } })).id;
		for (const role of ['owner', 'admin', 'member'] as const) {
			const created = await prisma.user.create({ data: { email: `${randomUUID()}@test.hookbuffer.local`, name: role } });
			await prisma.organization_member.create({ data: { organization_id: orgId, user_id: created.id, role } });
			userIds.push(created.id);
		}
	});

	afterAll(async () => {
		await prisma.organization_member.deleteMany({ where: { organization_id: orgId } });
		await prisma.organization.delete({ where: { id: orgId } });
		await prisma.user.deleteMany({ where: { id: { in: userIds } } });
		await prisma.$disconnect();
	});

	it('list — user_id 내림차순, 유저 정보 포함, cursor보다 작은 것부터 take개', async () => {
		const all = await members.list(orgId, null, 10);
		expect(all.map((m) => [m.user_id, m.role])).toEqual([
			[user(2), 'member'],
			[user(1), 'admin'],
			[user(0), 'owner'],
		]);
		expect(all[0]!.user).toEqual({ id: user(2), email: expect.stringContaining('@test.hookbuffer.local') as string, name: 'member', avatar_url: null });

		expect((await members.list(orgId, user(2), 1)).map((m) => m.user_id)).toEqual([user(1)]);
	});

	it('find — 행 또는 null', async () => {
		expect(await members.find(orgId, user(0))).toMatchObject({ user_id: user(0), role: 'owner' });
		expect(await members.find(orgId, 2147483647)).toBeNull();
	});

	it('updateRole — 바뀐 행을 유저 정보와 함께 준다', async () => {
		expect(await members.updateRole(orgId, user(2), 'admin')).toMatchObject({ user_id: user(2), role: 'admin', user: { name: 'member' } });
	});

	it('remove — 행을 지운다', async () => {
		await members.remove(orgId, user(2));
		expect(await members.find(orgId, user(2))).toBeNull();
	});
});
