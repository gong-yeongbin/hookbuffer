import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

const PORT_DEFAULT = 3001;

async function bootstrap() {
	// bufferLogs로 부팅 로그를 잡아뒀다가 Pino가 준비된 뒤 한꺼번에 내보낸다.
	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
	app.useLogger(app.get(Logger));

	// SIGTERM에서 스트림 연결 종료 등 OnApplicationShutdown이 실행되도록 한다.
	app.enableShutdownHooks();

	const port = app.get(ConfigService).get<number>('PORT') ?? PORT_DEFAULT;

	// 컨테이너 밖에서 접근하려면 루프백이 아닌 0.0.0.0에 바인딩해야 한다.
	await app.listen({ port, host: '0.0.0.0' });
}
void bootstrap();
