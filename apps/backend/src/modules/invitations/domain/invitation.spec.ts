import { hashInvitationToken, invitationExpiresAt, invitationMail, sameEmail } from './invitation';

describe('invitation domain', () => {
	it('만료는 7일 뒤', () => {
		expect(invitationExpiresAt(new Date('2026-09-30T00:00:00Z'))).toEqual(new Date('2026-10-07T00:00:00Z'));
	});

	it('토큰 해시는 SHA-256 hex 64자이고 같은 입력이면 같다', () => {
		const hash = hashInvitationToken('abc');
		expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(hashInvitationToken('abc')).toBe(hash);
	});

	it('이메일은 대소문자를 무시하고 비교한다', () => {
		expect(sameEmail('Kim@Example.com', 'kim@example.com')).toBe(true);
		expect(sameEmail('kim@example.com', 'lee@example.com')).toBe(false);
	});

	it('초대 메일 — 조직·초대한 사람·수락 링크·만료 시각을 담는다', () => {
		const mail = invitationMail({
			org_name: '결제팀',
			inviter_name: '홍길동',
			accept_url: 'https://app.munjigi.dev/invitations/tok',
			expires_at: new Date('2026-10-07T00:00:00Z'),
		});
		expect(mail.subject).toBe('[munjigi] 홍길동님이 결제팀에 초대했습니다');
		expect(mail.text).toContain('https://app.munjigi.dev/invitations/tok');
		expect(mail.text).toContain('2026-10-07T00:00:00.000Z');
	});
});
