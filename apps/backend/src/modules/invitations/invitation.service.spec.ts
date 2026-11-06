import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { invitation, organization_member, Plan } from '@prisma/client';
import type { Actor } from '@/common/auth/decorators';
import { hashInvitationToken } from './domain/invitation';
import { InvitationService } from './invitation.service';
import type { InvitationRepository, InvitationView, InviteContext, InviteInput } from './ports/invitation.repository';
import type { Mail, Mailer } from './ports/mailer';

const ORG = 1;
const DAY = 24 * 60 * 60 * 1000;

// port를 in-memory fake로 둔다. 근거는 context-notes.md "계층별 테스트".
class FakeInvitations implements InvitationRepository {
	plan: Plan = 'team';
	members = new Map<number, string>([[1, 'owner@example.com']]);
	rows: invitation[] = [];
	nextId = 1;

	invite(data: InviteInput, now: Date, check: (ctx: InviteContext) => void) {
		const ctx: InviteContext = {
			org_name: '결제팀',
			plan: this.plan,
			member_count: this.members.size,
			pending_count: this.rows.filter((r) => r.email !== data.email && r.expires_at > now).length,
			already_member: [...this.members.values()].includes(data.email),
			inviter_name: '홍길동',
		};
		check(ctx);
		const existing = this.rows.find((r) => r.email === data.email);
		const row = { ...(existing ?? { id: this.nextId++, created_at: new Date(0) }), ...data, updated_at: new Date(0) };
		this.rows = [...this.rows.filter((r) => r !== existing), row];
		const view: Partial<invitation> = { ...row };
		delete view.token_hash;
		return Promise.resolve({ invitation: view as InvitationView, ctx });
	}
	list(_orgId: number, cursor: number | null, take: number) {
		const rows = this.rows.filter((r) => cursor === null || r.id < cursor).sort((a, b) => b.id - a.id);
		return Promise.resolve(rows.slice(0, take));
	}
	remove(_orgId: number, id: number) {
		const before = this.rows.length;
		this.rows = this.rows.filter((r) => r.id !== id);
		return Promise.resolve(this.rows.length < before);
	}
	findByTokenHash(tokenHash: string) {
		return Promise.resolve(this.rows.find((r) => r.token_hash === tokenHash) ?? null);
	}
	findUserEmail(userId: number) {
		return Promise.resolve(this.members.get(userId) ?? (userId === 9 ? 'Kim@Example.com' : null));
	}
	accept(inv: invitation, userId: number): Promise<organization_member> {
		this.rows = this.rows.filter((r) => r.id !== inv.id);
		return Promise.resolve({ organization_id: ORG, user_id: userId, role: inv.role, created_at: new Date(0), updated_at: new Date(0) });
	}
}

class FakeMailer implements Mailer {
	sent: Mail[] = [];
	send(mail: Mail) {
		this.sent.push(mail);
		return Promise.resolve();
	}
}

const admin: Actor = { kind: 'user', user_id: 1, org_id: ORG, role: 'admin' };
const invitee = (user_id: number): Actor => ({ kind: 'user', user_id, org_id: null, role: null });
const tokenOf = (mail: Mail) => /\/invitations\/(\S+)/.exec(mail.text)![1]!;

async function errorOf(promise: Promise<unknown>) {
	const error = await promise.catch((e: unknown) => e);
	return { type: (error as object).constructor, body: (error as ForbiddenException).getResponse() as { code: string } };
}

describe('InvitationService', () => {
	let repo: FakeInvitations;
	let mailer: FakeMailer;
	let service: InvitationService;

	beforeEach(() => {
		repo = new FakeInvitations();
		mailer = new FakeMailer();
		service = new InvitationService(repo, mailer, 'https://app.test');
	});

	describe('create', () => {
		it('소문자 이메일로 저장하고, 원문 토큰은 메일 링크에만 담고 해시를 저장한다', async () => {
			const created = await service.create(admin, ORG, { email: 'Kim@Example.com', role: 'member' });

			expect(created).toMatchObject({ email: 'kim@example.com', role: 'member', invited_by_user_id: 1 });
			expect(created).not.toHaveProperty('token_hash');
			expect(mailer.sent).toHaveLength(1);
			expect(mailer.sent[0]).toMatchObject({ to: 'kim@example.com', subject: '[hookbuffer] 홍길동님이 결제팀에 초대했습니다' });
			expect(mailer.sent[0]!.text).toContain('https://app.test/invitations/');
			expect(repo.rows[0]!.token_hash).toBe(hashInvitationToken(tokenOf(mailer.sent[0]!)));
		});

		it('만료는 7일 뒤', async () => {
			const before = Date.now();
			const created = await service.create(admin, ORG, { email: 'kim@example.com', role: 'member' });
			expect(created.expires_at.getTime() - before).toBeGreaterThanOrEqual(7 * DAY);
			expect(created.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(7 * DAY);
		});

		it('같은 이메일을 다시 초대하면 행 하나를 새 토큰으로 바꾸고 메일을 다시 보낸다', async () => {
			await service.create(admin, ORG, { email: 'kim@example.com', role: 'member' });
			await service.create(admin, ORG, { email: 'kim@example.com', role: 'admin' });

			expect(repo.rows).toHaveLength(1);
			expect(repo.rows[0]!.role).toBe('admin');
			expect(repo.rows[0]!.token_hash).toBe(hashInvitationToken(tokenOf(mailer.sent[1]!)));
			expect(tokenOf(mailer.sent[0]!)).not.toBe(tokenOf(mailer.sent[1]!));
		});

		it('이미 멤버인 이메일은 409 member_conflict, 메일을 보내지 않는다', async () => {
			expect(await errorOf(service.create(admin, ORG, { email: 'owner@example.com', role: 'member' }))).toEqual({
				type: ConflictException,
				body: expect.objectContaining({ code: 'member_conflict' }) as object,
			});
			expect(mailer.sent).toHaveLength(0);
		});

		it('멤버 + 대기 초대 + 1이 상한을 넘으면 403 plan_limit', async () => {
			repo.plan = 'free';
			expect(await errorOf(service.create(admin, ORG, { email: 'kim@example.com', role: 'member' }))).toEqual({
				type: ForbiddenException,
				body: expect.objectContaining({ code: 'plan_limit' }) as object,
			});

			// 유료는 상한이 없다
			repo.plan = 'team';
			for (let i = 0; i < 11; i++) await service.create(admin, ORG, { email: `u${i}@example.com`, role: 'member' });
		});
	});

	it('list — id 내림차순 페이지', async () => {
		for (const email of ['a@x.com', 'b@x.com', 'c@x.com']) await service.create(admin, ORG, { email, role: 'member' });
		const page = await service.list(ORG, { limit: 2 });
		expect(page.data.map((r) => r.email)).toEqual(['c@x.com', 'b@x.com']);
		expect(page.next_cursor).toBe('2');
	});

	it('cancel — 지우거나, 없으면 404 invitation_not_found', async () => {
		const created = await service.create(admin, ORG, { email: 'kim@example.com', role: 'member' });
		await service.cancel(ORG, created.id);
		expect(repo.rows).toHaveLength(0);
		expect((await errorOf(service.cancel(ORG, created.id))).body.code).toBe('invitation_not_found');
	});

	describe('accept', () => {
		it('로그인 계정 이메일이 초대 이메일과 같으면(대소문자 무시) 멤버가 되고 초대는 사라진다', async () => {
			await service.create(admin, ORG, { email: 'kim@example.com', role: 'admin' });

			expect(await service.accept(invitee(9), tokenOf(mailer.sent[0]!))).toMatchObject({ organization_id: ORG, user_id: 9, role: 'admin' });
			expect(repo.rows).toHaveLength(0);
		});

		it('다른 이메일 계정이면 403, 초대는 남는다', async () => {
			await service.create(admin, ORG, { email: 'lee@example.com', role: 'member' });

			expect(await errorOf(service.accept(invitee(9), tokenOf(mailer.sent[0]!)))).toEqual({
				type: ForbiddenException,
				body: expect.objectContaining({ code: 'forbidden' }) as object,
			});
			expect(repo.rows).toHaveLength(1);
		});

		it('없는 토큰·만료된 초대는 404 invitation_not_found', async () => {
			expect(await errorOf(service.accept(invitee(9), 'nope'))).toEqual({
				type: NotFoundException,
				body: expect.objectContaining({ code: 'invitation_not_found' }) as object,
			});

			await service.create(admin, ORG, { email: 'kim@example.com', role: 'member' });
			repo.rows[0]!.expires_at = new Date(Date.now() - 1);
			expect((await errorOf(service.accept(invitee(9), tokenOf(mailer.sent[0]!)))).type).toBe(NotFoundException);
		});
	});
});
