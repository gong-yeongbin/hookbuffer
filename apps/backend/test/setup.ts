// NestJS 데코레이터 메타데이터는 reflect-metadata의 전역 폴리필을 전제한다.
// 프로덕션은 main.ts가 @nestjs/core를 통해 로드하지만 테스트는 진입점이 달라 여기서 건다.
import 'reflect-metadata';

// 테스트 출력에 애플리케이션 로그가 섞이지 않게 한다.
process.env.LOG_LEVEL ??= 'silent';

// 로컬 docker compose와 같은 값. CI나 다른 DB를 쓰면 환경 변수로 덮어쓴다.
process.env.DATABASE_URL ??= 'postgresql://postgres:1234@localhost:5432/munjigi';
// 끝의 /1은 DB 번호. 개발 서버가 쓰는 0번과 섞이지 않게 한다(사용량 카운터, 전달 큐)
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
process.env.APP_URL ??= 'http://localhost:5173';
process.env.MAIL_FROM ??= 'no-reply@munjigi.local';
// 테스트의 가짜 목적지 서버가 127.0.0.1에 뜬다. 내부망 차단은 그것을 따로 보는 테스트에서 끈 값으로 확인한다
process.env.ALLOW_PRIVATE_DESTINATIONS ??= 'true';
// 테스트 전용 고정 키(32바이트). 운영 키와 무관하다.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
