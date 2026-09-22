import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '@/app.module';

describe('GET /health', () => {
	let app: NestFastifyApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

		app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
		await app.init();
		// Fastify는 라우트 등록이 비동기라 ready()를 기다리지 않으면 404가 난다.
		await app.getHttpAdapter().getInstance().ready();
	});

	afterAll(async () => {
		await app.close();
	});

	it('200과 status: ok를 응답한다', async () => {
		const response = await request(app.getHttpServer()).get('/health');

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: 'ok' });
	});
});
