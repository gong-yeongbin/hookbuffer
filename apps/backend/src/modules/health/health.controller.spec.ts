// HealthController 응답 형식을 검증하는 유닛 테스트
import { HealthController } from './health.controller';

describe('HealthController', () => {
	it('status ok를 돌려준다', () => {
		expect(new HealthController().check()).toEqual({ status: 'ok' });
	});
});
