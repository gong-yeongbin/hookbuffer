import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PrismaUserRepository } from './prisma-user.repository';

// adapter는 docker compose의 postgres 위에서 통합으로 본다(`pnpm docker:up && pnpm db:deploy` 선행).
describe('PrismaUserRepository (통합)', () => {
	const prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
	const users = new PrismaUserRepository(prisma);
	let userId: number;

	beforeAll(async () => {
		const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.munjigi.local`, name: '테스트' } });
		userId = user.id;
	});

	afterAll(async () => {
		await prisma.user.delete({ where: { id: userId } });
		await prisma.$disconnect();
	});

	it('id로 user 행을 찾는다', async () => {
		expect(await users.findById(userId)).toMatchObject({ id: userId, name: '테스트', avatar_url: null });
	});

	it('없는 id는 null', async () => {
		expect(await users.findById(2147483647)).toBeNull();
	});
});
