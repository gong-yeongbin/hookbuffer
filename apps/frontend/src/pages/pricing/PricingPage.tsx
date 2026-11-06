import { cn } from 'cn';
import { CheckIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Faq } from '@/components/Faq';
import { buttonVariants } from '@/components/ui/button';
import { useLandingOnly } from '@/config';
import { PublicLayout } from '@/layout/PublicLayout';

// 값은 plan.md 결정 11과 백엔드 plan-limits.ts와 같다. 바꾸면 셋을 같이 바꾼다.
// 초과 단가의 구간 할인(500만 건 이후)은 여기 안 적는다. 볼 사람이 거의 없다.
// business는 team과 보존일만 달라 요금표에서 뺐다(2026-10-15). 차별화는 billing 때 정한다
const PLANS = [
	{ name: 'Free', price: '0원', rows: ['월 1,000 이벤트', '초과 시 거부', '멤버 1명', '프로젝트 1개', '소스·목적지 각 3개', '보존 3일'] },
	{ name: 'Team', price: '49,000원', rows: ['월 10,000 이벤트', '초과 10만 건당 10,000원부터', '멤버 무제한', '프로젝트 무제한', '소스·목적지 무제한', '보존 7일'] },
];

// 플랜과 무관하게 전부 들어 있는 것
const INCLUDED = ['자동 재시도 무료', '서명 검증', '대시보드에서 재전송', '내부망 주소 차단'];

export function PricingPage() {
	const landingOnly = useLandingOnly();
	return (
		<PublicLayout>
			<section className="px-12 pt-[96px]">
				<h1 className="text-[40px] font-bold tracking-tight">요금</h1>
				<p className="mt-4 text-lg text-cobalt-muted">월 정액에 이벤트가 포함되고, 넘으면 건당 종량입니다.</p>

				{/* 선 없이 한 톤 어두운 칸 둘 */}
				<div className="mt-12 grid max-w-[880px] grid-cols-2 gap-2">
					{PLANS.map((plan) => (
						<div key={plan.name} className="rounded-lg bg-sand-2 p-7">
							<p className="text-[15px] font-semibold text-cobalt-muted">{plan.name}</p>
							<p className="mt-2">
								<span className="text-[32px] font-bold tracking-tight">{plan.price}</span>
								<span className="ml-1 text-sm text-cobalt-muted">/ 월</span>
							</p>
							<ul className="mt-6 m-0 list-none space-y-2.5 p-0 text-[15px]">
								{plan.rows.map((row) => (
									<li key={row}>{row}</li>
								))}
							</ul>
							{landingOnly ? (
								<span aria-disabled className={cn(buttonVariants({ size: 'lg' }), 'mt-7 w-full pointer-events-none opacity-60')}>
									준비 중
								</span>
							) : (
								<Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'mt-7 w-full')}>
									시작하기
								</Link>
							)}
						</div>
					))}
				</div>

				<div className="mt-2 max-w-[880px] rounded-lg bg-sand-2 px-6 py-4">
					<p className="text-[13px] text-cobalt-muted">모든 플랜 공통</p>
					<div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2 text-[15px]">
						{INCLUDED.map((item) => (
							<p key={item} className="flex items-center gap-2">
								<CheckIcon aria-hidden className="size-4" />
								{item}
							</p>
						))}
					</div>
				</div>
			</section>

			<section className="max-w-[1100px] px-12 pt-[120px]">
				<Faq />
			</section>
		</PublicLayout>
	);
}
