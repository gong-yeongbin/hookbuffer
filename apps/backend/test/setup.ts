// NestJS 데코레이터 메타데이터는 reflect-metadata의 전역 폴리필을 전제한다.
// 프로덕션은 main.ts가 @nestjs/core를 통해 로드하지만 테스트는 진입점이 달라 여기서 건다.
import 'reflect-metadata';

// 테스트 출력에 애플리케이션 로그가 섞이지 않게 한다.
process.env.LOG_LEVEL ??= 'silent';
