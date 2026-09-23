// App 루트 컴포넌트 렌더링 테스트
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
	it('앱 이름을 제목으로 보여준다', () => {
		render(<App />);
		expect(screen.getByRole('heading', { name: 'relaydam' })).toBeDefined();
	});
});
