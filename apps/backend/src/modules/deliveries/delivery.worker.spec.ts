import { createHmac } from 'node:crypto';
import { DeliveryWorker } from './delivery.worker';
import type { DeliveryQueue } from './ports/delivery.queue';
import type { AttemptRecord, DeliveryContext, DeliveryOutcome, DeliveryRepository } from './ports/delivery.repository';
import type { DestinationClient, DestinationRequest, DestinationResponse } from './ports/destination.client';
import type { CircuitCheck, DestinationGuard } from './ports/destination.guard';

const NOW = new Date('2026-10-02T03:00:00Z');
const MIN = 60_000;
const ID = 345n;
const BODY = Buffer.from('{"order":1}');
// 흩뜨림 없음
const MID = 0.5;

// port를 in-memory fake로 둔다. 근거는 context-notes.md "계층별 테스트".
class FakeDeliveries implements Pick<DeliveryRepository, 'load' | 'recordAttempt' | 'close' | 'defer'> {
	delivery: DeliveryContext | null = {
		id: ID,
		status: 'pending',
		attempt: 0,
		created_at: NOW,
		event: {
			id: 120n,
			method: 'POST',
			path: '',
			query: '',
			source_ip: '203.0.113.7',
			verified: true,
			headers: { 'content-type': 'application/json', host: 'api.hookbuffer.io', 'x-hub-signature-256': 'sha256=abc' },
			body: BODY,
			source_name: 'github',
		},
		project: { id: 10, organization_id: 1, suspended: false, signing_secret: 'rdsec_key' },
		destination: { id: 7, name: 'orders', url: 'https://api.example.com/webhooks', headers: { Authorization: 'Bearer token' }, timeout_ms: 5000, concurrency: 10 },
		// 기본값: 2배씩·5분·9회
		connection: { retry_strategy: 'exponential', retry_interval_ms: 5 * MIN, retry_count: 9, paused: false },
	};
	attempts: AttemptRecord[] = [];
	outcome: DeliveryOutcome | null = null;
	closed: { status: string; error?: string } | null = null;
	deferred: Date | null = null;
	// 다른 워커가 먼저 처리한 상황
	lostRace = false;

	load() {
		return Promise.resolve(this.delivery);
	}
	recordAttempt(_id: bigint, _attemptBefore: number, attempt: AttemptRecord, outcome: DeliveryOutcome) {
		if (this.lostRace) return Promise.resolve(false);
		this.attempts.push(attempt);
		this.outcome = outcome;
		return Promise.resolve(true);
	}
	close(_id: bigint, status: 'held' | 'canceled' | 'dead', error?: string) {
		this.closed = { status, error };
		return Promise.resolve();
	}
	defer(_id: bigint, at: Date) {
		this.deferred = at;
		return Promise.resolve();
	}
}

// 목적지 보호 상태를 그대로 돌려주는 fake. 잡고 놓은 자리와 성공·실패 기록을 남긴다
class FakeGuard implements DestinationGuard {
	check: CircuitCheck = { state: 'closed' };
	full = false;
	acquired: { id: number; limit: number; holdMs: number }[] = [];
	released: string[] = [];
	recorded: ('success' | 'failure')[] = [];

	acquire(id: number, limit: number, holdMs: number) {
		if (this.full) return Promise.resolve(null);
		this.acquired.push({ id, limit, holdMs });
		return Promise.resolve(`slot-${this.acquired.length}`);
	}
	release(_id: number, token: string) {
		this.released.push(token);
		return Promise.resolve();
	}
	circuit() {
		return Promise.resolve(this.check);
	}
	recordSuccess() {
		this.recorded.push('success');
		return Promise.resolve();
	}
	recordFailure() {
		this.recorded.push('failure');
		return Promise.resolve();
	}
}

class FakeClient implements DestinationClient {
	requests: DestinationRequest[] = [];
	response: DestinationResponse = { status_code: 200, response_body: '{"ok":true}', retry_after: undefined, duration_ms: 12 };

	send(request: DestinationRequest) {
		this.requests.push(request);
		return Promise.resolve(this.response);
	}
}

class FakeQueue implements Pick<DeliveryQueue, 'schedule'> {
	scheduled: { id: bigint; at: Date }[] = [];

	schedule(id: bigint, at: Date) {
		this.scheduled.push({ id, at });
		return Promise.resolve();
	}
}

describe('DeliveryWorker', () => {
	let deliveries: FakeDeliveries;
	let client: FakeClient;
	let queue: FakeQueue;
	let guard: FakeGuard;
	let worker: DeliveryWorker;
	const run = (trigger?: 'manual' | 'unpause' | 'bulk_retry') => worker.process({ delivery_id: ID, trigger }, NOW, MID);
	const fail = (response: Partial<{ status_code: number; retry_after: string; error: string }>) => {
		client.response = 'error' in response ? { error: response.error!, duration_ms: 30 } : { status_code: response.status_code!, response_body: 'no', retry_after: response.retry_after, duration_ms: 30 };
	};

	beforeEach(() => {
		deliveries = new FakeDeliveries();
		client = new FakeClient();
		queue = new FakeQueue();
		guard = new FakeGuard();
		worker = new DeliveryWorker(deliveries as unknown as DeliveryRepository, client, queue as unknown as DeliveryQueue, guard, 'https://app.hookbuffer.io');
	});

	describe('보내는 요청', () => {
		it('받은 요청 방식·경로·쿼리·본문을 그대로, 목적지의 타임아웃으로 보낸다', async () => {
			deliveries.delivery!.event = { ...deliveries.delivery!.event, method: 'PUT', path: '/orders/42', query: 'v=2' };
			await run();

			expect(client.requests).toHaveLength(1);
			expect(client.requests[0]).toMatchObject({ method: 'PUT', url: 'https://api.example.com/webhooks/orders/42?v=2', body: BODY, timeout_ms: 5000 });
		});

		it('받은 헤더와 destination 헤더를 넘기고 X-Hookbuffer-* 를 붙인다. 서명은 project 서명 키로 계산한 본문의 HMAC-SHA256(base64)이다', async () => {
			await run();

			expect(client.requests[0]!.headers).toEqual({
				'content-type': 'application/json',
				'x-hub-signature-256': 'sha256=abc',
				authorization: 'Bearer token',
				'x-hookbuffer-event-id': '120',
				'x-hookbuffer-delivery-id': '345',
				'x-hookbuffer-attempt-count': '1',
				'x-hookbuffer-attempt-trigger': 'initial',
				'x-hookbuffer-will-retry-after': '300',
				'x-hookbuffer-event-url': 'https://app.hookbuffer.io/orgs/1/projects/10/events/120',
				'x-hookbuffer-source-name': 'github',
				'x-hookbuffer-destination-name': 'orders',
				'x-hookbuffer-original-ip': '203.0.113.7',
				'x-hookbuffer-signature': createHmac('sha256', 'rdsec_key').update(BODY).digest('base64'),
				'x-hookbuffer-verified': 'true',
			});
		});

		it('재시도면 시도 번호와 사유, 다음 재시도까지의 시간이 달라진다. 마지막 시도면 will-retry-after가 없다', async () => {
			deliveries.delivery!.attempt = 1;
			deliveries.delivery!.status = 'failed';
			await run();
			expect(client.requests[0]!.headers).toMatchObject({ 'x-hookbuffer-attempt-count': '2', 'x-hookbuffer-attempt-trigger': 'automatic', 'x-hookbuffer-will-retry-after': '600' });

			deliveries.delivery!.attempt = 9;
			await run();
			expect(client.requests[1]!.headers).toMatchObject({ 'x-hookbuffer-attempt-count': '10' });
			expect(client.requests[1]!.headers).not.toHaveProperty('x-hookbuffer-will-retry-after');
		});

		it('큐 항목에 사유가 적혀 있으면 그것을 쓴다 (수동 재시도, 일시 정지 해제)', async () => {
			deliveries.delivery!.attempt = 3;
			await run('manual');
			expect(client.requests[0]!.headers['x-hookbuffer-attempt-trigger']).toBe('manual');
			expect(deliveries.attempts[0]!.trigger).toBe('manual');

			await run('unpause');
			expect(deliveries.attempts[1]!.trigger).toBe('unpause');
		});
	});

	describe('성공', () => {
		it.each([200, 201, 204, 299])('%i이면 succeeded로 남기고 예약하지 않는다', async (status_code) => {
			client.response = { status_code, response_body: 'ok', retry_after: undefined, duration_ms: 12 };

			expect(await run()).toBe('succeeded');
			expect(deliveries.attempts).toEqual([{ attempt_no: 1, trigger: 'initial', status_code, error: null, duration_ms: 12, response_body: 'ok' }]);
			expect(deliveries.outcome).toEqual({ status: 'succeeded', next_attempt_at: null, last_status_code: status_code, last_error: null });
			expect(queue.scheduled).toEqual([]);
			expect(guard.recorded).toEqual(['success']);
		});
	});

	describe('실패 — 2xx가 아니면 전부 재시도한다', () => {
		it.each([301, 302, 400, 401, 404, 429, 500, 503])('%i이면 failed로 남기고 5분 뒤로 예약한다', async (status_code) => {
			fail({ status_code });
			const retryAt = new Date(NOW.getTime() + 5 * MIN);

			expect(await run()).toBe('failed');
			expect(deliveries.attempts[0]).toMatchObject({ attempt_no: 1, status_code, error: null, response_body: 'no' });
			expect(deliveries.outcome).toEqual({ status: 'failed', next_attempt_at: retryAt, last_status_code: status_code, last_error: null });
			expect(queue.scheduled).toEqual([{ id: ID, at: retryAt }]);
			expect(guard.recorded).toEqual(['failure']);
		});

		it('응답을 못 받으면(타임아웃, 연결 실패, 내부망 차단) 오류를 남기고 재시도한다', async () => {
			for (const error of ['timeout', 'ECONNREFUSED', 'blocked_address']) {
				fail({ error });
				expect(await run()).toBe('failed');
				expect(deliveries.attempts.at(-1)).toMatchObject({ status_code: null, error, response_body: null, duration_ms: 30 });
				expect(deliveries.outcome).toMatchObject({ status: 'failed', last_status_code: null, last_error: error });
			}
		});

		it('재시도 간격은 연결 설정을 따른다. 2배씩이면 두 번째 재시도는 10분 뒤', async () => {
			fail({ status_code: 500 });
			deliveries.delivery!.attempt = 1;
			deliveries.delivery!.status = 'failed';

			await run();
			expect(deliveries.outcome!.next_attempt_at).toEqual(new Date(NOW.getTime() + 10 * MIN));

			deliveries.delivery!.connection = { retry_strategy: 'linear', retry_interval_ms: 60 * MIN, retry_count: 5, paused: false };
			await run();
			expect(deliveries.outcome!.next_attempt_at).toEqual(new Date(NOW.getTime() + 60 * MIN));
		});

		it('목적지가 Retry-After를 주면 그 시각으로 예약한다', async () => {
			fail({ status_code: 503, retry_after: '120' });
			await run();
			expect(queue.scheduled).toEqual([{ id: ID, at: new Date(NOW.getTime() + 120_000) }]);
		});

		it('재시도를 다 썼으면 dead로 남기고 예약하지 않는다', async () => {
			fail({ status_code: 500 });
			deliveries.delivery!.attempt = 9;
			deliveries.delivery!.status = 'failed';

			expect(await run()).toBe('dead');
			expect(deliveries.attempts[0]).toMatchObject({ attempt_no: 10, status_code: 500 });
			expect(deliveries.outcome).toEqual({ status: 'dead', next_attempt_at: null, last_status_code: 500, last_error: null });
			expect(queue.scheduled).toEqual([]);
		});

		it('재시도 횟수가 0인 연결은 첫 실패에 dead다', async () => {
			fail({ status_code: 500 });
			deliveries.delivery!.connection!.retry_count = 0;
			expect(await run()).toBe('dead');
		});

		it('첫 시도로부터 1주일을 넘기면 횟수가 남아도 dead다', async () => {
			fail({ status_code: 500 });
			deliveries.delivery!.created_at = new Date(NOW.getTime() - 7 * 24 * 60 * MIN + MIN);
			deliveries.delivery!.attempt = 3;
			expect(await run()).toBe('dead');
		});
	});

	describe('목적지 보호', () => {
		// random 0.5면 미루는 간격은 1초 + 2초 = 3초
		const DEFER = 3_000;
		const expectDeferred = (at: Date) => {
			expect(client.requests).toEqual([]);
			expect(deliveries.attempts).toEqual([]);
			expect(deliveries.closed).toBeNull();
			expect(deliveries.deferred).toEqual(at);
			expect(queue.scheduled).toEqual([{ id: ID, at }]);
			expect(guard.recorded).toEqual([]);
		};

		it('목적지의 동시 전달 자리를 타임아웃 + 5초 동안 잡고, 보낸 뒤 놓는다', async () => {
			await run();
			expect(guard.acquired).toEqual([{ id: 7, limit: 10, holdMs: 10_000 }]);
			expect(guard.released).toEqual(['slot-1']);
		});

		it('client가 던져도 자리를 놓는다', async () => {
			client.send = () => Promise.reject(new Error('boom'));
			await expect(run()).rejects.toThrow('boom');
			expect(guard.released).toEqual(['slot-1']);
		});

		it('자리가 다 찼으면 보내지 않고 1~5초 뒤로 미룬다. 시도 횟수를 쓰지 않는다', async () => {
			guard.full = true;
			expect(await run()).toBe('deferred');
			expectDeferred(new Date(NOW.getTime() + DEFER));
		});

		it('서킷이 열려 있으면 풀리는 시각 + 1~5초 뒤로 미룬다. 자리를 잡지 않는다', async () => {
			guard.check = { state: 'open', remaining_ms: 42_000 };
			expect(await run()).toBe('deferred');
			expectDeferred(new Date(NOW.getTime() + 42_000 + DEFER));
			expect(guard.acquired).toEqual([]);
		});

		it('half_open이면 프로브를 잡은 워커만 보내고, 못 잡았으면 1~5초 뒤로 미룬다', async () => {
			guard.check = { state: 'half_open', probe: false };
			expect(await run()).toBe('deferred');
			expectDeferred(new Date(NOW.getTime() + DEFER));

			guard.check = { state: 'half_open', probe: true };
			expect(await run()).toBe('succeeded');
			expect(client.requests).toHaveLength(1);
			expect(guard.recorded).toEqual(['success']);
		});

		it('다른 워커가 먼저 처리해 기록을 남기지 못해도 보낸 결과는 서킷에 반영한다', async () => {
			deliveries.lostRace = true;
			fail({ status_code: 500 });
			expect(await run()).toBe('skipped');
			expect(guard.recorded).toEqual(['failure']);
		});
	});

	describe('보내지 않는 경우', () => {
		const expectNotSent = () => {
			expect(client.requests).toEqual([]);
			expect(deliveries.attempts).toEqual([]);
			expect(queue.scheduled).toEqual([]);
			expect(guard.acquired).toEqual([]);
		};

		it('delivery가 없으면(지워짐) 아무것도 하지 않는다', async () => {
			deliveries.delivery = null;
			expect(await run()).toBe('skipped');
			expectNotSent();
			expect(deliveries.closed).toBeNull();
		});

		it.each(['succeeded', 'dead', 'canceled', 'held'] as const)('이미 %s인 delivery는 건드리지 않는다', async (status) => {
			deliveries.delivery!.status = status;
			expect(await run()).toBe('skipped');
			expectNotSent();
			expect(deliveries.closed).toBeNull();
		});

		it('목적지나 연결이 지워졌으면 canceled로 닫는다', async () => {
			deliveries.delivery!.destination = null;
			expect(await run()).toBe('canceled');
			expect(deliveries.closed).toEqual({ status: 'canceled', error: undefined });

			deliveries.delivery!.destination = { id: 7, name: 'd', url: 'https://x.example', headers: {}, timeout_ms: 1000, concurrency: 1 };
			deliveries.delivery!.connection = null;
			expect(await run()).toBe('canceled');
			expectNotSent();
		});

		it('일시 정지한 연결이나 정지된 project면 held로 둔다. 시도 횟수를 쓰지 않는다', async () => {
			deliveries.delivery!.connection!.paused = true;
			expect(await run()).toBe('held');
			expect(deliveries.closed).toEqual({ status: 'held', error: undefined });

			deliveries.delivery!.connection!.paused = false;
			deliveries.delivery!.project.suspended = true;
			expect(await run()).toBe('held');
			expectNotSent();
		});
	});

	it('보내는 사이 다른 워커가 같은 delivery를 처리했으면 기록도 예약도 하지 않는다', async () => {
		deliveries.lostRace = true;
		expect(await run()).toBe('skipped');

		fail({ status_code: 500 });
		expect(await run()).toBe('skipped');
		expect(queue.scheduled).toEqual([]);
	});
});
