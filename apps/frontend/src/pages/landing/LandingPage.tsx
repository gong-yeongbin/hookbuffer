import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { getToken } from '@/auth/token';
import { Faq } from '@/components/Faq';
import { useLandingOnly } from '@/config';
import { StatusTag } from '@/components/StatusTag';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PublicLayout } from '@/layout/PublicLayout';
import { AttemptsFragment, EventsFragment, Panel, SOURCE_URL, SourceFragment } from './fragments';

// 방향 "제품이 직접 동작"(context-notes 2026-10-28): 설명 대신 실제 화면 조각이 일한다.
// 첫 화면은 제목 + 코발트 무대 위의 이벤트 화면. 무대 왼쪽 위 모서리를 계단형으로 깎는다(이 페이지의 유일한 장식)
export function LandingPage() {
	const landingOnly = useLandingOnly();
	// 이미 로그인돼 있으면 대시보드로. 랜딩만 공개한 배포에서는 /app이 다시 /로 오므로 보내지 않는다
	if (getToken() && !landingOnly) return <Navigate to="/app" replace />;

	return (
		<PublicLayout>
			<Hero />
			<HowItWorks />
			<Features />
			<Pricing />
			<section className="px-12 py-[160px]">
				<Faq />
			</section>
			<Cta />
		</PublicLayout>
	);
}

function Hero() {
	const landingOnly = useLandingOnly();
	return (
		<section className="relative min-h-[90svh] overflow-hidden">
			<div className="max-w-[46%] px-12 pt-[110px]">
				<h1 className="text-[clamp(52px,5.2vw,80px)] leading-[0.98] font-bold tracking-[-0.035em] [word-break:keep-all]">
					웹훅을 받아 두고
					<br />
					답할 때까지 보낸다
				</h1>
				<p className="mt-7 max-w-[40ch] text-lg leading-relaxed text-cobalt-muted">외부 서비스의 웹훅을 대신 받아 저장하고, 서버가 답할 때까지 재시도하며 전달합니다. 전부 기록되고, 다시 보낼 수 있습니다.</p>
				{landingOnly ? (
					<span aria-disabled className={cn(buttonVariants({ size: 'lg' }), 'mt-8 pointer-events-none opacity-60')}>
						준비 중
					</span>
				) : (
					<Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}>
						무료로 시작하기
					</Link>
				)}
			</div>
			{/* 무대. clip-path가 자식도 자르므로 화면 조각은 깎인 모서리 아래에 둔다 */}
			<div className="hero-stage absolute top-[42%] right-[-40px] bottom-[-40px] left-[38%] bg-primary">
				<EventsFragment className="absolute top-[calc(12%+56px)] left-14" />
			</div>
		</section>
	);
}

const CURL = `curl -X POST ${SOURCE_URL} \\
  -H 'content-type: application/json' \\
  -d '{"orderId":"A-1042","status":"DONE"}'`;

// 주고받기 세 번. 좁은 한 열, 응답은 56px 들여쓴다. 셋째 응답만 열 밖으로 넓어진다
function HowItWorks() {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		await navigator.clipboard.writeText(CURL);
		setCopied(true);
	};
	return (
		<section className="px-12 pt-[180px]">
			<div className="ml-[25%] max-w-[560px]">
				<h2 className="text-[28px] font-bold tracking-tight">이렇게 동작합니다</h2>

				<p className="mt-14 text-xl font-medium">먼저, 소스를 만듭니다.</p>
				<div className="mt-4 rounded-lg bg-sand-2 p-5">
					<SourceFragment />
				</div>

				<p className="mt-[88px] text-xl font-medium">그다음, 업체 설정에 그 주소를 넣습니다.</p>
				<div className="relative mt-4 rounded-lg bg-sand-2 p-5">
					<pre className="overflow-x-auto text-sm leading-relaxed">
						<code>{CURL}</code>
					</pre>
					<Button type="button" variant="outline" size="sm" className="absolute top-3 right-3 bg-card" onClick={() => void copy()}>
						{copied ? '복사됨' : '복사'}
					</Button>
				</div>
				<div className="mt-4 ml-14">
					<EventsFragment rows={1} className="w-[504px]" />
				</div>

				<p className="mt-[88px] text-xl font-medium">이제 서버가 답할 때까지 hookbuffer이 보냅니다.</p>
				<p className="mt-2 text-cobalt-muted">꺼져 있으면 기다렸다 다시 보내고, 시도마다 기록합니다.</p>
			</div>
			<div className="mt-4 ml-[calc(25%+56px)]">
				<AttemptsFragment />
			</div>
		</section>
	);
}

// 여섯 칸. 글과 화면 조각이 위아래로 엇갈려 체크무늬가 된다
const FEATURES: { title: string; body: string; fragment: ReactNode }[] = [
	{
		title: '받는 즉시 저장, 중복은 한 번만',
		body: '업체가 같은 웹훅을 두 번 보내도 이벤트는 하나입니다. 업체 이벤트 ID가 있으면 그것으로, 없으면 본문 해시로 가립니다.',
		fragment: (
			<Panel label="중복 처리 예시" className="w-[320px] p-4">
				<p className="text-muted-foreground">멱등 키</p>
				<p className="mt-1 break-all">id:evt_7d10c3…9e</p>
				<p className="mt-3 text-muted-foreground">같은 키로 다시 옴 → 200, 새 전달 없음</p>
			</Panel>
		),
	},
	{
		title: '재시도는 연결마다 정합니다',
		body: '같은 간격 또는 2배씩, 간격과 횟수. 기본은 2배씩·5분·9회로 약 1.8일 동안 보냅니다. 목적지가 Retry-After를 주면 그 값을 따릅니다.',
		fragment: (
			<Panel label="재시도 설정 예시" className="w-[320px] p-4">
				<div className="grid grid-cols-3 gap-2 text-center">
					{[
						['방식', '2배씩'],
						['간격', '5분'],
						['횟수', '9회'],
					].map(([k, v]) => (
						<div key={k} className="rounded-md border px-2 py-2">
							<p className="text-muted-foreground">{k}</p>
							<p className="font-medium">{v}</p>
						</div>
					))}
				</div>
			</Panel>
		),
	},
	{
		title: '업체 서명을 확인하고, 우리 서명을 붙입니다',
		body: '소스마다 서명 헤더·인코딩·대상 문자열을 적어 두면 HMAC-SHA256으로 검증합니다. 목적지로 보낼 때는 프로젝트 서명 키로 다시 서명합니다.',
		fragment: (
			<Panel label="서명 확인 예시" className="w-[320px] p-4">
				<pre className="text-xs leading-relaxed">
					<code>{'x-signature: t=1729…,v1=3f9a…\nx-event-id: evt_7d10c3'}</code>
				</pre>
				<p className="mt-2 flex items-center gap-2">
					서명 <StatusTag status="succeeded" />
				</p>
			</Panel>
		),
	},
	{
		title: '목적지가 흔들리면 멈춰서 기다립니다',
		body: '목적지별 동시 요청 수를 제한하고, 5번 연속 실패하면 60초 동안 보내지 않습니다. 연결을 일시 정지하면 보류해 두었다가 풀면 이어 보냅니다.',
		fragment: (
			<Panel label="목적지 상태 예시" className="w-[320px] p-4">
				<p className="font-medium">api.shop.example</p>
				<p className="mt-1 text-bad">서킷 열림 · 58초 뒤 다시 시도</p>
				<p className="mt-1 text-muted-foreground">동시 2 / 2 · 최근 실패 5회</p>
			</Panel>
		),
	},
	{
		title: '실패한 건은 다시 보냅니다',
		body: '전달 한 건을 다시 시도하거나, 조건으로 골라 한 번에 최대 1,000건. 이벤트 리플레이는 새 이벤트로 지금의 연결 전부에 보냅니다.',
		fragment: (
			<Panel label="재전송 예시" className="w-[320px] p-4">
				<div className="flex items-center gap-2">
					<span className={buttonVariants({ size: 'sm' })}>리플레이</span>
					<span className={buttonVariants({ size: 'sm', variant: 'outline' })}>다시 시도</span>
				</div>
				<p className="mt-3 text-muted-foreground">실패 10건 → 대기로 바뀜</p>
			</Panel>
		),
	},
	{
		title: '거부한 요청도 남깁니다',
		body: '서명이 틀렸거나 연결이 없어 받지 않은 요청은 사유와 헤더를 따로 기록합니다. "왜 안 들어오지"를 여기서 봅니다.',
		fragment: (
			<Panel label="거부된 요청 예시" className="w-[320px]">
				{[
					['2분 전', '서명 불일치'],
					['1시간 전', '연결 없음'],
					['어제', '본문 초과'],
				].map(([at, why]) => (
					<div key={why} className="flex h-[42px] items-center gap-4 border-b px-4 last:border-0">
						<span className="text-muted-foreground">{at}</span>
						<span className="text-destructive">{why}</span>
					</div>
				))}
			</Panel>
		),
	},
];

function Features() {
	return (
		<section className="px-12 pt-[200px]">
			<h2 className="text-[36px] font-bold tracking-tight">들어 있는 것</h2>
			<div className="mt-14 grid grid-cols-3 gap-2">
				{FEATURES.map((f, i) => {
					// 첫 줄은 글·조각·글, 둘째 줄은 그 반대
					const textTop = i < 3 ? i % 2 === 0 : i % 2 === 1;
					return (
						<div key={f.title} className="relative h-[320px] overflow-hidden rounded-lg bg-sand-2">
							<div className={cn('absolute inset-x-0 p-6', textTop ? 'top-0' : 'bottom-0')}>
								<h3 className="text-[17px] font-medium">{f.title}</h3>
								<p className="mt-2 text-[15px] leading-relaxed text-cobalt-muted">{f.body}</p>
							</div>
							<div className={cn('absolute right-[-24px]', textTop ? 'bottom-[-12px]' : 'top-[-12px]')}>{f.fragment}</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

// 카드 없이 숫자 하나
function Pricing() {
	const landingOnly = useLandingOnly();
	return (
		<section className="grid min-h-[80svh] grid-cols-12 items-center gap-8 px-12 pt-[120px]">
			<div className="col-span-4 self-start pt-6">
				<h2 className="text-[32px] font-bold tracking-tight">0원으로 시작</h2>
				<p className="mt-4 text-[17px] leading-relaxed text-cobalt-muted">카드 없이 바로 씁니다. 팀이 커지면 월 49,000원의 Team으로 올립니다. 포함량을 넘긴 만큼만 더 냅니다.</p>
			</div>
			<div className="col-span-7 col-start-6">
				<p className="relative inline-block text-[clamp(120px,16vw,240px)] leading-[0.85] font-bold tracking-[-0.04em]">
					<span className="relative">0</span>
					<span className="relative align-top text-[0.5em]">원</span>
					<span className="relative ml-3 text-lg font-normal tracking-normal text-cobalt-muted">/ 월</span>
				</p>
				<ul className="mt-10 m-0 list-none space-y-1 p-0 text-lg">
					<li>월 1,000 이벤트</li>
					<li>보존 3일</li>
					<li>소스·목적지 각 3개</li>
					<li>자동 재시도, 서명 검증, 재전송 전부 포함</li>
				</ul>
				{landingOnly ? (
					<span aria-disabled className={cn(buttonVariants({ size: 'lg' }), 'mt-8 pointer-events-none opacity-60')}>
						준비 중
					</span>
				) : (
					<Link to="/pricing" className={cn(buttonVariants({ size: 'lg' }), 'mt-8')}>
						요금 자세히 보기
					</Link>
				)}
			</div>
		</section>
	);
}

// 페이지 끝은 제품의 첫 화면이 이미 열려 있다. 입력한 이름은 로그인으로 넘긴다
function Cta() {
	const landingOnly = useLandingOnly();
	const navigate = useNavigate();
	const [name, setName] = useState('shop');
	return (
		<section className="grid min-h-[90svh] grid-cols-12 bg-primary px-12 text-sand">
			<div className="col-span-5 self-end pb-10">
				<p className="text-[clamp(48px,6vw,96px)] leading-[0.92] font-bold tracking-[-0.035em] [word-break:keep-all]">
					프로젝트 하나로
					<br />
					시작합니다
				</p>
				<p className="mt-6 text-[17px] text-sand/80">{landingOnly ? '곧 열립니다. 열리면 구글 로그인 한 번이면 됩니다.' : '구글 로그인 한 번이면 됩니다. 카드는 필요 없습니다.'}</p>
			</div>
			<form
				data-ui
				className="col-span-5 col-start-7 w-[440px] self-center rounded-lg bg-card p-6 text-card-foreground shadow-lg"
				onSubmit={(e) => {
					e.preventDefault();
					void navigate(`/login?project=${encodeURIComponent(name.trim())}`);
				}}
			>
				<h2 className="text-lg font-semibold">새 프로젝트</h2>
				<label htmlFor="landing-project-name" className="mt-5 block text-sm font-medium">
					이름
				</label>
				<Input id="landing-project-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-9" />
				<Button type="submit" size="lg" className="mt-5 w-full" disabled={landingOnly || !name.trim()}>
					{landingOnly ? '준비 중' : '만들고 시작하기'}
				</Button>
			</form>
		</section>
	);
}
