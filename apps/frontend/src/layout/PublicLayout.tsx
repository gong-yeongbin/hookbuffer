import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { buttonVariants } from '@/components/ui/button';

// 상단 메뉴. 페이지가 생기면 여기 경로만 바꾼다
const NAV = [
	{ to: '/developers', label: '개발자' },
	{ to: '/docs', label: '문서' },
	{ to: '/pricing', label: '요금' },
];

// 로그인 전 화면(랜딩·요금)의 공통 틀. 모래색 바탕, 워드마크 왼쪽, 글자 링크 오른쪽. 푸터는 맨 아래 한 줄
export function PublicLayout({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	return (
		<div className="min-h-screen bg-sand text-primary">
			<header className="flex items-center justify-between px-12 pt-7">
				<Link to="/" className="font-heading text-2xl font-bold tracking-tight">
					hookbuffer
				</Link>
				<nav className="flex items-center gap-7 text-[15px]">
					{NAV.map((item) => (
						<Link key={item.to} to={item.to} className={cn('underline-offset-4 hover:underline', pathname === item.to ? 'font-semibold' : 'text-cobalt-muted')}>
							{item.label}
						</Link>
					))}
					<Link to="/login" className="text-cobalt-muted underline-offset-4 hover:underline">
						로그인
					</Link>
					<Link to="/login" className={buttonVariants({ size: 'lg' })}>
						시작하기
					</Link>
				</nav>
			</header>

			<main>{children}</main>

			{/* 푸터 블록 없이 한 줄. 위는 비워 둔다 */}
			<footer className="grid grid-cols-[1fr_auto_1fr] items-baseline px-12 pt-[30svh] pb-[30px] text-[15px] text-cobalt-muted">
				<span>웹훅 수신 게이트웨이</span>
				<a href="https://github.com/gong-yeongbin/hookbuffer" target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
					GitHub
				</a>
				<span className="text-right">© 2026 hookbuffer</span>
			</footer>
		</div>
	);
}

// 아직 없는 공개 페이지 자리
export function ComingSoon({ title }: { title: string }) {
	return (
		<PublicLayout>
			<section className="px-12 pt-[20svh]">
				<h1 className="text-[40px] font-bold tracking-tight">{title}</h1>
				<p className="mt-3 text-lg text-cobalt-muted">준비 중입니다.</p>
			</section>
		</PublicLayout>
	);
}
