import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { Connection } from '@/api/connections';
import type { DeliveryAttempt, DeliveryDetail } from '@/api/deliveries';
import type { Destination } from '@/api/destinations';
import type { Invitation, Me, Member } from '@/api/orgs';
import type { Event, EventDetail, Source } from '@/api/events';
import type { Org, Project } from '@/api/projects';
import type { RejectedRequest } from '@/api/rejected';
import type { Usage } from '@/api/usage';

// 테스트용 백엔드. 실제 응답 모양(snake_case, BigInt는 문자열)을 그대로 따른다
export const ORG: Org = { id: 1, name: '내 조직', plan: 'team', role: 'owner' };
export const PROJECT: Project = { id: 10, organization_id: 1, name: 'shop', suspended_at: null };
export const SOURCES: Source[] = [{ id: 7, project_id: 10, slug: 'abcdefghij0123456789', name: '토스 결제', signature_config: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }];
export const EVENTS: Event[] = [
	{ id: '121', project_id: 10, source_id: 7, idempotency_key: 'id:b', method: 'POST', path: '/orders/42', query: 'v=2', source_ip: '203.0.113.7', verified: true, headers: { 'content-type': 'application/json', 'x-toss-event': 'PAYMENT' }, content_type: 'application/json', size: 18, received_at: '2026-10-15T03:00:00.000Z' },
	{ id: '120', project_id: 10, source_id: null, idempotency_key: 'sha256:a', method: 'POST', path: '', query: '', source_ip: null, verified: false, headers: {}, content_type: null, size: 2, received_at: '2026-10-14T03:00:00.000Z' },
];
export const DETAIL: EventDetail = {
	...EVENTS[0]!,
	deliveries: [
		{ id: '900', event_id: '121', destination_id: 3, connection_id: 1, status: 'failed', attempt: 2, next_attempt_at: '2026-10-15T03:10:00.000Z', last_status_code: 503, last_error: null, created_at: '2026-10-15T03:00:00.000Z', updated_at: '2026-10-15T03:05:00.000Z' },
		{ id: '901', event_id: '121', destination_id: null, connection_id: null, status: 'canceled', attempt: 0, next_attempt_at: null, last_status_code: null, last_error: null, created_at: '2026-10-15T03:00:00.000Z', updated_at: '2026-10-15T03:00:00.000Z' },
	],
};

export const DESTINATIONS: Destination[] = [{ id: 3, project_id: 10, name: '고객 서버', url: 'https://api.shop.example/hooks', headers: {}, timeout_ms: 10000, concurrency: 2, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }];
export const ATTEMPTS: DeliveryAttempt[] = [
	{ id: '1', delivery_id: '900', attempt_no: 1, trigger: 'initial', status_code: 503, error: null, duration_ms: 120, response_body: 'upstream down', attempted_at: '2026-10-15T03:00:01.000Z' },
	{ id: '2', delivery_id: '900', attempt_no: 2, trigger: 'automatic', status_code: null, error: 'ECONNREFUSED', duration_ms: 5, response_body: null, attempted_at: '2026-10-15T03:05:00.000Z' },
];
export const DELIVERY_DETAIL: DeliveryDetail = { ...DETAIL.deliveries[0]!, attempts: ATTEMPTS };

export const CONNECTIONS: Connection[] = [
	{ id: 1, source_id: 7, destination_id: 3, retry_strategy: 'exponential', retry_interval_ms: 300000, retry_count: 9, paused_at: null, created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' },
	{ id: 2, source_id: 7, destination_id: 99, retry_strategy: 'linear', retry_interval_ms: 60000, retry_count: 3, paused_at: '2026-10-10T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-10T00:00:00.000Z' },
];

export const ME: Me = { id: 1, email: 'seed@hookbuffer.local', name: '시드', avatar_url: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' };
export const MEMBERS: Member[] = [
	{ organization_id: 1, user_id: 1, role: 'owner', created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z', user: { id: 1, email: 'seed@hookbuffer.local', name: '시드', avatar_url: null } },
	{ organization_id: 1, user_id: 2, role: 'member', created_at: '2026-09-05T00:00:00.000Z', updated_at: '2026-09-05T00:00:00.000Z', user: { id: 2, email: 'kim@company.com', name: '김개발', avatar_url: null } },
];
export const INVITATIONS: Invitation[] = [{ id: 5, organization_id: 1, email: 'lee@company.com', role: 'member', expires_at: '2099-01-01T00:00:00.000Z', invited_by_user_id: 1, created_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-10T00:00:00.000Z' }];

export const USAGE: Usage = { period: '202610', period_start: '2026-09-30T15:00:00.000Z', plan: 'team', included: 10000, used: 1284, projects: [{ project_id: 10, name: 'shop', event_count: 812 }, { project_id: 11, name: 'blog', event_count: 0 }] };

export const REJECTED: RejectedRequest[] = [
	{ id: '51', project_id: 10, source_id: 7, reason: 'signature_mismatch', headers: { 'x-signature': 'bad' }, size: 11, received_at: '2026-10-15T02:00:00.000Z' },
	{ id: '50', project_id: 10, source_id: null, reason: 'no_connection', headers: {}, size: 2, received_at: '2026-10-14T02:00:00.000Z' },
];

const page = <T,>(data: T[], next_cursor: string | null = null) => HttpResponse.json({ data, next_cursor });

export const handlers = [
	http.get('/api/orgs', () => page([ORG])),
	http.get('/api/users/me', () => HttpResponse.json(ME)),
	http.get('/api/orgs/1/usage', () => HttpResponse.json(USAGE)),
	http.patch('/api/orgs/1', async ({ request }) => HttpResponse.json({ ...ORG, ...((await request.json()) as object) })),
	http.get('/api/orgs/1/members', () => page(MEMBERS)),
	http.patch('/api/orgs/1/members/:userId', async ({ request }) => HttpResponse.json({ ...MEMBERS[1], ...((await request.json()) as object) })),
	http.delete('/api/orgs/1/members/:userId', () => new HttpResponse(null, { status: 204 })),
	http.get('/api/orgs/1/invitations', () => page(INVITATIONS)),
	http.post('/api/orgs/1/invitations', async ({ request }) => HttpResponse.json({ ...INVITATIONS[0], id: 6, ...((await request.json()) as object) }, { status: 201 })),
	http.delete('/api/orgs/1/invitations/:id', () => new HttpResponse(null, { status: 204 })),
	http.post('/api/invitations/:token/accept', ({ params }) => (params.token === 'good' ? HttpResponse.json({ organization_id: 1, user_id: 1, role: 'member' }) : HttpResponse.json({ code: 'invitation_email_mismatch', message: '초대받은 이메일로 로그인하세요.' }, { status: 403 }))),
	http.get('/api/orgs/1/projects', () => page([PROJECT])),
	http.post('/api/orgs/1/projects', async ({ request }) => {
		const { name } = (await request.json()) as { name: string };
		return HttpResponse.json({ ...PROJECT, id: 11, name }, { status: 201 });
	}),
	http.patch('/api/orgs/1/projects/10', async ({ request }) => HttpResponse.json({ ...PROJECT, ...((await request.json()) as object) })),
	http.delete('/api/orgs/1/projects/10', () => new HttpResponse(null, { status: 204 })),
	http.get('/api/orgs/1/projects/10/signing-secret', () => HttpResponse.json({ signing_secret: 'whsec_seed_secret' })),
	http.post('/api/orgs/1/projects/10/signing-secret/rotate', () => HttpResponse.json({ signing_secret: 'whsec_rotated' })),
	http.get('/api/orgs/1/projects/10/sources', () => page(SOURCES)),
	http.get('/api/orgs/1/projects/10/events', ({ request }) => {
		const url = new URL(request.url);
		const cursor = url.searchParams.get('cursor');
		const sourceId = url.searchParams.get('source_id');
		if (cursor === '120') return page([]);
		const rows = sourceId ? EVENTS.filter((e) => String(e.source_id) === sourceId) : EVENTS;
		return page(rows, sourceId ? null : '120');
	}),
	http.get('/api/orgs/1/projects/10/rejected-requests', ({ request }) => {
		const reason = new URL(request.url).searchParams.get('reason');
		return page(reason ? REJECTED.filter((r) => r.reason === reason) : REJECTED);
	}),
	http.get('/api/orgs/1/projects/10/destinations', () => page(DESTINATIONS)),
	http.post('/api/orgs/1/projects/10/destinations', async ({ request }) => HttpResponse.json({ ...DESTINATIONS[0], id: 4, ...((await request.json()) as object) }, { status: 201 })),
	http.patch('/api/orgs/1/projects/10/destinations/:id', async ({ request }) => HttpResponse.json({ ...DESTINATIONS[0], ...((await request.json()) as object) })),
	http.delete('/api/orgs/1/projects/10/destinations/:id', () => new HttpResponse(null, { status: 204 })),
	http.post('/api/orgs/1/projects/10/sources', async ({ request }) => HttpResponse.json({ ...SOURCES[0], id: 9, slug: 'newslug', ...((await request.json()) as object) }, { status: 201 })),
	http.patch('/api/orgs/1/projects/10/sources/:id', async ({ request }) => HttpResponse.json({ ...SOURCES[0], ...((await request.json()) as object) })),
	http.post('/api/orgs/1/projects/10/sources/:id/rotate-slug', () => HttpResponse.json({ ...SOURCES[0], slug: 'rotated' })),
	http.delete('/api/orgs/1/projects/10/sources/:id', () => new HttpResponse(null, { status: 204 })),
	http.get('/api/orgs/1/projects/10/connections', () => page(CONNECTIONS)),
	http.post('/api/orgs/1/projects/10/connections', async ({ request }) => {
		const body = (await request.json()) as Partial<Connection>;
		return HttpResponse.json({ ...CONNECTIONS[0], id: 3, ...body }, { status: 201 });
	}),
	http.patch('/api/orgs/1/projects/10/connections/:id', async ({ request }) => HttpResponse.json({ ...CONNECTIONS[0], ...((await request.json()) as object) })),
	http.post('/api/orgs/1/projects/10/connections/:id/pause', () => HttpResponse.json({ ...CONNECTIONS[0], paused_at: '2026-10-16T00:00:00.000Z' })),
	http.post('/api/orgs/1/projects/10/connections/:id/unpause', () => HttpResponse.json({ ...CONNECTIONS[1], paused_at: null })),
	http.delete('/api/orgs/1/projects/10/connections/:id', () => new HttpResponse(null, { status: 204 })),
	http.get('/api/orgs/1/projects/10/deliveries', ({ request }) => {
		const url = new URL(request.url);
		if (url.searchParams.get('cursor') === '901') return page([]);
		const status = url.searchParams.get('status');
		const destination = url.searchParams.get('destination_id');
		const rows = DETAIL.deliveries.filter((d) => (!status || d.status === status) && (!destination || String(d.destination_id) === destination));
		return page(rows, status || destination ? null : '901');
	}),
	http.get('/api/orgs/1/projects/10/deliveries/900', () => HttpResponse.json(DELIVERY_DETAIL)),
	http.post('/api/orgs/1/projects/10/deliveries/900/retry', () => HttpResponse.json({ ...DETAIL.deliveries[0], status: 'pending' })),
	http.post('/api/orgs/1/projects/10/deliveries/900/cancel', () => HttpResponse.json({ ...DETAIL.deliveries[0], status: 'canceled' })),
	http.post('/api/orgs/1/projects/10/deliveries/retry', async ({ request }) => {
		const body = (await request.json()) as { status?: string };
		return body.status ? HttpResponse.json({ count: 10 }) : HttpResponse.json({ code: 'validation_failed', message: 'status는 필수입니다.' }, { status: 400 });
	}),
	http.get('/api/orgs/1/projects/10/events/121', () => HttpResponse.json(DETAIL)),
	http.get('/api/orgs/1/projects/10/events/121/body', () => new HttpResponse('{"order":42}', { headers: { 'content-type': 'application/json' } })),
	http.post('/api/orgs/1/projects/10/events/121/replay', () => HttpResponse.json({ ...EVENTS[0], id: '122' }, { status: 201 })),
];

export const server = setupServer(...handlers);
