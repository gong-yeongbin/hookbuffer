import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { setToken } from '@/auth/token';
import { server } from '@/test/msw';
import { withQuery } from '@/test/render';
import { LoginPage } from './LoginPage';

const renderLogin = () =>
	render(
		withQuery(
			<MemoryRouter initialEntries={['/login']}>
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route path="/app" element={<p>대시보드</p>} />
				</Routes>
			</MemoryRouter>
		)
	);

// 구글 스크립트 대신 window.google을 가짜로 둔다. 버튼을 그리라고 하면 콜백을 잡아 둔다
const fakeGoogle = () => {
	let callback: ((r: { credential: string }) => void) | null = null;
	const id = {
		initialize: vi.fn((options: { callback: (r: { credential: string }) => void }) => {
			callback = options.callback;
		}),
		renderButton: vi.fn((parent: HTMLElement) => {
			parent.textContent = 'Google 버튼';
		}),
	};
	window.google = { accounts: { id } };
	return { id, choose: (credential: string) => callback!({ credential }) };
};

describe('LoginPage', () => {
	beforeEach(() => {
		localStorage.clear();
		delete window.google;
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
	});

	it('클라이언트 ID가 없으면 개발용 버튼: VITE_DEV_TOKEN(없으면 dev)을 저장하고 /app으로 간다', () => {
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
		vi.stubEnv('VITE_DEV_TOKEN', 'token-from-env');
		renderLogin();
		expect(screen.getByRole('link', { name: 'munjigi' }).getAttribute('href')).toBe('/');
		expect(screen.getByText('처음이면 계정이 자동으로 만들어집니다')).toBeDefined();
		fireEvent.click(screen.getByRole('button', { name: /Google 계정으로 로그인/ }));
		expect(localStorage.getItem('munjigi.token')).toBe('token-from-env');
		expect(screen.getByText('대시보드')).toBeDefined();
	});

	it('VITE_DEV_TOKEN이 비어 있으면 dev를 넣는다', () => {
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
		vi.stubEnv('VITE_DEV_TOKEN', '');
		renderLogin();
		fireEvent.click(screen.getByRole('button', { name: /Google 계정으로 로그인/ }));
		expect(localStorage.getItem('munjigi.token')).toBe('dev');
	});

	it('클라이언트 ID가 있으면 구글 버튼을 그리고, 계정을 고르면 ID 토큰으로 로그인해 /app으로 간다', async () => {
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123');
		const google = fakeGoogle();
		const posted: unknown[] = [];
		server.use(
			http.post('/api/auth/google', async ({ request }) => {
				posted.push(await request.json());
				return HttpResponse.json({ access_token: 'jwt-from-google' });
			})
		);
		renderLogin();
		expect(await screen.findByText('Google 버튼')).toBeDefined();
		expect(google.id.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'client-123' }));
		google.choose('google-id-token');
		await waitFor(() => expect(localStorage.getItem('munjigi.token')).toBe('jwt-from-google'));
		expect(posted[0]).toEqual({ id_token: 'google-id-token' });
		expect(await screen.findByText('대시보드')).toBeDefined();
	});

	it('백엔드가 거부하면 메시지를 보여준다', async () => {
		vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123');
		const google = fakeGoogle();
		server.use(http.post('/api/auth/google', () => HttpResponse.json({ code: 'unauthenticated', message: '구글 토큰이 올바르지 않습니다.' }, { status: 401 })));
		renderLogin();
		await screen.findByText('Google 버튼');
		google.choose('bad');
		expect(await screen.findByRole('alert')).toHaveProperty('textContent', '구글 토큰이 올바르지 않습니다.');
		expect(localStorage.getItem('munjigi.token')).toBeNull();
	});

	it('이미 로그인돼 있으면 /app으로 보낸다', () => {
		setToken('jwt');
		renderLogin();
		expect(screen.getByText('대시보드')).toBeDefined();
	});
});
