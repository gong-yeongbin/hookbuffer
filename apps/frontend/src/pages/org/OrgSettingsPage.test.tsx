import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setToken } from '@/auth/token';
import { INVITATIONS, ME, MEMBERS, ORG, server } from '@/test/msw';
import { renderApp } from '@/test/render';

const user = () => userEvent.setup();

describe('OrgSettingsPage', () => {
	beforeEach(() => {
		localStorage.clear();
		setToken('jwt');
	});

	it('조직 이름·플랜·멤버·대기 중 초대를 보여주고, owner는 역할을 바꾸고 내보낸다', async () => {
		const patched: unknown[] = [];
		server.use(
			http.patch('/api/orgs/1/members/2', async ({ request }) => {
				patched.push(await request.json());
				return HttpResponse.json({ ...MEMBERS[1], role: 'admin' });
			})
		);
		renderApp('/app/org');
		const u = user();
		expect(await screen.findByText('김개발')).toBeDefined();
		expect(screen.getByText('Team')).toBeDefined();
		expect(screen.getByText('(나)')).toBeDefined();
		expect(screen.getByText('lee@company.com')).toBeDefined();
		// owner인 나는 역할 Select 없이 글자로
		expect(screen.getByRole('cell', { name: '소유자' })).toBeDefined();
		await u.click(screen.getByRole('combobox', { name: '김개발 역할' }));
		await u.click(await screen.findByRole('option', { name: '관리자' }));
		expect(await screen.findByText('역할을 바꿨습니다.')).toBeDefined();
		expect(patched[0]).toEqual({ role: 'admin' });

		await u.click(screen.getByRole('button', { name: '내보내기' }));
		expect(await screen.findByText('김개발 님을 내보낼까요?')).toBeDefined();
		await u.click(screen.getByRole('button', { name: '내보내기' , hidden: false }));
		expect(await screen.findByText('내보냈습니다.')).toBeDefined();
	});

	it('조직 이름을 바꾸고, 초대를 보내고 취소한다. 이메일 형식이 맞아야 보낼 수 있다', async () => {
		const posted: unknown[] = [];
		server.use(
			http.post('/api/orgs/1/invitations', async ({ request }) => {
				posted.push(await request.json());
				return HttpResponse.json({ ...INVITATIONS[0], id: 6 }, { status: 201 });
			})
		);
		renderApp('/app/org');
		const u = user();
		const nameInput = await screen.findByLabelText('조직 이름');
		await u.clear(nameInput);
		await u.type(nameInput, '우리 팀');
		await u.click(screen.getByRole('button', { name: '저장' }));
		expect(await screen.findByText('조직 이름을 바꿨습니다.')).toBeDefined();

		const send = screen.getByRole('button', { name: '초대 보내기' });
		await u.type(screen.getByLabelText('초대할 이메일'), 'park@company');
		expect(send.hasAttribute('disabled')).toBe(true);
		await u.type(screen.getByLabelText('초대할 이메일'), '.com');
		await u.click(screen.getByRole('combobox', { name: '초대 역할' }));
		await u.click(await screen.findByRole('option', { name: '관리자' }));
		await u.click(send);
		expect(await screen.findByText(/park@company.com에게 초대 메일을 보냈습니다/)).toBeDefined();
		expect(posted[0]).toEqual({ email: 'park@company.com', role: 'admin' });

		await u.click(screen.getByRole('button', { name: 'lee@company.com 초대 취소' }));
		expect(await screen.findByText('초대를 취소했습니다.')).toBeDefined();
	});

	it('member는 보기만 하고, 나가기는 확인 뒤 로그아웃된다', async () => {
		server.use(
			http.get('/api/orgs', () => HttpResponse.json({ data: [{ ...ORG, role: 'member' }], next_cursor: null })),
			http.get('/api/users/me', () => HttpResponse.json({ ...ME, id: 2, name: '김개발', email: 'kim@company.com' })),
			http.get('/api/orgs/1/members', () => HttpResponse.json({ data: MEMBERS, next_cursor: null }))
		);
		renderApp('/app/org');
		const u = user();
		expect(await screen.findByText('(나)')).toBeDefined();
		expect(screen.getByLabelText('조직 이름').hasAttribute('disabled')).toBe(true);
		expect(screen.queryByLabelText('초대할 이메일')).toBeNull();
		expect(screen.queryByRole('combobox', { name: /역할/ })).toBeNull();
		await u.click(screen.getByRole('button', { name: '나가기' }));
		await u.click(await screen.findByRole('button', { name: '나가기' }));
		expect(await screen.findByText('조직에서 나왔습니다.')).toBeDefined();
		expect(await screen.findByRole('button', { name: /Google 계정으로 로그인/ })).toBeDefined();
		expect(localStorage.getItem('munjigi.token')).toBeNull();
	});

	it('실패는 백엔드 메시지로. 만료된 초대는 표시한다', async () => {
		server.use(
			http.get('/api/orgs/1/invitations', () => HttpResponse.json({ data: [{ ...INVITATIONS[0], expires_at: '2020-01-01T00:00:00.000Z' }], next_cursor: null })),
			http.patch('/api/orgs/1', () => HttpResponse.json({ code: 'validation_failed', message: '이름이 너무 깁니다.' }, { status: 400 })),
			http.patch('/api/orgs/1/members/2', () => HttpResponse.json({ code: 'forbidden', message: '역할을 바꿀 수 없습니다.' }, { status: 403 })),
			http.delete('/api/orgs/1/members/2', () => HttpResponse.json({ code: 'forbidden', message: '내보낼 수 없습니다.' }, { status: 403 })),
			http.post('/api/orgs/1/invitations', () => HttpResponse.json({ code: 'plan_limit', message: 'free 플랜은 멤버 1명까지입니다.' }, { status: 403 })),
			http.delete('/api/orgs/1/invitations/5', () => HttpResponse.json({ code: 'invitation_not_found', message: '초대가 없습니다.' }, { status: 404 }))
		);
		renderApp('/app/org');
		const u = user();
		await screen.findByText('김개발');
		expect(screen.getByText(/만료됨/)).toBeDefined();
		await u.type(screen.getByLabelText('조직 이름'), 'x');
		await u.click(screen.getByRole('button', { name: '저장' }));
		expect(await screen.findByText('이름이 너무 깁니다.')).toBeDefined();
		await u.click(screen.getByRole('combobox', { name: '김개발 역할' }));
		await u.click(await screen.findByRole('option', { name: '관리자' }));
		expect(await screen.findByText('역할을 바꿀 수 없습니다.')).toBeDefined();
		await u.click(screen.getByRole('button', { name: '내보내기' }));
		await u.click((await screen.findAllByRole('button', { name: '내보내기' })).at(-1)!);
		expect(await screen.findByText('내보낼 수 없습니다.')).toBeDefined();
		await u.type(screen.getByLabelText('초대할 이메일'), 'a@b.co');
		await u.click(screen.getByRole('button', { name: '초대 보내기' }));
		expect(await screen.findByText('free 플랜은 멤버 1명까지입니다.')).toBeDefined();
		await u.click(screen.getByRole('button', { name: 'lee@company.com 초대 취소' }));
		expect(await screen.findByText('초대가 없습니다.')).toBeDefined();
	});
});

describe('MePage', () => {
	beforeEach(() => {
		localStorage.clear();
		setToken('jwt');
	});

	it('내 이름·이메일·가입일을 보여주고 로그아웃한다', async () => {
		renderApp('/app/me');
		expect(await screen.findByText('seed@munjigi.local')).toBeDefined();
		expect(screen.getByText('시드')).toBeDefined();
		await user().click(screen.getByRole('button', { name: '로그아웃' }));
		expect(await screen.findByRole('button', { name: /Google 계정으로 로그인/ })).toBeDefined();
	});

	it('조회가 실패하면 오류를 보여준다', async () => {
		server.use(http.get('/api/users/me', () => HttpResponse.json({ code: 'user_not_found', message: '사용자가 없습니다.' }, { status: 404 })));
		renderApp('/app/me');
		expect(await screen.findByText('사용자가 없습니다.')).toBeDefined();
	});
});

describe('InvitationAcceptPage', () => {
	beforeEach(() => localStorage.clear());

	it('로그인 전이면 로그인으로, 로그인 뒤 열면 바로 수락한다', async () => {
		renderApp('/invitations/good');
		expect(screen.getByRole('button', { name: /Google 계정으로 로그인/ })).toBeDefined();
		setToken('jwt');
		renderApp('/invitations/good');
		expect(await screen.findByText('조직에 들어왔습니다.')).toBeDefined();
		expect(screen.getByRole('link', { name: '대시보드로' }).getAttribute('href')).toBe('/app');
	});

	it('이메일이 다르면 백엔드 메시지를 보여준다', async () => {
		setToken('jwt');
		renderApp('/invitations/bad');
		expect(await screen.findByRole('alert')).toHaveProperty('textContent', '초대받은 이메일로 로그인하세요.');
		await waitFor(() => expect(within(screen.getByRole('alert')).queryByText('조직에 들어왔습니다.')).toBeNull());
	});
});
