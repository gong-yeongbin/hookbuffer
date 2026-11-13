import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { InviteContext } from '../ports/invitation.repository';
import { PrismaInvitationRepository } from './prisma-invitation.repository';

// adapter는 docker compose의 postgres 위에서 통합으로 본다(`pnpm docker:up && pnpm db:deploy` 선행).
describe('PrismaInvitationRepository (통합)', () => {
	const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
	const invitations = new PrismaInvitationRepository(prisma);
	const now = new Date();
	const later = new Date(now.getTime() + 60_000);
	const allow = () => undefined;
	let orgId: number;
	let raceOrgId: number;
	let ownerId: number;
	let ownerEmail: string;
	let inviteeId: number;
	const email = () => `${randomUUID()}@test.munjigi.local`;
	const hash = () => randomUUID().replaceAll('-', '').padEnd(64, '0');

	beforeAll(async () => {
		ownerEmail = email();
		ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: '초대한 사람' } })).id;
		inviteeId = (await prisma.user.create({ data: { email: email(), name: '초대받은 사람' } })).id;
		orgId = (await prisma.organization.create({ data: { name: '초대 테스트', plan: 'team', members: { create: { user_id: ownerId, role: 'owner' } } } })).id;
		raceOrgId = (await prisma.organization.create({ data: { name: '동시 초대', plan: 'team', members: { create: { user_id: inviteeId, role: 'owner' } } } })).id;
	});

	afterAll(async () => {
		const orgIds = [orgId, raceOrgId];
		await prisma.invitation.deleteMany({ where: { organization_id: { in: orgIds } } });
		await prisma.organization_member.deleteMany({ where: { organization_id: { in: orgIds } } });
		await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
		await prisma.user.deleteMany({ where: { id: { in: [ownerId, inviteeId] } } });
		await prisma.$disconnect();
	});

	const input = (overrides: { email?: string; token_hash?: string; role?: 'admin' | 'member'; expires_at?: Date; organization_id?: number } = {}) => ({
		organization_id: orgId,
		email: email(),
		role: 'member' as const,
		token_hash: hash(),
		expires_at: later,
		invited_by_user_id: ownerId,
		...overrides,
	});

	it('invite — 같은 조직·이메일이면 행 하나를 교체하고, token_hash는 돌려주지 않는다', async () => {
		const address = email();
		const first = await invitations.invite(input({ email: address }), now, allow);
		const second = await invitations.invite(input({ email: address, role: 'admin' }), now, allow);

		expect(second.invitation).toMatchObject({ id: first.invitation.id, email: address, role: 'admin' });
		expect(second.invitation).not.toHaveProperty('token_hash');
	});

	it('invite — 잠근 상태의 ctx(멤버 수, 같은 이메일·만료 제외 대기 수, 이미 멤버 여부, 초대한 사람)를 check에 넘기고, 던지면 롤백', async () => {
		const target = email();
		await invitations.invite(input({ email: target }), now, allow);
		await invitations.invite(input({ expires_at: new Date(now.getTime() - 1) }), now, allow);
		const pending = await prisma.invitation.count({ where: { organization_id: orgId, email: { not: target }, expires_at: { gt: now } } });

		const seen: InviteContext[] = [];
		await invitations.invite(input({ email: target }), now, (ctx) => void seen.push(ctx));
		expect(seen).toEqual([{ org_name: '초대 테스트', plan: 'team', member_count: 1, pending_count: pending, already_member: false, inviter_name: '초대한 사람' }]);

		await invitations.invite(input({ email: ownerEmail.toUpperCase() }), now, (ctx) => void seen.push(ctx)).catch(() => undefined);
		expect(seen.at(-1)!.already_member).toBe(true);

		const rejected = email();
		await expect(
			invitations.invite(input({ email: rejected }), now, () => {
				throw new Error('limit');
			}),
		).rejects.toThrow('limit');
		expect(await prisma.invitation.count({ where: { email: rejected } })).toBe(0);
	});

	it('invite — 동시에 들어와도 잠금으로 줄 서서 상한을 넘지 않는다', async () => {
		// 커넥션을 미리 열어 둔다. 안 그러면 경합이 생기지 않아 잠금이 없어도 통과한다
		await Promise.all(Array.from({ length: 10 }, () => prisma.$queryRaw`SELECT pg_sleep(0.05)::text`));
		// 멤버 1명 + 대기 초대가 2를 넘지 못하게
		const limit = (ctx: InviteContext) => {
			if (ctx.member_count + ctx.pending_count + 1 > 2) throw new Error('limit');
		};
		const results = await Promise.allSettled(Array.from({ length: 10 }, () => invitations.invite(input({ organization_id: raceOrgId }), now, limit)));

		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(await prisma.invitation.count({ where: { organization_id: raceOrgId } })).toBe(1);
	});

	it('list·remove — id 내림차순, 타 조직 id는 지우지 않는다', async () => {
		const { invitation: created } = await invitations.invite(input(), now, allow);
		const listed = await invitations.list(orgId, null, 100);
		expect(listed[0]!.id).toBe(created.id);
		expect(listed.every((r) => !('token_hash' in r))).toBe(true);
		expect((await invitations.list(orgId, created.id, 100)).every((r) => r.id < created.id)).toBe(true);

		expect(await invitations.remove(orgId + 1_000_000, created.id)).toBe(false);
		expect(await invitations.remove(orgId, created.id)).toBe(true);
	});

	it('findByTokenHash·findUserEmail·accept — 멤버를 만들고 초대를 지운다, 이미 멤버면 기존 행', async () => {
		const token_hash = hash();
		await invitations.invite(input({ token_hash, role: 'admin' }), now, allow);
		const found = (await invitations.findByTokenHash(token_hash))!;

		expect(await invitations.findUserEmail(ownerId)).toBe(ownerEmail);
		expect(await invitations.findUserEmail(2147483647)).toBeNull();
		expect(await invitations.accept(found, inviteeId)).toMatchObject({ organization_id: orgId, user_id: inviteeId, role: 'admin' });
		expect(await invitations.findByTokenHash(token_hash)).toBeNull();

		const again = hash();
		await invitations.invite(input({ token_hash: again }), now, allow);
		expect(await invitations.accept((await invitations.findByTokenHash(again))!, inviteeId)).toMatchObject({ role: 'admin' });
	});
});
