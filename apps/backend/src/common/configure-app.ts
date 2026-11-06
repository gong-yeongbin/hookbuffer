import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BigIntInterceptor } from './http/bigint.interceptor';
import { HttpExceptionFilter } from './http/http-exception.filter';
import { useRawIngressBody } from './http/ingress-body';
import { createValidationPipe } from './http/validation';

// main.ts와 e2e가 같은 전역 설정으로 뜨도록 한곳에 둔다. 가드는 AuthModule이 APP_GUARD로 등록한다.
export function configureApp(app: NestFastifyApplication): void {
	app.useGlobalPipes(createValidationPipe());
	app.useGlobalFilters(new HttpExceptionFilter());
	app.useGlobalInterceptors(new BigIntInterceptor());
	useRawIngressBody(app);

	const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('hookbuffer').addBearerAuth().addSecurityRequirements('bearer').build());
	SwaggerModule.setup('docs', app, document);
}
