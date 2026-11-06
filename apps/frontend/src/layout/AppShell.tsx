import { cn } from 'cn';
import { ArrowDownToLineIcon, InboxIcon, LinkIcon, type LucideIcon, PlusIcon, SendIcon, ServerIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '@/api/client';
import { useProject } from '@/auth/project';
import { clearToken } from '@/auth/token';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// 왼쪽 레일 메뉴. 아이콘만 보이고 이름은 툴팁과 접근성 이름으로. 경로가 곧 key다
const MENU: { to: string; label: string; icon: LucideIcon }[] = [
	{ to: '/app/events', label: '이벤트', icon: InboxIcon },
	{ to: '/app/deliveries', label: '전달', icon: SendIcon },
	{ to: '/app/connections', label: '연결', icon: LinkIcon },
	{ to: '/app/sources', label: '소스', icon: ArrowDownToLineIcon },
	{ to: '/app/destinations', label: '목적지', icon: ServerIcon },
];

function RailLink({ to, label, icon: Icon, active }: { to: string; label: string; icon: LucideIcon; active: boolean }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<Link to={to} aria-label={label} aria-current={active ? 'page' : undefined} />}
				// 선택 표시는 오른쪽 가장자리의 2px 코발트 선 하나
				className={cn('flex h-10 w-14 items-center justify-center text-muted-foreground hover:text-foreground', active && 'border-r-2 border-primary text-primary')}
			>
				<Icon className="size-[18px]" />
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

const NEW = 'new';

// 대시보드 공통 틀. 56px 아이콘 레일(메뉴 5개 + 맨 아래 계정) + 48px 상단 바(프로젝트). 내용은 전폭(표가 많다)
export function AppShell() {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const project = useProject();
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async () => {
		const orgId = project.current?.org.id ?? project.orgs[0]?.id;
		if (!orgId || !name.trim()) return;
		setSaving(true);
		setError(null);
		try {
			await project.create(orgId, name.trim());
			setCreating(false);
			setName('');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setSaving(false);
		}
	};
	const logout = () => {
		clearToken();
		void navigate('/login', { replace: true });
	};
	type Choice = number | typeof NEW;
	const items: { value: Choice; label: string }[] = [...project.projects.map((p) => ({ value: p.id, label: p.name })), { value: NEW, label: '새 프로젝트' }];
	const selected: Choice | null = project.current?.id ?? null;

	return (
		<div className="flex min-h-screen">
			<aside aria-label="주 메뉴" className="flex w-14 shrink-0 flex-col items-center border-r py-3">
				<Link to="/app" aria-label="hookbuffer 홈" className="font-heading text-xl font-bold text-primary">
					h
				</Link>
				<nav className="mt-5 flex flex-col">
					{MENU.map((item) => (
						<RailLink key={item.to} {...item} active={pathname === item.to} />
					))}
				</nav>
				{/* 계정. 레일 맨 아래. 설정 계열은 전부 여기서 */}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<button type="button" aria-label="내 계정" />}
						className={cn('mt-auto flex h-10 w-14 items-center justify-center text-muted-foreground hover:text-foreground data-popup-open:text-foreground', ['/app/settings', '/app/org', '/app/usage', '/app/me'].some((p) => pathname.startsWith(p)) ? 'border-r-2 border-primary text-primary' : '')}
					>
						<UserIcon className="size-[18px]" />
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="end">
						<DropdownMenuItem onClick={() => void navigate('/app/settings')}>프로젝트 설정</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void navigate('/app/org')}>조직 설정</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void navigate('/app/usage')}>사용량</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => void navigate('/app/me')}>내 정보</DropdownMenuItem>
						<DropdownMenuItem onClick={logout}>로그아웃</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-12 items-center gap-4 px-6">
					<Select<Choice, false> items={items} value={selected} disabled={project.loading} onValueChange={(value) => (value === NEW ? setCreating(true) : value !== null && project.select(value))}>
						<SelectTrigger aria-label="프로젝트" size="sm" className="w-56">
							<SelectValue placeholder="프로젝트" />
						</SelectTrigger>
						<SelectContent>
							{project.projects.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
							{project.projects.length > 0 && <SelectSeparator />}
							<SelectItem value={NEW} className="text-primary">
								<PlusIcon /> 새 프로젝트
							</SelectItem>
						</SelectContent>
					</Select>

				</header>
				<main className="flex-1 px-6 pb-8">
					<Outlet />
				</main>
			</div>

			<Dialog open={creating} onOpenChange={setCreating}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="font-sans">새 프로젝트</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
					>
						<label htmlFor="new-project-name" className="block text-sm font-medium">
							이름
						</label>
						<Input id="new-project-name" placeholder="예: shop" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
						{error && (
							<p role="alert" className="mt-2 text-sm text-destructive">
								{error}
							</p>
						)}
						<DialogFooter className="mt-4">
							<Button type="button" variant="outline" onClick={() => setCreating(false)}>
								취소
							</Button>
							<Button type="submit" disabled={!name.trim() || saving}>
								만들기
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// 아직 안 만든 화면 자리
export function Placeholder() {
	return <p className="pt-4 text-muted-foreground">준비 중</p>;
}
