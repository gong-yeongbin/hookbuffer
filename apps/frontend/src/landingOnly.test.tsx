import { screen } from '@testing-library/react';
import { setToken } from '@/auth/token';
import { renderApp } from '@/test/render';

import { LANDING_ONLY } from '@/config';

// 랜딩만 공개(config.ts LANDING_ONLY): 랜딩만 열리고 나머지는 /로, 시작 버튼은 준비 중
describe('랜딩만 공개(LANDING_ONLY)', () => {
	beforeEach(() => localStorage.clear());
	const only = { landingOnly: true };

	it('지금 배포 설정은 랜딩만 공개다', () => {
		expect(LANDING_ONLY).toBe(true);
	});

	it('/login·/app·/invitations는 전부 랜딩으로 보낸다. 로그인돼 있어도', () => {
		for (const path of ['/login', '/pricing', '/developers', '/docs', '/app/events', '/invitations/abc']) {
			setToken('jwt');
			const { unmount } = renderApp(path, only);
			expect(screen.getByRole('heading', { level: 1, name: /웹훅을 받아 두고/ })).toBeDefined();
			expect(screen.queryByRole('button', { name: /Google 계정으로 로그인/ })).toBeNull();
			unmount();
		}
	});

	it('랜딩: 상단 바에 워드마크만 남고 시작 자리는 준비 중', () => {
		renderApp('/', only);
		expect(screen.queryByRole('link', { name: '로그인' })).toBeNull();
		expect(screen.queryByRole('link', { name: '시작하기' })).toBeNull();
		expect(screen.queryByRole('link', { name: '무료로 시작하기' })).toBeNull();
		// 상단 바에는 아무 표시도 없고, 본문의 시작·요금 자리만 준비 중
		expect(screen.getByRole('banner').textContent).not.toContain('준비 중');
		expect(screen.getAllByText('준비 중').length).toBeGreaterThanOrEqual(2);
		expect(screen.getByRole('button', { name: '준비 중' }).hasAttribute('disabled')).toBe(true);
		expect(screen.queryByRole('link', { name: '요금' })).toBeNull();
		expect(screen.queryByRole('link', { name: '요금 자세히 보기' })).toBeNull();
		expect(screen.queryByRole('link', { name: '문서' })).toBeNull();
		expect(screen.queryByRole('link', { name: '개발자' })).toBeNull();
	});

});
