import { randomUUID } from 'node:crypto';
import { Controller, Get, Module } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import type { ErrorBody } from '@/common/http/http-exception.filter';
import { Actor, Roles } from '@/common/auth/decorators';
import { configureApp } from '@/common/configure-app';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { GOOGLE_ID_TOKEN_VERIFIER, type GoogleIdTokenVerifier, type GoogleProfile } from '@/modules/auth/ports/google-id-token.verifier';

// 가드 동작만 보기 위한 테스트 전용 라우트. 전역 가드라 AppModule 밖의 컨트롤러에도 걸린다.
@Controller('e2e-probe')
class ProbeController {
	@Get('bare')
	bare() {
		return {};
	}

	@Roles()
	@Get('me')
	me(@Actor() actor: Actor) {
		return actor;
	}

	@Roles('admin')
	@Get('orgs/:orgId')
	org(@Actor() actor: Actor) {
		return actor;
	}
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

// 실제 구글 대신 'google:<key>' 토큰을 프로필로 바꿔 준다
const profiles = new Map<string, GoogleProfile>();
const fakeGoogle: GoogleIdTokenVerifier = { verify: (idToken) => Promise.resolve(profiles.get(idToken) ?? null) };

// supertest의 body는 any다. 응답 형식을 타입으로 못 박는다
const errorOf = (response: request.Response) => response.body as ErrorBody;

function newGoogleUser(): string {
	const key = randomUUID();
	profiles.set(`google:${key}`, { sub: `sub-${key}`, email: `${key}@test.hookbuffer.local`, email_verified: true, name: 'e2e', picture: null });
	return `google:${key}`;
}

describe('auth (e2e)', () => {
	let app: NestFastifyApplication;
	let prisma: PrismaService;
	const emails: string[] = [];

	async function login(idToken: string): Promise<string> {
		emails.push(profiles.get(idToken)!.email);
		const response = await request(app.getHttpServer()).post('/auth/google').send({ id_token: idToken }).expect(200);
		return (response.body as { access_token: string }).access_token;
	}

	async function personalOrgId(idToken: string): Promise<number> {
		const member = await prisma.organization_member.findFirstOrThrow({ where: { user: { email: profiles.get(idToken)!.email } } });
		return member.organization_id;
	}

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
			.overrideProvider(GOOGLE_ID_TOKEN_VERIFIER)
			.useValue(fakeGoogle)
			.compile();

		app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
		configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		prisma = app.get(PrismaService);
	});

	afterAll(async () => {
		const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
		const userIds = users.map((u) => u.id);
		const orgs = await prisma.organization_member.findMany({ where: { user_id: { in: userIds }, role: 'owner' }, select: { organization_id: true } });
		const orgIds = orgs.map((o) => o.organization_id);
		await prisma.organization_member.deleteMany({ where: { OR: [{ user_id: { in: userIds } }, { organization_id: { in: orgIds } }] } });
		await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
		await prisma.user_identity.deleteMany({ where: { user_id: { in: userIds } } });
		await prisma.user.deleteMany({ where: { id: { in: userIds } } });
		await app.close();
	});

	describe('POST /auth/google', () => {
		it('첫 로그인 시 organization(free)·user_identity·member(owner)를 만들고, 두 번째는 다시 만들지 않는다', async () => {
			const idToken = newGoogleUser();
			const { sub, email } = profiles.get(idToken)!;

			await login(idToken);
			await login(idToken);

			const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { identities: true, memberships: { include: { organization: true } } } });
			expect(user.identities).toMatchObject([{ provider: 'google', provider_user_id: sub }]);
			expect(user.memberships).toHaveLength(1);
			expect(user.memberships[0]).toMatchObject({ role: 'owner', organization: { plan: 'free' } });
		});

		it('구글 토큰이 유효하지 않으면 401 unauthenticated', async () => {
			const response = await request(app.getHttpServer()).post('/auth/google').send({ id_token: 'google:unknown' }).expect(401);
			expect(errorOf(response).code).toBe('unauthenticated');
		});

		it('id_token이 없으면 400 validation_failed와 필드별 details', async () => {
			const response = await request(app.getHttpServer()).post('/auth/google').send({}).expect(400);
			expect(errorOf(response).code).toBe('validation_failed');
			expect(errorOf(response).details?.map((d) => d.field)).toContain('id_token');
		});
	});

	describe('전역 가드', () => {
		it('@Public·@Roles가 없는 라우트는 로그인해도 403 (deny-by-default)', async () => {
			const token = await login(newGoogleUser());
			const response = await request(app.getHttpServer()).get('/e2e-probe/bare').set('Authorization', `Bearer ${token}`).expect(403);
			expect(errorOf(response).code).toBe('forbidden');
		});

		it('@Roles() 라우트는 토큰이 없으면 401, 있으면 조직 없는 주체', async () => {
			await request(app.getHttpServer()).get('/e2e-probe/me').expect(401);

			const token = await login(newGoogleUser());
			const response = await request(app.getHttpServer()).get('/e2e-probe/me').set('Authorization', `Bearer ${token}`).expect(200);
			expect(response.body).toMatchObject({ kind: 'user', org_id: null, role: null });
		});

		it('내 조직은 통과, 타 조직 리소스는 404, 소속이지만 role이 부족하면 403', async () => {
			const alice = newGoogleUser();
			const bob = newGoogleUser();
			const aliceToken = await login(alice);
			await login(bob);
			const aliceOrg = await personalOrgId(alice);
			const bobOrg = await personalOrgId(bob);

			const own = await request(app.getHttpServer()).get(`/e2e-probe/orgs/${aliceOrg}`).set('Authorization', `Bearer ${aliceToken}`).expect(200);
			expect(own.body).toMatchObject({ org_id: aliceOrg, role: 'owner' });

			const other = await request(app.getHttpServer()).get(`/e2e-probe/orgs/${bobOrg}`).set('Authorization', `Bearer ${aliceToken}`).expect(404);
			expect(errorOf(other).code).toBe('organization_not_found');

			const aliceUser = await prisma.user.findUniqueOrThrow({ where: { email: profiles.get(alice)!.email } });
			// free는 멤버 1명 상한이라 2명이 되면 plan_limit이 먼저 걸린다. role 검사만 보려고 team으로 올린다
			await prisma.organization.update({ where: { id: bobOrg }, data: { plan: 'team' } });
			await prisma.organization_member.create({ data: { organization_id: bobOrg, user_id: aliceUser.id, role: 'member' } });
			const member = await request(app.getHttpServer()).get(`/e2e-probe/orgs/${bobOrg}`).set('Authorization', `Bearer ${aliceToken}`).expect(403);
			expect(errorOf(member).code).toBe('forbidden');
		});
	});
});
