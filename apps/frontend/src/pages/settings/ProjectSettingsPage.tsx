import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { deleteProject, getSigningSecret, rotateSigningSecret, updateProject } from '@/api/projects';
import { useProject } from '@/auth/project';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyButton } from '@/pages/sources/SourcesPage';

// 지금 보고 있는 프로젝트의 설정. 이름, 전달 서명 키, 삭제. 바꾸는 건 admin 이상만
export function ProjectSettingsPage() {
	const { current } = useProject();
	if (!current) return <p className="pt-4 text-muted-foreground">프로젝트를 먼저 만드세요.</p>;
	// 프로젝트가 바뀌면 입력 상태를 처음부터 다시 만든다
	return <ProjectSettings key={current.id} />;
}

function ProjectSettings() {
	const { current: project, projects, select } = useProject();
	const current = project!;
	const client = useQueryClient();
	const navigate = useNavigate();
	const isAdmin = current.org.role !== 'member';
	const orgId = current.org.id;
	const projectId = current.id;

	const [name, setName] = useState(current.name);
	const [secret, setSecret] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<'rotate' | 'delete' | null>(null);

	const rename = useMutation({
		mutationFn: () => updateProject(orgId, projectId, name.trim()),
		onSuccess: async () => {
			toast.success('이름을 바꿨습니다.');
			await client.invalidateQueries({ queryKey: ['projects'] });
		},
		onError: (error) => toast.error(errorMessage(error)),
	});
	const reveal = useMutation({ mutationFn: () => getSigningSecret(orgId, projectId), onSuccess: setSecret, onError: (error) => toast.error(errorMessage(error)) });
	const rotate = useMutation({
		mutationFn: () => rotateSigningSecret(orgId, projectId),
		onSuccess: (next) => {
			setSecret(next);
			toast.success('새 키를 만들었습니다. 이제부터 전달은 새 키로 서명합니다. 목적지 쪽 검증 키를 바꾸세요.');
		},
		onError: (error) => toast.error(errorMessage(error)),
	});
	const remove = useMutation({
		mutationFn: () => deleteProject(orgId, projectId),
		onSuccess: async () => {
			toast.success('프로젝트를 지웠습니다.');
			const other = projects.find((p) => p.id !== projectId);
			if (other) select(other.id);
			await client.invalidateQueries({ queryKey: ['projects'] });
			void navigate('/app/events');
		},
		onError: (error) => toast.error(errorMessage(error)),
	});

	return (
		<div className="max-w-[720px]">
			<div className="flex items-center pt-3">
				<h1 className="text-[26px] font-medium tracking-tight">프로젝트 설정</h1>
				<span className="ml-3 text-[13px] text-muted-foreground">{current.org.name} · 내 역할 {current.org.role}</span>
			</div>
			{!isAdmin && <p className="mt-2 text-sm text-muted-foreground">바꾸려면 admin 이상이어야 합니다. 보기만 할 수 있습니다.</p>}

			<section className="mt-6 rounded-lg bg-card p-5">
				<h2 className="text-sm font-semibold">이름</h2>
				<form
					className="mt-3 flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						rename.mutate();
					}}
				>
					<Input aria-label="프로젝트 이름" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} className="max-w-[360px]" />
					<Button type="submit" size="sm" disabled={!isAdmin || !name.trim() || name.trim() === current.name || rename.isPending}>
						저장
					</Button>
				</form>
			</section>

			<section className="mt-4 rounded-lg bg-card p-5">
				<h2 className="text-sm font-semibold">전달 서명 키</h2>
				<p className="mt-1 text-sm text-muted-foreground">목적지로 보내는 요청의 X-Hookbuffer-Signature는 이 키로 계산한 본문의 HMAC-SHA256(base64)입니다. 고객 서버가 이 키로 검증하면 hookbuffer이 보낸 요청만 받을 수 있습니다.</p>
				{isAdmin ? (
					<div className="mt-3 flex items-center gap-2">
						{secret ? (
							<>
								<Input readOnly aria-label="서명 키" value={secret} className="max-w-[460px] font-mono text-xs" />
								<CopyButton text={secret} label="서명 키 복사" />
							</>
						) : (
							<Button type="button" size="sm" variant="outline" disabled={reveal.isPending} onClick={() => reveal.mutate()}>
								키 보기
							</Button>
						)}
						<Button type="button" size="sm" variant="outline" disabled={rotate.isPending} onClick={() => setConfirm('rotate')}>
							키 교체
						</Button>
					</div>
				) : (
					<p className="mt-3 text-sm text-muted-foreground">admin 이상만 볼 수 있습니다.</p>
				)}
			</section>

			{isAdmin && (
				<section className="mt-4 rounded-lg bg-card p-5">
					<h2 className="text-sm font-semibold">프로젝트 삭제</h2>
					<p className="mt-1 text-sm text-muted-foreground">소스·목적지·연결·이벤트·전달 기록이 전부 같이 지워지고 되돌릴 수 없습니다.</p>
					<Button type="button" size="sm" variant="destructive" className="mt-3" onClick={() => setConfirm('delete')}>
						이 프로젝트 삭제
					</Button>
				</section>
			)}

			<AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="font-sans">{confirm === 'rotate' ? '서명 키를 교체할까요?' : `"${current.name}" 프로젝트를 지울까요?`}</AlertDialogTitle>
						<AlertDialogDescription>{confirm === 'rotate' ? '옛 키로 검증하는 목적지는 그 뒤 전달을 거부하게 됩니다. 목적지 쪽 키를 먼저 바꿀 준비를 하세요.' : '소스·목적지·이벤트·전달 기록이 전부 지워집니다. 되돌릴 수 없습니다.'}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>그대로 두기</AlertDialogCancel>
						<AlertDialogAction
							variant={confirm === 'delete' ? 'destructive' : 'default'}
							onClick={() => {
								const action = confirm;
								setConfirm(null);
								if (action === 'rotate') rotate.mutate();
								else remove.mutate();
							}}
						>
							{confirm === 'rotate' ? '교체' : '지우기'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
