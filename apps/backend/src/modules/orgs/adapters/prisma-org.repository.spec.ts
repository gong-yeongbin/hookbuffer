import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PrismaOrgRepository } from './prisma-org.repository';

// adapter는 docker compose의 postgres 위에서 통합으로 본다(`pnpm docker:up && pnpm db:deploy` 선행).
describe('PrismaOrgRepository (통합)', () => {
	const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
	const orgs = new PrismaOrgRepository(prisma);
	let userId: number;
	// [owner, admin, member, 남의 조직]
	const orgIds: number[] = [];
	const org = (i: number) => orgIds[i]!;

	beforeAll(async () => {
		userId = (await prisma.user.create({ data: { email: `${randomUUID()}@test.munjigi.local`, name: '테스트' } })).id;
		for (const role of ['owner', 'admin', 'member'] as const) {
			const created = await prisma.organization.create({ data: { name: `조직-${role}`, members: { create: { user_id: userId, role } } } });
			orgIds.push(created.id);
		}
		// 소속이 아닌 조직
		orgIds.push((await prisma.organization.create({ data: { name: '남의 조직' } })).id);
	});

	afterAll(async () => {
		await prisma.organization_member.deleteMany({ where: { user_id: userId } });
		await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
		await prisma.user.delete({ where: { id: userId } });
		await prisma.$disconnect();
	});

	it('listByMember — 소속 조직만 role과 함께 id 내림차순, cursor보다 작은 것부터 take개', async () => {
		const all = await orgs.listByMember(userId, null, 10);
		expect(all.map((o) => [o.id, o.role])).toEqual([
			[org(2), 'member'],
			[org(1), 'admin'],
			[org(0), 'owner'],
		]);

		const next = await orgs.listByMember(userId, org(2), 1);
		expect(next.map((o) => o.id)).toEqual([org(1)]);
	});

	it('findById — 행 또는 null', async () => {
		expect(await orgs.findById(org(0))).toMatchObject({ id: org(0), name: '조직-owner', plan: 'free' });
		expect(await orgs.findById(2147483647)).toBeNull();
	});

	it('update — 이름을 바꾼다', async () => {
		expect(await orgs.update(org(0), { name: '바뀐 이름' })).toMatchObject({ id: org(0), name: '바뀐 이름' });
	});
});
