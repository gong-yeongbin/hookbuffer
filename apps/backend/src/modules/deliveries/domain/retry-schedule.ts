import type { RetryStrategy } from '@prisma/client';

// 자동 재시도는 최대 50회 또는 첫 시도로부터 1주일, 먼저 닿는 쪽에서 멈춘다(Hookdeck과 같다)
export const MAX_RETRIES = 50;
export const MAX_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// 한꺼번에 실패한 전달들이 같은 순간에 다시 몰리지 않게 간격을 ±20% 흩뜨린다
const JITTER = 0.2;

// connection의 재시도 설정. retry_count는 첫 시도를 뺀 재시도 수다
export type RetryRule = { retry_strategy: RetryStrategy; retry_interval_ms: number; retry_count: number };

// retryNo번째(1부터) 재시도까지 기다리는 시간. linear는 매번 같고 exponential은 2배씩 늘어난다
export function baseDelayMs(rule: RetryRule, retryNo: number): number {
	return rule.retry_strategy === 'linear' ? rule.retry_interval_ms : rule.retry_interval_ms * 2 ** (retryNo - 1);
}

// random은 0 이상 1 미만. 0이면 -20%, 1에 가까우면 +20%
export function withJitter(delayMs: number, random: number): number {
	return Math.round(delayMs * (1 - JITTER + 2 * JITTER * random));
}

// 목적지가 응답에 적은 Retry-After. 초(정수) 또는 날짜 문자열이다. 못 읽으면 null, 이미 지난 시각이면 0
export function retryAfterMs(value: string | undefined, now: Date): number | null {
	if (value === undefined) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
	// 음수나 소수 같은 숫자 모양은 날짜로 읽지 않는다. Date.parse('-5')는 기원전 5년으로 읽혀 "지금 바로"가 된다
	if (/^[-+]?[\d.]+$/.test(trimmed)) return null;
	const at = Date.parse(trimmed);
	return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
}

// 실패한 뒤 다음 시도 시각. 더 재시도하지 않으면(횟수를 다 썼거나 1주일을 넘으면) null이고 그 delivery는 dead다.
// retriesDone은 지금까지 한 재시도 수(첫 시도 제외). 수동 재시도도 한 번으로 센다.
// Retry-After가 있으면 설정보다 그 값을 우선한다
export function nextAttemptAt(input: { rule: RetryRule; retriesDone: number; firstAttemptAt: Date; now: Date; retryAfter?: string; random: number }): Date | null {
	const { rule, retriesDone, now } = input;
	if (retriesDone >= Math.min(rule.retry_count, MAX_RETRIES)) return null;

	const delay = retryAfterMs(input.retryAfter, now) ?? withJitter(baseDelayMs(rule, retriesDone + 1), input.random);
	const at = now.getTime() + delay;
	return at - input.firstAttemptAt.getTime() > MAX_RETRY_WINDOW_MS ? null : new Date(at);
}

// 이번 시도가 실패하면 몇 초 뒤에 다시 보낼지(X-Hookbuffer-Will-Retry-After). 흩뜨리기 전의 값이다.
// 이번이 마지막 시도면 null
export function willRetryAfterSec(rule: RetryRule, retriesDone: number): number | null {
	if (retriesDone >= Math.min(rule.retry_count, MAX_RETRIES)) return null;
	return Math.round(baseDelayMs(rule, retriesDone + 1) / 1000);
}
