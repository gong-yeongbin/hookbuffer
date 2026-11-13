import { createHmac } from 'node:crypto';
import { deliveryHeaders, type DeliveryMeta, deliveryUrl, signBody } from './delivery-request';

describe('deliveryUrl', () => {
	it('Hookdeck 문서의 예 — 받은 경로를 목적지 주소 뒤에 붙인다', () => {
		expect(deliveryUrl('https://www.example.com/webhooks', '/path/to/forward', '')).toBe('https://www.example.com/webhooks/path/to/forward');
	});

	it('경로가 없으면 목적지 주소 그대로다', () => {
		expect(deliveryUrl('https://api.example.com/webhooks', '', '')).toBe('https://api.example.com/webhooks');
		expect(deliveryUrl('https://api.example.com/', '', '')).toBe('https://api.example.com/');
	});

	it('목적지 주소가 /로 끝나도 /가 겹치지 않는다', () => {
		expect(deliveryUrl('https://api.example.com/webhooks/', '/orders/42', '')).toBe('https://api.example.com/webhooks/orders/42');
		expect(deliveryUrl('https://api.example.com/', '/orders', '')).toBe('https://api.example.com/orders');
		expect(deliveryUrl('https://api.example.com', '/orders', '')).toBe('https://api.example.com/orders');
	});

	it('받은 쿼리를 그대로 넘긴다. 인코딩을 건드리지 않는다', () => {
		expect(deliveryUrl('https://api.example.com/webhooks', '', 'key1=value1&tag=a%20b')).toBe('https://api.example.com/webhooks?key1=value1&tag=a%20b');
		expect(deliveryUrl('https://api.example.com/webhooks', '/orders', 'v=2')).toBe('https://api.example.com/webhooks/orders?v=2');
	});

	it('Hookdeck 문서의 예 — 목적지 주소에 쿼리가 있으면 받은 쿼리 대신 그것을 쓴다', () => {
		expect(deliveryUrl('https://example.com/webhooks?key2=value2', '', 'key1=value1')).toBe('https://example.com/webhooks?key2=value2');
		expect(deliveryUrl('https://example.com/webhooks?key2=value2', '/orders', 'key1=value1')).toBe('https://example.com/webhooks/orders?key2=value2');
	});
});

describe('signBody', () => {
	it('본문의 HMAC-SHA256을 base64로 적는다', () => {
		const body = Buffer.from('{"order":1}');
		expect(signBody('rdsec_key', body)).toBe(createHmac('sha256', 'rdsec_key').update(body).digest('base64'));
		expect(signBody('rdsec_key', body)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
	});

	it('본문이나 키가 다르면 서명이 다르다. 글자가 아닌 바이트도 그대로 서명한다', () => {
		const body = Buffer.from([0xff, 0xfe, 0x00]);
		expect(signBody('a', body)).not.toBe(signBody('b', body));
		expect(signBody('a', body)).not.toBe(signBody('a', Buffer.from([0xff, 0xfe, 0x01])));
	});
});

describe('deliveryHeaders', () => {
	const meta: DeliveryMeta = {
		event_id: 120n,
		delivery_id: 345n,
		attempt_count: 2,
		trigger: 'automatic',
		will_retry_after_sec: 600,
		event_url: 'https://app.munjigi.io/orgs/1/projects/10/events/120',
		source_name: 'toss',
		destination_name: 'orders',
		original_ip: '203.0.113.7',
		signature: 'c2lnbmF0dXJl',
		verified: true,
	};

	it('X-Munjigi-* 헤더 11개를 붙인다', () => {
		expect(deliveryHeaders({}, {}, meta)).toEqual({
			'x-munjigi-event-id': '120',
			'x-munjigi-delivery-id': '345',
			'x-munjigi-attempt-count': '2',
			'x-munjigi-attempt-trigger': 'automatic',
			'x-munjigi-will-retry-after': '600',
			'x-munjigi-event-url': 'https://app.munjigi.io/orgs/1/projects/10/events/120',
			'x-munjigi-source-name': 'toss',
			'x-munjigi-destination-name': 'orders',
			'x-munjigi-original-ip': '203.0.113.7',
			'x-munjigi-signature': 'c2lnbmF0dXJl',
			'x-munjigi-verified': 'true',
		});
	});

	it('마지막 시도면 will-retry-after가, 소스가 지워졌거나 IP가 없으면 그 헤더가 없다', () => {
		const headers = deliveryHeaders({}, {}, { ...meta, will_retry_after_sec: null, source_name: null, original_ip: null, verified: false });
		expect(headers).not.toHaveProperty('x-munjigi-will-retry-after');
		expect(headers).not.toHaveProperty('x-munjigi-source-name');
		expect(headers).not.toHaveProperty('x-munjigi-original-ip');
		expect(headers['x-munjigi-verified']).toBe('false');
	});

	it('한글 이름은 URL 인코딩해 보낸다', () => {
		const headers = deliveryHeaders({}, {}, { ...meta, source_name: '토스 결제', destination_name: '주문 서버' });
		expect(headers['x-munjigi-source-name']).toBe(encodeURIComponent('토스 결제'));
		expect(headers['x-munjigi-destination-name']).toBe(encodeURIComponent('주문 서버'));
		expect(headers['x-munjigi-source-name']).toMatch(/^[\x20-\x7e]+$/);
	});

	it('받은 헤더를 넘긴다. 전송 자체에 쓰이는 헤더는 넘기지 않는다', () => {
		const headers = deliveryHeaders(
			{
				'content-type': 'application/json',
				'x-hub-signature-256': 'sha256=abc',
				'user-agent': 'GitHub-Hookshot/1',
				'x-multi': ['a', 'b'],
				host: 'api.munjigi.io',
				'content-length': '11',
				connection: 'keep-alive',
				'transfer-encoding': 'chunked',
				'accept-encoding': 'gzip',
			},
			{},
			meta,
		);

		expect(headers).toMatchObject({ 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=abc', 'user-agent': 'GitHub-Hookshot/1', 'x-multi': ['a', 'b'] });
		for (const name of ['host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding']) expect(headers).not.toHaveProperty(name);
	});

	it('겹치면 destination에 설정한 헤더가 받은 헤더를 이기고, X-Munjigi-*는 누구도 덮어쓰지 못한다', () => {
		const headers = deliveryHeaders(
			{ authorization: 'Bearer from-sender', 'x-munjigi-signature': 'forged', 'x-source': 'sender' },
			{ Authorization: 'Bearer destination-token', 'X-Munjigi-Verified': 'true' },
			{ ...meta, verified: false },
		);

		expect(headers.authorization).toBe('Bearer destination-token');
		expect(headers['x-source']).toBe('sender');
		expect(headers['x-munjigi-signature']).toBe('c2lnbmF0dXJl');
		expect(headers['x-munjigi-verified']).toBe('false');
	});
});
