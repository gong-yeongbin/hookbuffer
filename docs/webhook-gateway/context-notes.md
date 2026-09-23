# context-notes

구현 중 내린 결정과 그 근거. 코드만 봐서는 "왜 이렇게 했는지" 알 수 없는 것만 적는다.

## 스택 선택 (2026-09-22)

`monorepo-practice`를 기반으로 하되 동일하게 가져가지 않는다. 재사용으로 인프라 세팅 시간을
아끼는 게 목적이고, 웹훅 게이트웨이에 안 맞는 것만 골라 바꿨다.

### 그대로 가져온 것

| 대상 | 이유 |
|---|---|
| pnpm + Turborepo 모노레포 | 검증된 구성. 바꿀 이유 없음 |
| NestJS 11 + Prisma + PostgreSQL | 위와 같음 |
| Valkey Stream 직접 구현 (BullMQ 아님) | BullMQ는 지연 큐·백오프·동시성 제한·DLQ를 전부 공짜로 준다. 그게 이 프로젝트 4·5·6단계 내용 전부다. 공짜로 받으면 설명할 게 "BullMQ가 해줍니다"만 남는다. 아웃박스+sweeper는 BullMQ가 주지도 않는다 |
| `packages/{typescript-config,eslint-config}` | 그대로 복사 |

`monorepo-practice`의 `packages/prisma`, `packages/eslint`는 `node_modules`/`dist`만 있는
죽은 디렉터리라 가져오지 않았다. `mysql2`(datasource는 postgresql), `@aws-sdk/client-ses`,
`@aws-sdk/client-s3`도 제외했다.

### 바꾼 것

| 항목 | 이전 | 현재 | 이유 |
|---|---|---|---|
| HTTP 어댑터 | Express | **Fastify** | 인그레스가 핫패스고 목표가 p99 50ms. NestJS는 어댑터 교체만으로 된다 |
| 테스트 러너 | jest + ts-jest | **Vitest + unplugin-swc** | 프론트가 이미 Vitest였다. 러너가 둘로 갈리는 걸 없앴다. ts-jest보다 빠르다 |
| 로깅 | NestJS 기본 Logger | **nestjs-pino** | 이 제품의 가치가 "무슨 일이 있었는지 볼 수 있다"인데 평문 로그는 CloudWatch Logs Insights에서 집계가 안 된다. Fastify를 고르면 Pino가 딸려온다 |
| 해시 | bcrypt | **bcryptjs** | 네이티브 빌드 제거 → Docker 이미지·빌드 경량화. 로그인 빈도에서 성능 차이는 무의미 |
| 검증 | class-validator 단독 | class-validator + **zod** | HTTP DTO는 class-validator 유지(Swagger 자동생성이 여기 묶여 있다). `source.signature_config`처럼 프리셋마다 모양이 다른 DB JSON 컬럼만 zod로 파싱한다 |
| 클라이언트 상태 | MobX | **제거** | 화면이 목록·필터·상세·재전송뿐이라 거의 전부 서버 상태다. react-query가 처리한다. 필요해지면 그때 zustand |
| 스타일 | styled-components | **제거** | antd 6에 CSS-in-JS가 내장돼 있다 |
| 경로 별칭 | 모듈별 13개 | **`@/*` 하나** | 모듈이 늘 때마다 tsconfig·테스트 설정을 고쳐야 하는 비용을 없앴다. 프론트가 이미 `@/*`를 쓰고 있어 모노레포 안에서 오히려 일관적이다 |
| Node | `>=18` | **24 고정** | `.nvmrc`+`engines`+Dockerfile+ECS. TS 6 + `@types/node` 26을 쓰면서 18은 앞뒤가 안 맞았다 |
| pnpm | 9.0.0 | **10.13.1** | 로컬에 깔린 버전. 패키지 매니저는 복사할 소스 코드 호환성과 무관해서 "안전하게 낮은 버전" 논리가 적용되지 않는다 |

### 버전을 최신으로 올리지 않은 것

NestJS 12, Vitest 5, ioredis 6이 모두 나와 있지만 각각 11.2.5 / 4.1.11 / 5.11.1로 간다.
복사해오는 코드가 그 버전 기준으로 작성돼 있어서다. 이 프로젝트에서 보여줄 것은 최신 메이저가
아니라 재시도·서킷·DLQ 설계이므로, 마이그레이션 비용을 1단계에 치를 이유가 없다.

다만 **`@nestjs/swagger`는 11.4.7로 고정해야 한다.** 12.0.1의 peer가 `^12.0.0` 단독이라
NestJS 11에서 설치되지 않는다. 생태계가 이미 12로 넘어간 상태이므로 올릴 때 같이 올린다.

`@nestjs/schedule`(12.0.2)과 `@nestjs/config`(12.0.0)는 11.x 라인 자체가 없다. peer가
`^11.0.0 || ^12.0.0`이라 NestJS 11에서 그대로 쓴다.

## 코드 아키텍처: 전체 헥사고날 (2026-09-23)

NestJS 안의 코드 조직은 **전 모듈에 헥사고날(port/adapter) 한 규칙**을 적용한다. 도메인 클래스와
매퍼는 만들지 않고 Prisma 생성 타입을 port 시그니처에 그대로 쓴다.

이 프로젝트가 보여줄 것은 재시도·서킷·DLQ 설계이고, 체크리스트 4·5단계 verify가 "유닛 — 백오프
계산, 상태 전이표, 상태 머신"이다. 그 유닛 테스트를 Postgres·Valkey 없이 돌리려면 service가
Prisma·ioredis를 몰라야 하는데, 헥사고날은 그것을 규칙으로 강제한다. 외부 의존이 Prisma, Valkey,
목적지 HTTP, 암호화 넷뿐이라 port 수가 유한해서 비용도 유한하다.

### 제외한 안

| 안 | 이유 |
|---|---|
| 레이어드 (NestJS 기본) | service가 Prisma·ioredis를 직접 주입받아 핵심 로직 유닛 테스트가 통합 테스트로 변한다 |
| 헥사고날 + DDD 전술 | Prisma 타입만으로 상태 전이를 순수 함수로 표현할 수 있어 도메인 클래스·매퍼 비용이 이득을 넘지 못한다 |
| 함수형 코어 + 명령형 셸 | 결과물은 비슷하지만 service가 여전히 Prisma를 import해 consumer·scheduler·sweeper 테스트에 mock이 필요하다 |
| 혼합 (핵심 2모듈만 port) | 모듈마다 규칙이 달라진다. 단일 규칙이 조건이었다 |

### 규칙

1. **service·consumer·scheduler·guard는 `ports/`의 인터페이스만 주입받는다.** `@prisma/client`
   (런타임), `ioredis`, `@/infra/**` import는 `adapters/`와 `infra/`에서만 허용한다. Prisma 생성
   타입은 `import type`으로 어디서든 쓴다.
2. **`domain/`은 순수 함수와 타입만.** `@nestjs/*`, `@prisma/client`(런타임), `ioredis`,
   `@/infra/**`를 import하지 않는다. 시각이 필요하면 `now: Date`를 인자로 받는다. Clock port는
   두지 않는다.
3. port 파일 하나에 인터페이스와 DI 토큰(`Symbol`)을 함께 둔다. port와 adapter는 그 모듈이
   소유한다. `infra/`에는 공유 런타임 클라이언트(PrismaService, ValkeyService, Stream 컨슈머
   베이스)만 둔다.

규칙은 `apps/backend/eslint.config.mjs`의 `@typescript-eslint/no-restricted-imports`로 강제한다.
문서로만 두면 샌다.

### 폴더 구조

```
apps/backend/src/
  main.ts                    APP_ROLE=api
  main.consumer.ts           APP_ROLE=consumer
  app.module.ts
  config/                    env 스키마(zod), 상수
  common/                    데코레이터(@Public/@Roles), 필터, 인터셉터. port 의존 없음
  infra/
    prisma/                  PrismaService
    valkey/                  ValkeyService(ioredis), Stream 컨슈머 베이스
  modules/
    <module>/
      <module>.controller.ts
      <module>.service.ts    (consumer·scheduler·sweeper도 같은 층)
      domain/                순수 함수. 예: backoff.ts, delivery-state.ts, circuit-state.ts, signature/*
      ports/                 인터페이스 + Symbol 토큰. 예: delivery.repository.ts, delivery.queue.ts
      adapters/              port 구현. 예: prisma-delivery.repository.ts, valkey-delivery.queue.ts
```

### 계층별 테스트

| 계층 | 방식 |
|---|---|
| `domain/` | 순수 유닛 (`*.spec.ts`, 의존 없음) |
| service·consumer·scheduler | port를 in-memory fake로 유닛 |
| `adapters/` | docker compose 위 통합 |
| controller | 얇은 유닛(응답 형식) + e2e (`test/*.e2e-spec.ts`). 유닛 커버리지 4지표 90% 게이트에 controller도 포함되므로 유닛을 생략할 수 없다 |

## Redis가 아니라 Valkey

프로덕션이 ElastiCache Valkey인데 로컬만 Redis면 어긋난다. 로컬 `valkey/valkey:9.1-alpine`,
프로덕션 ElastiCache Valkey 9.1로 **마이너까지 맞춘다.** 이 태그를 올리면 Terraform의
`engine_version`도 같이 올린다.

클라이언트는 **ioredis를 유지한다.** Valkey는 Redis 7.2와 API 호환 포크다(`INFO server`가
`redis_version:7.2.4`와 `valkey_version:9.1.2`를 함께 보고한다). `iovalkey`는 ioredis를
이름만 바꾼 0.x 포크라 이득이 없고, `@valkey/valkey-glide`는 API가 달라서 Stream 컨슈머를
새로 써야 한다 — 그게 이 프로젝트의 심장이라 1단계에 치를 비용이 아니다.

`XADD`·`XGROUP`·`XREADGROUP`·`ZRANGEBYSCORE`·`HSET` 동작은 로컬에서 확인했다.

## tsc는 경로 별칭을 산출물에 다시 쓰지 않는다

`nest build`의 기본 빌더는 tsc이고, **tsc는 `paths`를 타입 해석에만 쓴다.** 컴파일 결과에는
`require("@/infra/thing")`이 그대로 남아 `node dist/main`이 `Cannot find module`로 죽는다.
타입 체크는 통과하므로 CI에서 안 걸리고 런타임에만 터진다.

그래서 빌드를 `nest build && tsc-alias -p tsconfig.build.json`으로 둔다. tsc-alias가
산출물의 별칭을 상대 경로로 다시 쓴다. **별칭을 추가하면 빌드 산출물을 직접 실행해 확인한다** —
테스트는 Vitest의 `resolve.alias`로 통과하므로 이 문제를 잡아주지 못한다.

## TypeScript 6에서 baseUrl은 쓰지 않는다

TS 6이 `baseUrl`을 deprecate했고 TS 7에서 제거된다(`error TS5101`). `paths`는 `baseUrl`
없이도 tsconfig 위치 기준으로 동작하므로 `paths`만 쓴다.

## Vitest에 SWC가 필요한 이유

Vitest의 기본 변환기(esbuild)는 `emitDecoratorMetadata`를 지원하지 않는다. 그대로 두면
NestJS DI가 생성자 파라미터 타입을 읽지 못해 주입이 실패한다. `unplugin-swc`로
`legacyDecorator` + `decoratorMetadata`를 켜서 해결한다.

## pnpm 10은 lifecycle script를 기본 차단한다

`pnpm-workspace.yaml`의 `onlyBuiltDependencies`에 명시한 패키지만 postinstall이 돈다.
`@swc/core`가 빠지면 네이티브 바이너리가 없어 Vitest가 기동하지 않는다.

## 로컬 컨테이너 런타임은 Colima

Docker Desktop·OrbStack을 제거하고 Colima(Apache 2.0)를 쓴다. OrbStack은 개인 사용만
무료라 이 프로젝트의 2차 목적(사이드 수익)과 충돌할 여지가 있었다.

`docker-compose.yml`과 `pnpm docker:*` 스크립트는 런타임과 무관하게 동일하다.

```
colima start --cpu 4 --memory 6 --disk 60 --vm-type vz
```

`docker` CLI는 Homebrew의 독립 패키지(`brew install docker docker-compose`)이고, compose는
플러그인이라 `~/.docker/config.json`의 `cliPluginsExtraDirs`에 등록돼 있다.

## 유저·조직·결제 모델 (2026-09-23)

2단계 스키마에 앞서 user부터 설계하다가 plan.md의 인증·테넌트·과금 절이 함께 바뀌었다.
확정 컬럼은 plan.md 데이터 모델 표에 있고, 여기는 "왜"만 적는다.

### 구글 OAuth만, 비밀번호 없음

이메일·비밀번호 가입을 두지 않는다. `password_hash`, 비밀번호 재설정 플로, 이메일 인증이 통째로
빠진다. "스택 선택" 표의 bcryptjs는 그래서 user 인증에는 쓰이지 않는다(api_key 해시는 별개).

### user_identity를 지금 분리한 이유

GitHub 로그인 추가가 예정돼 있다. `user.google_sub` 한 컬럼이 더 단순하지만, provider가 늘 때
user 테이블을 마이그레이션해야 한다. 지금 분리하면 비용은 로그인 시 조인 하나다.

연결 규칙. 다른 provider로 로그인했는데 provider가 검증한 이메일이 기존 user와 같으면 그 user에
identity를 추가한다. 검증되지 않은 이메일은 연결하지 않는다(계정 탈취 경로).

### organization ↔ user는 M:N membership

구글 계정은 전역 식별자다. 1:N(user.organization_id, Slack식)으로 가면 이미 자기 조직이 있는
계정을 다른 팀이 초대할 때 "기존 조직을 떠나라"거나 거절해야 한다. membership이면 자기 조직을
유지한 채 팀에도 속한다. role은 membership에 둔다(같은 사람이 조직마다 다른 역할).

참고한 구조는 Vercel·Hookdeck·Svix의 "개인=팀 통일형"이다. 가입하면 본인 1명짜리 조직이 자동
생성되고 그 사람이 owner다. GitHub처럼 개인 계정과 org를 다른 종류의 소유자로 두는 안은 권한
검사가 두 갈래로 갈려 제외했다.

**개인 플랜은 별도 개념이 아니다.** 멤버가 owner 한 명뿐인 조직일 뿐이고, 플랜 차이는 행이 아니라
허용 여부(초대 403, 이벤트 상한)로 나타난다. 그래서 "개인 모드" 코드 분기가 없다.

### project(환경) 계층을 두지 않는 이유

Hookdeck·Svix는 organization 아래 project/environment를 둔다. dev·prod 분리와 제품별 로그 격리가
목적인데, 이건 고객 규모가 클 때 생기는 요구다. 여기서 넣으면 source·destination·api_key·
connection 전부에 스코프가 한 단계 늘고 관리 API의 모든 조회에 조건이 붙는다. 얻는 건 "묶어
보기"뿐이다. dev·prod는 소스를 나누거나 조직을 하나 더 만들면 된다. 필요해지면 nullable
`project_id` 추가 마이그레이션이지 재설계는 아니다.

### PK는 autoincrement, 로그 테이블만 BigInt

UUID v7은 `@db.Uuid`로 16바이트라 저장 크기는 문제가 아니지만, URL·`X-Hookbuffer-Event-Id`
헤더·로그에 36자로 찍히는 게 걸렸다. 개수 유추 우려는 이 제품에서 실질적 위험이 아니다.
event·delivery·delivery_attempt는 무한 증가라 Int(약 21억)로 두면 언젠가 옮겨야 한다.
`monorepo-practice`가 postback을 뒤늦게 BigInt로 옮긴 마이그레이션이 그 전례다.

### 결제를 MVP로 끌어온 결정

plan.md는 요금제·과금을 제외했었다. 팀 계정을 "가입 후 결제로 전환"하는 흐름으로 정하면서
플랜 개념이 어차피 필요해졌고, 그렇다면 결제 테이블도 지금 설계하는 게 낫다고 봤다.

**요금 구조 조사.** Hookdeck은 Developer $0(1명, 월 1만 이벤트, 보존 3일) / Team $39(무제한
멤버, 1만 포함, 보존 7일, 초과 10만 건당 $3부터) / Growth $499. Svix는 Free $0(5만 메시지, 보존
7일) / Basic $20 / Professional $490, 초과 건당 $0.0001. 둘 다 **월 정액 + 포함량 + 초과분
종량**이고 좌석 과금은 없다. 무료 플랜은 멤버 수·보존일·초과 불가로 제한한다. 같은 구조로 간다.

제외한 안. "정액 + 포함량 상한, 초과 시 429만"은 테이블이 둘로 끝나 가장 작지만 종량으로 가는
길이 막힌다. "정액만, 사용량 무제한"은 free 남용을 막을 수단이 없다.

플랜은 free / personal / team / team_plus 넷. 가격·포함량·멤버 수·보존일은 코드 상수다. 플랜이
넷뿐이라 plan 카탈로그 테이블은 과하다.

**team은 10명 상한, 그 위는 team_plus.** 처음엔 team 멤버 무제한이었다가 "큰 팀이 너무 싸게 쓴다"는
우려로 바꿨다. 좌석 종량(Vercel식 1명당 과금)도 검토했지만 payment에 좌석 컬럼, 월 중 추가·삭제
집계 규칙, 일할 계산이 따라온다. 플랜을 하나 더 두면 `plan` enum 값 하나만 늘고 청구 배치는
정액 + 이벤트 초과분 그대로다. Hookdeck Team → Growth, Svix Basic → Professional과 같은 자리다.
team_plus에 포함 이벤트 10만과 보존 90일을 얹은 건 멤버가 10명 이하여도 이벤트가 많은 팀이
올라올 이유를 만들기 위해서다. 보존 90일은 본문을 Postgres에 두는 MVP에서 저장량 부담이 가장
큰 값이라, 부담되면 30일로 낮춘다.

**정액은 Hookdeck을 원화로 옮겼다.** team 49,000원은 Team $39를 환율 반올림한 값이다.

**초과 단가 0.25원/건은 자체 결정이다.** 처음엔 Hookdeck의 $3/10만 건을 옮긴 0.04원이었다.
바꾼 이유는 둘이다. 첫째, 0.04원이면 team 49,000원 + 초과분이 team_plus 149,000원에 닿는 지점이
월 250만 건이라 team_plus가 이벤트 때문에 팔릴 일이 없었다. 0.25원이면 그 지점이 약 41만 건으로
내려와 이벤트가 많은 팀에게 상향 이유가 생긴다. 둘째, "4건에 1원"이라 설명이 단순하다. Hookdeck의
6배, Svix(약 0.14원)의 1.8배지만 국내 특화 제품이 단가로 경쟁할 이유는 없다. 검토했다 버린 값은
1원/건(5만 건만 넘어도 초과분이 정액을 넘는다)이다.

계량은 건 단위다. Hookdeck·Svix도 그렇게 한다. 10만 건 단위 올림은 1건 초과에 25,000원을 물려
설명이 안 되고, 내림은 9만 9,999건까지 무료가 돼 종량의 의미가 없다. 원 단위는 내림한다. 토스 승인 금액이 정수여야 하고, 사용량 스냅샷에서
세운 "청구는 고객에게 유리한 쪽으로 틀린다"는 원칙과 같다.
유료 플랜 포함량은 Hookdeck처럼 월 1만(team_plus만 10만)이고, 차이는 포함량이 아니라 멤버 수·
보존·초과 허용 여부다. **free만 1,000건**이다. Hookdeck 1만·Svix 5만보다 훨씬 적지만, free는
연동 테스트용으로 좁히고 실서비스는 첫 달 안에 personal로 올리는 게 의도다. 하루 33건이면 연동
확인에는 충분하고, free 이벤트의 원가가 거의 없어도 전환을 미루는 쪽이 손해다. personal은 Hookdeck에 없는 플랜이라 기준이 없었고, Svix
Basic $20과 비슷한 19,000원으로 뒀다(혼자 쓰는 개발자가 free 상한을 넘길 때 올라가는 첫 단계).

### free 초과는 429, 저장하지 않는다

대안으로 "200을 주고 저장하되 delivery를 `held`로 두고 결제하면 전달"을 검토했다. 발신자가 실패를
기록하지 않고, 보관 중인 이벤트가 결제 동기가 되는 장점이 있었다. 그래도 429를 택한 건 free를
체험용으로 좁혔기 때문이다. 보류 방식은 delivery 상태가 하나 늘고, 인그레스에 플랜별 분기가 생기고,
3일 뒤 삭제되는 `held`가 결국 유실이라 약속이 반만 지켜진다. 체험 단계에서 상한에 닿으면 "결제
하라"는 신호가 명확한 편이 낫다. 중복 요청까지 카운트하는 건 INSERT 뒤에 세면 1,001번째가 검사 전에
저장되기 때문이고, 오차는 발신자 재전송 몇 건 수준이다.

### organization.plan과 subscription.plan이 둘 다 있는 이유

인그레스·가드는 요청마다 플랜을 본다. 핫패스가 subscription을 조인하지 않도록 조직 컬럼
하나로 둔다. subscription은 결제 상태(빌링키·주기·past_due)이고 free 조직은 행이 없다. 결제
실패로 canceled가 되면 배치가 plan을 free로 내린다. 두 값이 어긋나는 구간은 배치 실행 사이뿐이다.

### 다운그레이드 때 멤버를 지우지 않는다

team에서 free로 내려가면 멤버 상한(1명)을 넘는 멤버가 생긴다. 이들을 어떻게 할지 세 안이 있었다.
자동 삭제(Vercel은 Pro→Hobby 시 원래 owner 외 전원을 제거한다), 자발적 다운그레이드를 멤버 정리
전까지 409로 거부, 행을 남기고 접근만 막기(Figma는 상한 초과 팀을 잠그고, GitHub은 Free로 내려도
멤버를 유지한 채 기능만 잃는다).

**행을 남기고 접근만 막는다.** 결제 3회 실패로 새벽 배치가 canceled 처리할 때는 물어볼 사람이
없어 어차피 이 방식이어야 하고, 자발적 다운그레이드도 같은 규칙으로 처리하면 코드 경로가 하나다.
삭제는 되돌릴 수 없고, membership에 status 컬럼을 두는 안은 상태가 하나 더 생긴다. "플랜 차이는
행이 아니라 허용 여부"라는 원칙이 초대 403·이벤트 429에 이어 여기에도 그대로 적용된다.

### 사용량은 Valkey에서 센다

인그레스 p99 50ms 목표라 DB 카운트를 넣지 않는다. `org:{id}:usage:{yyyymm}` INCR 하나다.
배치가 매시간 `usage_period`에 스냅샷하고, 월이 바뀌면 finalize한다. Valkey가 날아가면 마지막
스냅샷 이후 최대 1시간 치가 사라지는데, 청구는 고객에게 유리한 쪽으로 틀리는 것이라 허용한다.

토스페이먼츠는 스케줄링을 제공하지 않는다(문서에 명시). 월 청구 배치, past_due 재시도(일 1회,
3회 실패 시 canceled)는 직접 만든다. 빌링키 유효기간은 카드 유효기간과 같다. `payment.order_id`는
토스 규칙(영문·숫자·`-`·`_` 6~64자)에 맞춰 서버가 만든다.

## API 형식 (2026-09-23)

규칙 자체는 `apps/backend/CLAUDE.md` "엔드포인트" 절에 있다. 여기는 각 결정의 이유다.

- **`/orgs/:orgId` 접두사.** membership이 M:N이라 주체만으로 조직이 정해지지 않는다. 헤더
  `X-Organization-Id`는 Swagger·curl·링크 공유에 불리하고, JWT에 활성 조직을 넣는 안은 조직을
  바꿀 때마다 토큰을 재발급해야 하며 api_key와 규칙이 갈린다.
- **커서 페이징 통일.** event·delivery가 BigInt autoincrement라 id가 시간순이고, 대량 로그에서
  offset은 뒤로 갈수록 느리다. 소스·목적지처럼 적은 목록까지 통일한 건 형식을 하나로 두기 위해서다.
- **응답 래퍼 없음.** `monorepo-practice`의 `{ statusCode, data, _meta }`는 프론트가 매번 한 겹
  벗겨야 했고, `_meta`가 요청 본문·쿼리를 그대로 되돌려 비밀이 응답에 섞일 수 있는 경로였다.
  Stripe·GitHub처럼 단건은 객체, 목록만 `{ data, next_cursor }`.
- **오류 `{ code, message }`.** Nest 기본 `{ statusCode, message, error }`에는 기계가 분기할 code가
  없다. 커스텀 예외 클래스 대신 내장 예외에 객체를 넘기는 건 클래스 수를 늘리지 않기 위해서다.
- **타 조직 리소스는 404.** 존재 여부를 노출하지 않는다. `monorepo-practice`에서는 프론트가 403을
  세션 만료로 취급해 로그아웃시키는 문제도 있었다. 403은 소속은 맞지만 role·플랜이 부족할 때만.
- **api_key는 member 권한.** 키가 유출돼도 피해를 소스·목적지·이벤트로 한정한다. 자동화가 멤버·
  결제·API 키를 만질 이유가 없다. api_key에 role 컬럼을 두는 안은 테이블 설계를 다시 여는
  비용이라 제외했다.
- **snake_case.** Prisma 행을 그대로 반환하기로 했으므로 응답은 이미 snake_case다. 요청만
  camelCase로 두면 DTO마다 매핑이 생긴다. Stripe·GitHub API도 snake_case다.
- **BigInt는 문자열.** JSON은 2^53 이상을 표현하지 못하고 `JSON.stringify`가 bigint에서 던진다.
  전역 직렬화기 하나로 처리하고 커서도 문자열로 맞춘다.
- **플랜 게이트는 service에서.** 초대 가능 여부·owner 전용 접근·이벤트 상한은 조직 상태를 읽어야
  해서 가드에 두면 가드가 port를 여럿 주입받는다. 라우트 수준 규칙(role)만 가드, 상태 규칙은 service.
