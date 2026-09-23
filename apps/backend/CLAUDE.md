# apps/backend

API·워커 서버. NestJS 11 + Fastify + Prisma/PostgreSQL + Valkey(ioredis). 같은 앱을
`APP_ROLE=api|consumer`로 나눠 띄운다. 루트 `CLAUDE.md`와 `docs/webhook-gateway/`가 전제다.

## 아키텍처

전체 헥사고날, 전 모듈 동일. 근거와 폴더 구조·계층별 테스트 방식은 `context-notes.md`
"코드 아키텍처" 절.

- service·consumer·scheduler·guard는 `ports/` 인터페이스만 주입받는다.
- `@prisma/client` 런타임 import, `ioredis`, `@/infra/**`는 `adapters/`와 `infra/`에서만. 타입은 `import type`.
- `domain/`은 순수 함수만. `@nestjs/*`도 import하지 않는다. 시각은 `now: Date` 인자.
- 도메인 클래스·매퍼를 만들지 않는다. Prisma 생성 타입을 그대로 쓴다.

`eslint.config.mjs`가 이 경계를 경고로 잡는다. 경고가 나면 코드를 옮기지, 규칙을 완화하지 않는다.

## 하지 않는 것

- BullMQ·Temporal 등 큐/워크플로 라이브러리. 재시도·백오프·서킷·DLQ를 직접 구현하는 게 목적이다.
- Express 전용 API. 어댑터는 Fastify다.
- `console.log`. nestjs-pino `Logger`를 주입받는다.
- 서명 시크릿·API 키·인증 헤더를 로그에 남기는 것.
- `@/*` 외의 경로 별칭.

## 제품 규칙 중 코드에서 어기기 쉬운 것

- 인그레스(`POST /in/:slug`)는 검증·저장·XADD만 한다. 외부 HTTP 호출을 넣지 않는다.
- 워커는 at-least-once, 순서 미보장. 최대 시도 초과는 버리지 않고 `dead`로 남긴다.
- HTTP DTO는 class-validator, DB JSON 컬럼은 zod. 비밀번호는 bcryptjs, 서명 시크릿은 AES-256-GCM.

## 함정

- e2e에서 `await app.getHttpAdapter().getInstance().ready()`를 호출해야 Fastify 라우트가 뜬다.
  안 하면 404. `test/health.e2e-spec.ts`를 따른다.
- tsc는 `paths`를 산출물에 반영하지 않는다. import 구조를 바꿨으면 `pnpm build` 후
  `node dist/main`을 직접 실행해 `/health`가 뜨는지 본다. 테스트는 통과해도 런타임에서 죽는다.
- Vitest의 `unplugin-swc`를 esbuild로 바꾸면 데코레이터 메타데이터가 사라져 DI가 깨진다.
