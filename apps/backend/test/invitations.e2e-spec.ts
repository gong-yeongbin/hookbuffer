import { randomUUID } from 'node:crypto';
import type { InvitationDto, InvitationPageDto } from '@/modules/invitations/dto/list-invitations.dto';
import type { MemberPageDto } from '@/modules/members/dto/list-members.dto';
import { createTestApp, errorOf, type LoggedIn, type TestApp } from './support';

describe('invitations (e2e)', () => {
	let t: TestApp;
	let owner: LoggedIn;

	const auth = (who: LoggedIn) => ({ Authorization: `Bearer ${who.token}` });
	const invitations = () => `/orgs/${owner.org_id}/invitations`;
	const invite = (email: string, role = 'member') => t.http().post(invitations()).set(auth(owner)).send({ email, role });
	// 가장 최근에 그 주소로 보낸 메일의 수락 토큰
	const tokenFor = (email: string) => {
		const mail = t.mails.filter((m) => m.to === email).at(-1)!;
		return /\/invitations\/(\S+)/.exec(mail.text)![1]!;
	};

	beforeAll(async () => {
		t = await createTestApp();
		owner = await t.login();
		await t.prisma.organization.update({ where: { id: owner.org_id }, data: { plan: 'team' } });
	});

	afterAll(() => t.close());

	it('초대 → 메일의 링크 토큰으로 수락 → 멤버 목록에 등장, 초대는 사라진다', async () => {
		const invitee = await t.login();

		const created = (await invite(invitee.profile.email.toUpperCase(), 'admin').expect(201)).body as InvitationDto;
		expect(created).toMatchObject({ email: invitee.profile.email, role: 'admin' });
		expect(created).not.toHaveProperty('token_hash');
		expect(t.mails.at(-1)!.text).toContain(`http://localhost:5173/invitations/`);

		const accepted = await t.http().post(`/invitations/${tokenFor(invitee.profile.email)}/accept`).set(auth(invitee)).expect(200);
		expect(accepted.body).toMatchObject({ organization_id: owner.org_id, user_id: invitee.user_id, role: 'admin' });

		const members = (await t.http().get(`/orgs/${owner.org_id}/members`).set(auth(invitee)).expect(200)).body as MemberPageDto;
		expect(members.data.map((m) => m.user_id)).toContain(invitee.user_id);
		const pending = (await t.http().get(invitations()).set(auth(owner)).expect(200)).body as InvitationPageDto;
		expect(pending.data.map((i) => i.email)).not.toContain(invitee.profile.email);
	});

	it('다른 이메일 계정으로 수락하면 403, 만료된 초대 수락은 404', async () => {
		const address = `${randomUUID()}@test.hookbuffer.local`;
		await invite(address).expect(201);
		const stranger = await t.login();

		const mismatch = await t.http().post(`/invitations/${tokenFor(address)}/accept`).set(auth(stranger)).expect(403);
		expect(errorOf(mismatch).code).toBe('forbidden');

		await t.prisma.invitation.updateMany({ where: { email: address }, data: { expires_at: new Date(Date.now() - 1000) } });
		const expired = await t.http().post(`/invitations/${tokenFor(address)}/accept`).set(auth(stranger)).expect(404);
		expect(errorOf(expired).code).toBe('invitation_not_found');
	});

	it('이미 멤버인 이메일 초대는 409 member_conflict', async () => {
		const response = await invite(owner.profile.email).expect(409);
		expect(errorOf(response).code).toBe('member_conflict');
	});

	it('수락은 로그인이 필요하다(401)', async () => {
		await t.http().post('/invitations/whatever/accept').expect(401);
	});

	it('member는 초대할 수 없다(403), 초대 취소는 204 후 404', async () => {
		const member = await t.login();
		await t.prisma.organization_member.create({ data: { organization_id: owner.org_id, user_id: member.user_id, role: 'member' } });
		await t.http().post(invitations()).set(auth(member)).send({ email: 'x@test.hookbuffer.local', role: 'member' }).expect(403);

		const created = (await invite(`${randomUUID()}@test.hookbuffer.local`).expect(201)).body as InvitationDto;
		await t.http().delete(`${invitations()}/${created.id}`).set(auth(owner)).expect(204);
		const gone = await t.http().delete(`${invitations()}/${created.id}`).set(auth(owner)).expect(404);
		expect(errorOf(gone).code).toBe('invitation_not_found');
	});

	it('plan=free 조직의 초대 403 plan_limit', async () => {
		const solo = await t.login();
		const response = await t.http().post(`/orgs/${solo.org_id}/invitations`).set(auth(solo)).send({ email: 'x@test.hookbuffer.local', role: 'member' }).expect(403);
		expect(errorOf(response).code).toBe('plan_limit');
	});

	it('유료 조직은 멤버 상한이 없어 11번째 초대도 201', async () => {
		const lead = await t.login();
		await t.prisma.organization.update({ where: { id: lead.org_id }, data: { plan: 'team' } });
		const path = `/orgs/${lead.org_id}/invitations`;
		for (let i = 0; i < 11; i++) await t.http().post(path).set(auth(lead)).send({ email: `${randomUUID()}@test.hookbuffer.local`, role: 'member' }).expect(201);
	});
});
