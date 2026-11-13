import { randomUUID } from 'node:crypto';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';
import type { ErrorBody } from '@/common/http/http-exception.filter';
import { configureApp } from '@/common/configure-app';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { GOOGLE_ID_TOKEN_VERIFIER, type GoogleIdTokenVerifier, type GoogleProfile } from '@/modules/auth/ports/google-id-token.verifier';
import { type Mail, MAILER, type Mailer } from '@/modules/invitations/ports/mailer';

// e2e 공통. 실제 구글 대신 'google:<key>' 토큰을 프로필로 바꿔 주는 fake, 메일은 보낸 것을 모아 두는 fake로
// AppModule을 띄운다.
export type LoggedIn = { token: string; user_id: number; org_id: number; profile: GoogleProfile };

export type TestApp = {
	app: NestFastifyApplication;
	prisma: PrismaService;
	http: () => ReturnType<typeof request>;
	// 보낸 메일. 초대 수락 토큰은 여기서 꺼낸다
	mails: Mail[];
	login: () => Promise<LoggedIn>;
	close: () => Promise<void>;
};

export async function createTestApp(): Promise<TestApp> {
	const profiles = new Map<string, GoogleProfile>();
	const fakeGoogle: GoogleIdTokenVerifier = { verify: (idToken) => Promise.resolve(profiles.get(idToken) ?? null) };
	const emails: string[] = [];
	const mails: Mail[] = [];
	const fakeMailer: Mailer = { send: (mail) => Promise.resolve(void mails.push(mail)) };

	const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(GOOGLE_ID_TOKEN_VERIFIER)
		.useValue(fakeGoogle)
		.overrideProvider(MAILER)
		.useValue(fakeMailer)
		.compile();
	const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
	configureApp(app);
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
	const prisma = app.get(PrismaService);

	// 새 구글 유저로 가입·로그인한다. org_id는 가입 때 생긴 개인 조직
	async function login(): Promise<LoggedIn> {
		const key = randomUUID();
		const profile = { sub: `sub-${key}`, email: `${key}@test.munjigi.local`, email_verified: true, name: 'e2e', picture: 'https://example.com/a.png' };
		profiles.set(`google:${key}`, profile);
		emails.push(profile.email);
		const response = await request(app.getHttpServer()).post('/auth/google').send({ id_token: `google:${key}` }).expect(200);
		const member = await prisma.organization_member.findFirstOrThrow({ where: { user: { email: profile.email } } });
		return { token: (response.body as { access_token: string }).access_token, user_id: member.user_id, org_id: member.organization_id, profile };
	}

	// login()으로 만든 유저와, 그 유저가 owner인 조직을 지운다
	async function close(): Promise<void> {
		const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
		const userIds = users.map((u) => u.id);
		const owned = await prisma.organization_member.findMany({ where: { user_id: { in: userIds }, role: 'owner' }, select: { organization_id: true } });
		const orgIds = owned.map((o) => o.organization_id);
		await prisma.project.deleteMany({ where: { organization_id: { in: orgIds } } });
		await prisma.invitation.deleteMany({ where: { OR: [{ invited_by_user_id: { in: userIds } }, { organization_id: { in: orgIds } }] } });
		await prisma.organization_member.deleteMany({ where: { OR: [{ user_id: { in: userIds } }, { organization_id: { in: orgIds } }] } });
		await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
		await prisma.user_identity.deleteMany({ where: { user_id: { in: userIds } } });
		await prisma.user.deleteMany({ where: { id: { in: userIds } } });
		await app.close();
	}

	return { app, prisma, http: () => request(app.getHttpServer()), mails, login, close };
}

// supertest의 body는 any다. 응답 형식을 타입으로 못 박는다
export const errorOf = (response: request.Response) => response.body as ErrorBody;
