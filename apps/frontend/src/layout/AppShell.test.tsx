import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setToken } from '@/auth/token';
import { server } from '@/test/msw';
import { renderApp } from '@/test/render';

const user = () => userEvent.setup();

// 프로젝트 선택에서 "새 프로젝트"를 고른다
const openCreate = async () => {
	const u = user();
	await screen.findByText('shop');
	await u.click(screen.getByRole('combobox', { name: '프로젝트' }));
	await u.click(await screen.findByRole('option', { name: /새 프로젝트/ }));
	return u;
};

describe('AppShell', () => {
	beforeEach(() => localStorage.clear());

	it('토큰이 없으면 /login으로 보낸다', () => {
		renderApp('/app/events');
		expect(screen.getByRole('button', { name: /Google 계정으로 로그인/ })).toBeDefined();
	});

	it('/app은 이벤트로 가고, 레일 메뉴 6개와 실제 프로젝트를 보여준다', async () => {
		setToken('jwt');
		renderApp('/app');
		const nav = screen.getByRole('navigation');
		expect(Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('aria-label'))).toEqual(['이벤트', '전달', '연결', '소스', '목적지']);
		expect(screen.getByRole('link', { name: '이벤트' }).getAttribute('href')).toBe('/app/events');
		expect(screen.getByRole('link', { name: '이벤트' }).getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('combobox', { name: '프로젝트' })).toBeDefined();
		expect(await screen.findByText('shop')).toBeDefined();
	});

	it('프로젝트를 고르면 기억해 둔다', async () => {
		setToken('jwt');
		renderApp('/app/events');
		await screen.findByText('shop');
		const u = user();
		await u.click(screen.getByRole('combobox', { name: '프로젝트' }));
		await u.click(await screen.findByRole('option', { name: 'shop' }));
		await waitFor(() => expect(localStorage.getItem('hookbuffer.project')).toBe('10'));
	});

	it('새 프로젝트를 고르면 만들기 창이 뜨고, 이름을 넣어 만들면 그 프로젝트가 선택된다', async () => {
		setToken('jwt');
		renderApp('/app/settings');
		const u = await openCreate();
		const create = await screen.findByRole('button', { name: '만들기' });
		expect(create.hasAttribute('disabled')).toBe(true);
		await u.type(screen.getByLabelText('이름'), 'blog');
		await u.click(create);
		await waitFor(() => expect(localStorage.getItem('hookbuffer.project')).toBe('11'));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('프로젝트 만들기가 실패하면 백엔드 메시지를 보여주고 창은 남는다', async () => {
		server.use(http.post('/api/orgs/1/projects', () => HttpResponse.json({ code: 'plan_limit', message: 'free 플랜은 프로젝트 1개까지입니다.' }, { status: 403 })));
		setToken('jwt');
		renderApp('/app/settings');
		const u = await openCreate();
		await u.type(await screen.findByLabelText('이름'), 'blog');
		await u.click(screen.getByRole('button', { name: '만들기' }));
		expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'free 플랜은 프로젝트 1개까지입니다.');
		expect(screen.getByRole('dialog')).toBeDefined();
	});

	it('레일 맨 아래 내 계정 → 프로젝트 설정·조직 설정·사용량으로 간다', async () => {
		setToken('jwt');
		renderApp('/app/events');
		const u = user();
		await u.click(screen.getByRole('button', { name: '내 계정' }));
		expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual(['프로젝트 설정', '조직 설정', '사용량', '내 정보', '로그아웃']);
		await u.click(screen.getByRole('menuitem', { name: '프로젝트 설정' }));
		expect(await screen.findByRole('heading', { name: '프로젝트 설정' })).toBeDefined();
		// 설정 계열 화면에서는 계정 아이콘이 선택 상태
		expect(screen.getByRole('button', { name: '내 계정' }).className).toContain('border-primary');
	});

	it('로그아웃하면 토큰을 지우고 /login으로 간다', async () => {
		setToken('jwt');
		renderApp('/app/events');
		const u = user();
		await u.click(screen.getByRole('button', { name: '내 계정' }));
		await u.click(await screen.findByRole('menuitem', { name: '로그아웃' }));
		expect(localStorage.getItem('hookbuffer.token')).toBeNull();
		expect(await screen.findByRole('button', { name: /Google 계정으로 로그인/ })).toBeDefined();
	});
});
