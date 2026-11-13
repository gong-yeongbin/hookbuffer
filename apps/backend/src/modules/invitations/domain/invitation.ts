import { createHash } from 'node:crypto';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function invitationExpiresAt(now: Date): Date {
	return new Date(now.getTime() + TTL_MS);
}

// 토큰은 32바이트 난수라 느린 해시가 필요 없다. 수락 때 해시로 바로 찾아야 해서 결정적 해시를 쓴다
export function hashInvitationToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function sameEmail(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

export function invitationMail(input: { org_name: string; inviter_name: string; accept_url: string; expires_at: Date }): { subject: string; text: string } {
	return {
		subject: `[munjigi] ${input.inviter_name}님이 ${input.org_name}에 초대했습니다`,
		text: [
			`${input.inviter_name}님이 munjigi 조직 "${input.org_name}"에 초대했습니다.`,
			'',
			`아래 링크에서 이 메일 주소의 구글 계정으로 로그인한 뒤 수락하세요.`,
			input.accept_url,
			'',
			`링크는 ${input.expires_at.toISOString()}까지 유효합니다.`,
		].join('\n'),
	};
}
