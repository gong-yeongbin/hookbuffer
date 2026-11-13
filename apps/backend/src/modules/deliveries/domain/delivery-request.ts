import { createHmac } from 'node:crypto';
import type { AttemptTrigger } from '@prisma/client';

// 목적지로 보내는 요청을 조립한다. 받은 요청 방식·경로·쿼리·헤더·본문을 그대로 넘기고 X-Munjigi-* 헤더를 붙인다.
// Hookdeck의 전달 요청과 같은 모양이다. 근거는 context-notes.md "전달 정책"

type Headers = Record<string, string | string[]>;

// 전송 자체에 쓰이는 헤더. 받은 값을 넘기지 않고 목적지에 맞게 새로 만들어진다.
// accept-encoding을 넘기면 목적지가 압축해 답해서 응답 본문 기록이 깨진다
const NOT_FORWARDED = new Set([
	'host',
	'content-length',
	'connection',
	'keep-alive',
	'transfer-encoding',
	'upgrade',
	'te',
	'trailer',
	'expect',
	'proxy-authorization',
	'proxy-authenticate',
	'accept-encoding',
]);

// 목적지 주소 뒤에 받은 경로를 붙이고 쿼리를 넘긴다. 목적지 주소에 쿼리가 있으면 받은 쿼리 대신 그것을 쓴다.
// 예: https://example.com/webhooks + /path/to/forward + key=1 → https://example.com/webhooks/path/to/forward?key=1
export function deliveryUrl(destinationUrl: string, path: string, query: string): string {
	const mark = destinationUrl.indexOf('?');
	const base = mark < 0 ? destinationUrl : destinationUrl.slice(0, mark);
	const ownQuery = mark < 0 ? '' : destinationUrl.slice(mark + 1);
	const finalQuery = ownQuery !== '' ? ownQuery : query;
	// 받은 경로가 /로 시작하므로 목적지 주소 끝의 /는 뗀다
	const joined = path === '' ? base : base.replace(/\/$/, '') + path;
	return finalQuery === '' ? joined : `${joined}?${finalQuery}`;
}

// 본문의 HMAC-SHA256을 base64로 적는다(X-Munjigi-Signature). 고객 서버가 같은 키로 계산해 비교한다
export function signBody(secret: string, body: Buffer): string {
	return createHmac('sha256', secret).update(body).digest('base64');
}

export type DeliveryMeta = {
	event_id: bigint;
	delivery_id: bigint;
	// 이번이 몇 번째 시도인지(1부터)
	attempt_count: number;
	trigger: AttemptTrigger;
	// 이번에 실패하면 몇 초 뒤에 다시 보낼지. 마지막 시도면 null
	will_retry_after_sec: number | null;
	event_url: string;
	// 소스가 지워졌으면 null
	source_name: string | null;
	destination_name: string;
	original_ip: string | null;
	signature: string;
	// 받을 때 서명을 확인했는가
	verified: boolean;
};

// 이름에는 한글이 들어갈 수 있는데 HTTP 헤더 값에는 넣을 수 없다. URL 인코딩해 보낸다
const headerSafe = (value: string) => encodeURIComponent(value);

// 헤더가 겹치면 뒤쪽이 이긴다: 받은 헤더 < destination에 설정한 헤더 < X-Munjigi-*
export function deliveryHeaders(original: Headers, destination: Record<string, string>, meta: DeliveryMeta): Headers {
	const headers: Headers = {};
	for (const [name, value] of Object.entries(original)) {
		if (!NOT_FORWARDED.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
	}
	for (const [name, value] of Object.entries(destination)) headers[name.toLowerCase()] = value;

	headers['x-munjigi-event-id'] = meta.event_id.toString();
	headers['x-munjigi-delivery-id'] = meta.delivery_id.toString();
	headers['x-munjigi-attempt-count'] = String(meta.attempt_count);
	headers['x-munjigi-attempt-trigger'] = meta.trigger;
	if (meta.will_retry_after_sec !== null) headers['x-munjigi-will-retry-after'] = String(meta.will_retry_after_sec);
	headers['x-munjigi-event-url'] = meta.event_url;
	if (meta.source_name !== null) headers['x-munjigi-source-name'] = headerSafe(meta.source_name);
	headers['x-munjigi-destination-name'] = headerSafe(meta.destination_name);
	if (meta.original_ip !== null) headers['x-munjigi-original-ip'] = meta.original_ip;
	headers['x-munjigi-signature'] = meta.signature;
	headers['x-munjigi-verified'] = String(meta.verified);
	return headers;
}
