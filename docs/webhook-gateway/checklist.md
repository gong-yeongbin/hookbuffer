# checklist

각 단계는 하나의 논리적 커밋 단위. 커밋은 요청 시에만 한다.
`verify`를 실제로 실행해 통과한 것만 체크한다.

---

## 1. 문서 3종 + 스캐폴딩 — 완료 (2026-09-22)

- [x] `docs/webhook-gateway/{plan,checklist,context-notes}.md`
- [x] 루트 스캐폴딩 (`package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`)
- [x] `docker-compose.yml` — postgres:17 + valkey/valkey:9.1-alpine
- [x] `packages/{typescript-config,eslint-config}` 복사
- [x] backend 최소 앱 — NestJS 11 + Fastify + nestjs-pino + `GET /health`
- [x] frontend 최소 앱 — React 19 + Vite
- [x] `apps/backend/Dockerfile`

verify

- [x] `pnpm install` 성공
- [x] `pnpm check-types` 통과
- [x] `pnpm build` 통과
- [x] `pnpm lint` 통과 (경고 0)
- [x] `pnpm test` 통과
- [x] `pnpm test:e2e` — `GET /health` → 200 `{"status":"ok"}`
- [x] 빌드 산출물 직접 실행(`node dist/main`) → `/health` 200. 별칭이 상대 경로로 재작성됨
- [x] `pnpm docker:up` → postgres·valkey 모두 healthy
- [x] Valkey에서 `XADD`/`XGROUP`/`XREADGROUP`/`ZRANGEBYSCORE`/`HSET` 동작 확인

- [x] `docker build -f apps/backend/Dockerfile .` → 427MB, linux/arm64
- [x] 이미지로 컨테이너 기동 → `/health` 200, 구조화 JSON 로그, SIGTERM 종료 0.12초

---

## 1.5 코드 아키텍처 결정 — 완료 (2026-09-23)

- [x] `context-notes.md`에 "코드 아키텍처: 전체 헥사고날" 섹션
- [x] `apps/backend/eslint.config.mjs`에 import 경계 규칙
- [x] 양쪽 앱 vitest에 coverage thresholds 4지표 90%, `pnpm test`가 커버리지 포함 실행

verify

- [x] `pnpm lint` 통과 (경고 0)
- [x] `modules/` 안에서 `@prisma/client` 런타임 import, `@/infra/*` import가 경고로 잡힘

---

## 2. 스키마·마이그레이션·시드

- [ ] Prisma 도입 (`prisma` 7.10.0, `@prisma/client`, `@prisma/adapter-pg`)
- [ ] `plan.md`의 데이터 모델을 `schema.prisma`로 작성
- [ ] `infra/prisma/*` 복사 (`monorepo-practice`)
- [ ] 시드 — organization(free 1개, team 1개), user + user_identity(google), organization_member(owner),
      subscription(team 조직), source(프리셋 3종), destination, connection
- [ ] 루트 `dev` 스크립트에 `db:deploy`/`db:generate`/`db:seed` 추가
- [ ] Dockerfile에 `prisma generate` + deploy 트리 재생성 단계 추가

verify

- [ ] `pnpm db:deploy && pnpm db:seed` 성공
- [ ] e2e 부팅 테스트 통과

---

## 3. 인그레스

- [ ] `POST /in/:sourceSlug` — `@Public()` + Throttler
- [ ] 서명 검증 프리셋 — `tosspayments`, `portone`, `github`, `generic`, `none`
- [ ] 멱등 키 — 이벤트 ID 헤더 우선, 없으면 본문 SHA-256
- [ ] event/delivery INSERT (트랜잭션) → XADD
- [ ] 본문 256KB 상한

verify

- [ ] 유닛 — 프리셋별 서명 성공·실패·타임스탬프 만료, 멱등 키 규칙
- [ ] e2e — 같은 본문 2회 → event 1건·delivery N건
- [ ] e2e — 잘못된 서명 401, 256KB 초과 413

---

## 4. 전달 워커

- [ ] `main.consumer.ts` + `APP_ROLE=consumer`, `start:consumer` 스크립트
- [ ] Stream 컨슈머 그룹 등록 (`infra/stream/*` 복사, **최대 전달 초과 → dead로 교체**)
- [ ] HTTP 포트 확장 — GET 전용 → POST·헤더·본문·응답 본문 반환
- [ ] attempt 기록, 상태 전이
- [ ] ZSET 지연 큐 + 5초 스케줄러
- [ ] 60초 sweeper (아웃박스 누락 재적재)

verify

- [ ] 유닛 — 백오프 계산, 상태 전이표
- [ ] 통합 — mock 목적지 성공 / 500 반복 → dead / 2회 실패 후 복구 → succeeded
- [ ] 통합 — XADD 누락 → sweeper 재적재

---

## 5. 목적지 보호

- [ ] Valkey 세마포어 동시성 제한
- [ ] 서킷 브레이커 (5회 → open 60s → half-open 프로브)

verify

- [ ] 유닛 — 상태 머신
- [ ] 통합 — 동시 20건에 concurrency 2 → 최대 2 inflight
- [ ] 통합 — 연속 5회 실패 → open → 60초 후 프로브

---

## 6. DLQ·리플레이·보존

- [ ] 단건 재시도, 일괄 재전송, 다른 목적지로 리플레이 API
- [ ] 일 배치 삭제 크론 (1,000건씩)

verify

- [ ] e2e — dead 10건 일괄 재시도 → pending
- [ ] e2e — 리플레이로 새 delivery 생성
- [ ] e2e — personal(보존 7일) 조직의 8일 전 이벤트 삭제, 7일 전 유지

---

## 7. 관리 API·인증

- [ ] 구글 OAuth 로그인 → 첫 로그인 시 user + user_identity + 개인 organization(free) + member(owner) 생성 → JWT 발급
- [ ] organization/member/api_key/source/destination/connection CRUD
- [ ] JWT 가드 + api_key 가드 (deny-by-default), `@Public`/`@Roles`
- [ ] 이벤트·delivery 조회 (필터·페이징)
- [ ] Swagger (`@nestjs/swagger` **11.4.7 고정**)
- [ ] 서명 시크릿 AES-256-GCM 암호화 + 로그 마스킹

verify

- [ ] e2e — 첫 로그인 시 organization·user_identity·member(owner) 생성
- [ ] e2e — 가드 deny-by-default
- [ ] e2e — 타 조직 리소스 404
- [ ] e2e — api_key 폐기 후 401
- [ ] e2e — plan=free 조직의 초대 403
- [ ] e2e — 목록 커서로 두 페이지 순회 후 next_cursor null

---

## 8. 결제·사용량

- [ ] 빌링키 발급·교체·삭제 API (토스 `authKey` → 빌링키, 암호화 저장)
- [ ] 플랜 변경 (free → personal/team, subscription 생성)
- [ ] 인그레스 usage INCR + free 포함량 초과 429
- [ ] usage_period 스냅샷 배치 (1시간)
- [ ] 월 청구 배치 — finalize → payment 생성(정액 + 초과분) → 승인 → past_due 재시도 → 3회 실패 시 canceled + plan=free
- [ ] 플랜별 보존 배치 (retention 크론이 organization.plan을 본다)

verify

- [ ] 유닛 — 청구 금액 계산(정액 + 초과), subscription 상태 전이(active → past_due → canceled)
- [ ] 통합 — 토스 테스트 상점 승인 성공·실패
- [ ] e2e — free 조직 월 1만 초과 → 429

---

## 9. 대시보드

- [ ] 로그인, 소스·목적지·연결 관리
- [ ] 이벤트 목록·상세·재전송, 목적지 상태, API 키, 플랜·결제

verify

- [ ] `pnpm test` 통과 (4지표 90% thresholds 포함)
- [ ] 수동 — 웹훅 수신 → 목록 표시 → 상세 → 재전송 → 상태 변경

---

## 10. 부하·문서

- [ ] k6 인그레스 부하 스크립트
- [ ] README — 아키텍처·설계 결정·수치·프리셋 연동 방법

verify

- [ ] 로컬 초당 500건 5분 인그레스, p99 < 100ms
- [ ] 유실 0건 (전송 수 = event 수)

---

## 11. AWS 배포

- [ ] Terraform 복사·수정 — NLB 제거, worker ECS 서비스 추가, 이름·도메인 변수화
- [ ] ElastiCache Valkey **9.1** (로컬 태그와 일치)
- [ ] `ci.yml` 신규 (lint·check-types·test)
- [ ] `deploy-backend.yml`, `deploy-frontend.yml` 변수화
- [ ] bootstrap → apply

verify

- [ ] 실제 도메인으로 GitHub 웹훅 등록 → 이벤트 수신 → 로컬 목적지(터널)로 전달 확인
- [ ] worker 중단 후 재기동 시 밀린 delivery 소화 확인

---

## 단계와 무관하게 먼저 시작할 것

- [ ] 토스페이먼츠·포트원 테스트 계정 발급 (3단계 전에 필요)
- [ ] 토스페이먼츠 빌링 테스트 상점 발급 (8단계 전에 필요)
- [ ] 구글 OAuth 클라이언트 ID 발급 (7단계 전에 필요)
- [ ] AWS 월 비용 방침 결정 — 상시 유지 vs 필요 시 기동 (11단계 전에 필요)
