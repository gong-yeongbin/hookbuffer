import { randomBytes } from 'node:crypto';

export const SIGNING_SECRET_PREFIX = 'rdsec_';

// 전달 요청에 찍는 서명(X-Munjigi-Signature)의 키. 고객 서버가 같은 키로 본문의 HMAC-SHA256을 계산해 비교한다
export function newSigningSecret(): string {
	return `${SIGNING_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}
