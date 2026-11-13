// 로컬 개발용 시드. Node 24가 타입을 지우고 바로 실행한다(`prisma db seed` → `node prisma/seed.mts`).
// 그래서 enum·파라미터 프로퍼티처럼 타입 제거만으로 안 되는 문법을 쓰지 않는다.
import { createCipheriv, randomBytes, randomInt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const SEED_EMAIL = 'seed@munjigi.local';
const SEED_TEAM = '시드 팀';
const SEED_PROJECT = '시드 프로젝트';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// src/infra/cipher/cipher.service.ts와 같은 형식이다(base64(iv 12B + tag 16B + 암호문)). 시드는 타입만 지우고
// 실행해서 데코레이터가 있는 src를 import할 수 없어 여기 따로 둔다. 형식을 바꾸면 여기도 같이 바꾼다.
function encrypt(plain: string): string {
	const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
	if (key.length !== 32) throw new Error('ENCRYPTION_KEY는 base64로 인코딩한 32바이트여야 합니다.');
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

// src/modules/sources/domain/slug.ts와 같은 모양(소문자·숫자 20자)
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newSlug = (): string => Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

async function seedAccount(): Promise<void> {
	// 조직에는 유니크 키가 없어 upsert할 수 없다. 시드 유저가 있으면 이미 시드된 DB로 보고 건너뛴다.
	if (await prisma.user.findUnique({ where: { email: SEED_EMAIL } })) {
		console.log('시드 유저가 이미 있어 계정 시드는 건너뜁니다.');
		return;
	}

	const now = new Date();
	const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

	await prisma.$transaction(async (tx) => {
		const user = await tx.user.create({
			data: {
				email: SEED_EMAIL,
				name: '시드 유저',
				identities: { create: { provider: 'google', provider_user_id: 'seed-google-sub' } },
			},
		});

		// 첫 로그인 때 생기는 개인 조직과 같은 모양. free라 subscription이 없다.
		await tx.organization.create({
			data: {
				name: '시드 유저의 조직',
				plan: 'free',
				members: { create: { user_id: user.id, role: 'owner' } },
			},
		});

		await tx.organization.create({
			data: {
				name: SEED_TEAM,
				plan: 'team',
				members: { create: { user_id: user.id, role: 'owner' } },
				subscription: {
					create: {
						plan: 'team',
						status: 'active',
						customer_key: 'seed-customer-key',
						// 암호화 모듈(4. billing) 전이라 복호화할 수 없는 자리표시값이다. 결제 배치에 쓰지 않는다.
						billing_key_enc: 'seed-placeholder',
						card_issuer_code: '11',
						card_number_masked: '1234-****-****-5678',
						current_period_start: periodStart,
						current_period_end: periodEnd,
					},
				},
			},
		});
	});

	console.log('계정 시드 완료: 유저 1, 조직 2(free, team), 구독 1');
}

// 계정 시드와 따로 멱등하게 둔다. 계정만 시드된 DB에도 다음 실행 때 들어간다.
async function seedGateway(): Promise<void> {
	const team = await prisma.organization.findFirstOrThrow({ where: { name: SEED_TEAM, members: { some: { user: { email: SEED_EMAIL } } } } });
	if (await prisma.project.findFirst({ where: { organization_id: team.id, name: SEED_PROJECT } })) {
		console.log('시드 프로젝트가 이미 있어 수신·전달 시드는 건너뜁니다.');
		return;
	}

	await prisma.$transaction(async (tx) => {
		const project = await tx.project.create({
			data: {
				organization_id: team.id,
				name: SEED_PROJECT,
				sources: {
					create: [
						// 토스 결제 웹훅·포트원 V1처럼 서명을 보내지 않는 업체
						{ slug: newSlug(), name: '서명 없음' },
						{
							slug: newSlug(),
							name: '서명 있음 (GitHub 형식)',
							signing_secret_enc: encrypt('seed-signing-secret'),
							signature_config: {
								header: 'x-hub-signature-256',
								encoding: 'hex',
								secret_encoding: 'utf8',
								prefix: 'sha256=',
								signed_payload: '{body}',
								tolerance_sec: 300,
								event_id_header: 'x-github-delivery',
							},
						},
					],
				},
				destinations: {
					create: [{ name: '로컬 수신 서버', url: 'http://localhost:4010/webhooks', headers_enc: encrypt(JSON.stringify({ Authorization: 'Bearer seed-destination-token' })) }],
				},
			},
			include: { sources: { select: { id: true } }, destinations: { select: { id: true } } },
		});

		// 소스마다 모든 목적지로 잇는다
		await tx.connection.createMany({
			data: project.sources.flatMap((s) => project.destinations.map((d) => ({ source_id: s.id, destination_id: d.id }))),
		});
	});

	console.log('수신·전달 시드 완료: 프로젝트 1, 소스 2(서명 없음, 서명 있음), 목적지 1, 연결 2');
}

try {
	await seedAccount();
	await seedGateway();
} finally {
	await prisma.$disconnect();
}
