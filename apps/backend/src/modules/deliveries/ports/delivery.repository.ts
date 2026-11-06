import type { AttemptTrigger, DeliveryStatus } from '@prisma/client';
import type { RetryRule } from '../domain/retry-schedule';

// 전달 한 번에 필요한 것을 한꺼번에 읽은 결과. 헤더와 서명 키는 복호화한 원문이다
export type DeliveryContext = {
	id: bigint;
	status: DeliveryStatus;
	// 지금까지 한 시도 수
	attempt: number;
	// 첫 시도 시각으로 본다. 1주일 상한의 기준이다
	created_at: Date;
	event: {
		id: bigint;
		method: string;
		path: string;
		query: string;
		source_ip: string | null;
		verified: boolean;
		headers: Record<string, string | string[]>;
		body: Buffer;
		// 소스가 지워졌으면 null
		source_name: string | null;
	};
	project: { id: number; organization_id: number; suspended: boolean; signing_secret: string };
	// 목적지나 연결이 지워졌으면 null. 그 delivery는 보내지 않고 닫는다
	destination: { id: number; name: string; url: string; headers: Record<string, string>; timeout_ms: number; concurrency: number } | null;
	connection: (RetryRule & { paused: boolean }) | null;
};

// 목적지로 한 번 보낸 기록. 응답을 받았으면 status_code, 못 받았으면 error가 있다
export type AttemptRecord = {
	attempt_no: number;
	trigger: AttemptTrigger;
	status_code: number | null;
	error: string | null;
	duration_ms: number;
	response_body: string | null;
};

// 시도 뒤의 delivery 상태. failed면 next_attempt_at에 다시 보낸다
export type DeliveryOutcome = {
	status: 'succeeded' | 'failed' | 'dead';
	next_attempt_at: Date | null;
	last_status_code: number | null;
	last_error: string | null;
};

export interface DeliveryRepository {
	load(id: bigint): Promise<DeliveryContext | null>;
	// 시도 한 번의 기록과 그 뒤 상태를 한 트랜잭션으로 남긴다. attemptBefore는 읽었을 때의 시도 수다.
	// 그 사이 다른 워커가 같은 delivery를 처리했으면 남기지 않고 false를 준다
	recordAttempt(id: bigint, attemptBefore: number, attempt: AttemptRecord, outcome: DeliveryOutcome): Promise<boolean>;
	// 보내지 않고 닫는다. 아직 pending·failed일 때만 바꾼다
	close(id: bigint, status: 'held' | 'canceled' | 'dead', error?: string): Promise<void>;
	// 보내지 않고 at 시각으로 미룬다(목적지 자리가 없거나 서킷이 열렸을 때). 시도 횟수는 그대로다.
	// 기록해 두지 않으면 sweeper가 "예약이 사라졌다"고 보고 큐에 또 넣는다
	defer(id: bigint, at: Date): Promise<void>;
	// 큐에 있어야 하는데 staleMs 넘게 처리되지 않은 것(큐 적재가 빠졌거나 예약이 사라진 경우).
	// 돌려준 것은 방금 본 것으로 표시해, 큐에서 차례를 기다리는 동안 매번 다시 나오지 않게 한다
	findStale(now: Date, staleMs: number, limit: number): Promise<bigint[]>;
}

export const DELIVERY_REPOSITORY = Symbol('DeliveryRepository');
// X-Hookbuffer-Event-Url을 만들 대시보드 주소
export const APP_URL = Symbol('AppUrl');
