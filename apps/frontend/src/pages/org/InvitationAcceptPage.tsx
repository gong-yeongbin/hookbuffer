import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { errorMessage } from '@/api/client';
import { acceptInvitation } from '@/api/orgs';
import { buttonVariants } from '@/components/ui/button';

// 초대 메일의 링크. 로그인한 뒤 열리면 바로 수락한다. 이메일이 다르면 백엔드가 거부한다
export function InvitationAcceptPage() {
	const { token = '' } = useParams();
	const client = useQueryClient();
	const accept = useMutation({
		mutationFn: () => acceptInvitation(token),
		onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
	});
	const run = accept.mutate;
	useEffect(() => run(), [run]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-sand">
			<div className="w-[420px] rounded-lg bg-card px-8 py-10 text-center text-card-foreground">
				<p className="font-heading text-2xl font-bold tracking-tight text-primary">munjigi</p>
				{accept.isPending && <p className="mt-6 text-muted-foreground">초대를 확인하는 중</p>}
				{accept.isSuccess && (
					<>
						<p className="mt-6 font-medium">조직에 들어왔습니다.</p>
						<Link to="/app" className={`${buttonVariants({ size: 'lg' })} mt-6`}>
							대시보드로
						</Link>
					</>
				)}
				{accept.isError && (
					<>
						<p role="alert" className="mt-6 text-destructive">
							{errorMessage(accept.error)}
						</p>
						<p className="mt-2 text-sm text-muted-foreground">초대받은 이메일의 구글 계정으로 로그인했는지 확인하세요.</p>
						<Link to="/app" className={`${buttonVariants({ size: 'lg', variant: 'outline' })} mt-6`}>
							대시보드로
						</Link>
					</>
				)}
			</div>
		</div>
	);
}
