import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { App } from '@/App';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

// 앱 전체를 main.tsx와 같은 제공자(쿼리·툴팁·토스트)로 그린다. 재시도는 끈다(실패 테스트가 느려진다).
// 공개 범위(LANDING_ONLY)와 무관하게 전체 화면을 검사하도록 기본은 false다
export function renderApp(path: string, { landingOnly = false }: { landingOnly?: boolean } = {}) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<MemoryRouter initialEntries={[path]}>
					<App landingOnly={landingOnly} />
				</MemoryRouter>
				<Toaster />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export function withQuery(children: ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
