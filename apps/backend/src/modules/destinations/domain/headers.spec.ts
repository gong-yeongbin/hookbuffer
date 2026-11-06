import { headersSchema, maskHeaders } from './headers';

describe('headersSchema', () => {
	it('이름 → 값 객체를 받는다. 빈 객체도 된다', () => {
		expect(headersSchema.safeParse({ Authorization: 'Bearer t', 'X-Source': 'hookbuffer' }).success).toBe(true);
		expect(headersSchema.safeParse({}).success).toBe(true);
	});

	it.each([
		['이름에 허용되지 않는 문자', { 'x source': 'a' }],
		['값이 문자열이 아님', { 'x-count': 1 }],
		['값에 줄바꿈', { 'x-a': 'a\r\nx-injected: 1' }],
		['21개', Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`x-${i}`, 'v']))],
		['객체가 아님', 'Authorization: Bearer t'],
	])('거부 — %s', (_name, value) => {
		expect(headersSchema.safeParse(value).success).toBe(false);
	});
});

describe('maskHeaders', () => {
	it('비밀로 보이는 이름의 값만 가리고, 방식(Bearer 등)은 남긴다', () => {
		expect(
			maskHeaders({
				Authorization: 'Bearer abc.def',
				'X-Api-Key': 'k-123',
				'x-webhook-secret': 's',
				'X-Auth-Token': 't',
				Cookie: 'sid=1',
				'X-Source': 'hookbuffer',
			}),
		).toEqual({
			Authorization: 'Bearer ****',
			'X-Api-Key': '****',
			'x-webhook-secret': '****',
			'X-Auth-Token': '****',
			Cookie: '****',
			'X-Source': 'hookbuffer',
		});
	});

	it('빈 객체는 빈 객체', () => {
		expect(maskHeaders({})).toEqual({});
	});
});
