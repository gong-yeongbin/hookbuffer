# hookbuffer — 웹훅 수신 게이트웨이

외부 서비스(결제·커머스·메신저·GitHub 등)가 보내는 웹훅을 대신 받아 저장하고, 수신 서버가
준비될 때까지 재시도하며 전달하고, 전부 로그로 남겨 다시 보낼 수 있게 하는 수신 게이트웨이.

웹훅은 발신자가 수신자 사정을 봐주지 않는다. 배포·장애 중에 온 이벤트는 사라지고, 응답이
느리면 실패로 찍히고, 몰리면 서버가 죽고, 무슨 일이 있었는지 볼 수 없고, 다시 처리할 수 없다.

**포지셔닝.** 범용으로는 Hookdeck·Svix·Convoy와 가격 경쟁이 불가능하다. 국내 특화(토스페이먼츠·
포트원 등 국내 웹훅 서명 프리셋, 한국어 문서)로 좁힌다. 1차 목적은 포트폴리오, 2차가 사이드 수익.

## 범위

### MVP에 포함

- **인그레스.** 소스별 고유 URL `POST /in/:sourceSlug`. 서명 검증 → 멱등 키 계산 → 원본 저장
  → 연결된 목적지마다 delivery 생성 → 큐 적재 → 즉시 200.
- **서명 검증 프리셋.** `tosspayments`, `portone`, `github` + `generic`(HMAC-SHA256 헤더
  이름·알고리즘·타임스탬프 허용 오차 설정형) + `none`.
- **멱등.** 제공자 이벤트 ID 헤더 우선, 없으면 본문 SHA-256. `(source_id, idempotency_key)`
  유니크. 중복은 200으로 응답하되 새 delivery를 만들지 않는다.
- **라우팅.** 소스 1 → 목적지 N. 필터는 MVP 제외(연결만).
- **전달 워커.** Valkey Stream 컨슈머 그룹. 목적지로 HTTP POST(원본 헤더 일부 + 본문 그대로 +
  `X-Hookbuffer-*` 메타 헤더). 타임아웃, 지수 백오프 + 지터, 최대 시도, 시도마다 기록.
- **목적지 보호.** 목적지별 동시성 제한(Valkey 세마포어)과 서킷 브레이커.
- **DLQ·리플레이.** 최대 시도 초과 → `dead`. 단건 재시도, 기간·소스·상태 필터 일괄 재전송,
  다른 목적지로 리플레이.
- **이벤트 로그 UI.** 이벤트 목록(소스·상태·기간 필터), 상세(헤더·본문·delivery·attempt
  타임라인·재전송 버튼), 목적지 상태(서킷 상태·최근 실패율).
- **멀티테넌시·인증.** 구글 OAuth 로그인 → 서버 발급 JWT. organization ↔ user는
  membership(M:N)이고 role(owner/admin/member)은 membership에 둔다. 가입 시 개인 조직(free)을
  자동 생성한다. api_key는 관리 API용. 보존은 플랜별(코드 상수), 일 배치 삭제.
- **결제·사용량.** 토스페이먼츠 빌링키 자동결제. 플랜 free / personal / team. 월 정액 + 포함
  이벤트량 + 초과분 종량(Hookdeck식). free는 포함량 초과 시 429. 월 배치가 청구한다.
- **관측.** 헬스 엔드포인트, 큐 적체·dead 증가 로그 경고.
- **AWS 배포.** api·worker 두 ECS 서비스(같은 이미지, 다른 커맨드), RDS, ElastiCache Valkey,
  S3+CloudFront, GitHub Actions OIDC.

### 제외 (2단계 이후)

CLI 로컬 터널, 변환 스크립트·필터, 키 기반 순서 보장, 본문 S3 오프로드(MVP는 Postgres Text +
256KB 상한), 알림 채널(Slack·이메일), 발신(outbound) 웹훅, 초대(invitation) 테이블, 구글 외
OAuth provider, project(환경) 계층, 환불·쿠폰·세금계산서, 연간 결제.

## 아키텍처

```
발신자 ──POST /in/:slug──▶ [api] 서명검증 → 플랜 상한 확인·usage INCR → event INSERT(멱등) → delivery INSERT×N → XADD delivery
                                                                                    │
[worker]  XREADGROUP delivery ──▶ 목적지 상태·세마포어 확인 ──▶ HTTP POST ──▶ attempt 기록
              ▲                        │ 성공 → succeeded
              │                        │ 실패 → attempt+1, next_attempt_at 계산 → ZADD delivery:scheduled
   [scheduler 5s] ZRANGEBYSCORE due ──┘ 최대 시도 초과 → dead
   [sweeper 60s]  pending인데 큐에 없는 delivery(아웃박스 누락) 재적재
   [retention 1d] 플랜 보존일이 지난 이벤트·delivery·attempt 배치 삭제
   [usage 1h]     Valkey usage 카운터 → usage_period 스냅샷
   [billing 1d]   월이 바뀐 usage_period finalize → payment 생성 → 빌링키 승인, 실패 재시도
```

인그레스 경로는 Postgres INSERT와 Valkey(INCR·XADD) 외에 아무것도 의존하지 않는다. XADD가
실패해도 delivery는 `pending`으로 남아 sweeper가 60초 안에 재적재한다(아웃박스 패턴).

`APP_ROLE=api|consumer`로 같은 NestJS 앱을 API와 워커로 나눠 띄운다.

**Valkey 키.** 스트림 `delivery`, 지연 큐 `delivery:scheduled`(ZSET, score=next_attempt_at),
세마포어 `dest:{id}:inflight`, 서킷 `dest:{id}:circuit`(state·failures·opened_at),
사용량 `org:{id}:usage:{yyyymm}`.

## 데이터 모델 (Prisma, PostgreSQL)

PK는 autoincrement. 설정 테이블은 Int, 무한 증가하는 로그 테이블(event·delivery·delivery_attempt)은
BigInt. 모든 테이블에 created_at, 갱신되는 테이블에 updated_at.

| 모델 | 핵심 컬럼 | 비고 |
|---|---|---|
| organization | id, name, plan(enum free/personal/team) | 테넌트. plan은 인그레스·가드가 보는 현재 적용 플랜 |
| user | id, email(unique), name, avatar_url | 구글 신원. 비밀번호 없음 |
| user_identity | id, user_id, provider(enum google), provider_user_id | unique(provider, provider_user_id). 같은 이메일의 다른 provider는 기존 user에 추가 |
| organization_member | organization_id, user_id, role(enum owner/admin/member) | pk(organization_id, user_id), index(user_id). 조직당 owner 1명 |
| subscription | id, organization_id(unique), plan(enum personal/team), status(enum active/past_due/canceled), customer_key(unique), billing_key_enc, card_issuer_code, card_number_masked, current_period_start, current_period_end, canceled_at | 토스 빌링. free 조직은 행 없음. 빌링키는 암호화 |
| usage_period | id, organization_id, period_start(date), event_count, finalized_at | unique(organization_id, period_start). Valkey 카운터 스냅샷 |
| payment | id, subscription_id, usage_period_id, order_id(unique), payment_key, base_amount, overage_events, overage_amount, amount, status(enum pending/paid/failed), failure_code, failure_message, paid_at | index(subscription_id, created_at). order_id는 서버 생성(영문·숫자·-_ 6~64자) |
| api_key | id, organization_id, prefix, key_hash, name, revoked_at | 관리 API. 해시만 저장 |
| source | id, organization_id, slug(unique), name, provider(enum), signing_secret_enc, signature_config(json) | slug가 인그레스 URL |
| destination | id, organization_id, name, url, headers(json), timeout_ms, max_attempts, concurrency, circuit_state(enum) | |
| connection | source_id, destination_id | M:N |
| event | id(BigInt), source_id, idempotency_key, headers(json), body(text), content_type, size, received_at | unique(source_id, idempotency_key), index(source_id, received_at) |
| delivery | id, event_id, destination_id, status(pending/succeeded/failed/dead), attempt, next_attempt_at, last_status_code, last_error | index(status, next_attempt_at), index(destination_id, status) |
| delivery_attempt | id, delivery_id, attempt_no, status_code, error, duration_ms, response_body(text, 4KB 절단), attempted_at | |

## 핵심 설계 결정

1. **저장 우선.** 인그레스는 검증·저장·적재만 하고 어떤 외부 호출도 하지 않는다. p99 50ms 이하 목표.
2. **멱등 키.** 프리셋별 이벤트 ID 헤더(GitHub `X-GitHub-Delivery` 등) → 없으면 본문 해시.
   헤더는 제외한다(재전송 시 헤더가 달라진다).
3. **백오프.** `min(10s × 2^attempt, 1h) ± 20% 지터`, 기본 최대 10회(약 3일). 목적지마다 재정의 가능.
4. **순서.** 보장하지 않는다. 문서에 명시한다.
5. **서킷 브레이커.** 연속 실패 5회 → open 60초 → half-open 1건 프로브 → 성공 시 close.
   open 중 delivery는 스케줄 큐로 미룬다(실패로 카운트하지 않음).
6. **본문 저장.** Postgres Text, 256KB 초과는 413. S3 오프로드는 2단계.
7. **보존.** 플랜별 코드 상수(초안 free 3일 / personal 7일 / team 30일). `received_at` 인덱스
   기반 배치(1,000건씩) 크론. 처음부터 배치로 설계.
8. **비밀 보관.** 서명 시크릿과 빌링키는 서버 키(env)로 AES-256-GCM 암호화 저장. 로그 마스킹.
9. **at-least-once.** 워커 처리는 최소 1회. 목적지 측 멱등은 `X-Hookbuffer-Event-Id` 헤더로 지원.
10. **테넌트 계층.** organization 하나가 유일한 스코프. project(환경) 계층은 두지 않는다. dev·prod는
    소스를 나누거나 조직을 하나 더 만든다.
11. **과금.** `organization.plan`이 적용 플랜이고 `subscription`은 결제 상태다. 플랜별 값은 코드
    상수이고 Hookdeck 기준이다.

    | | free | personal | team |
    |---|---|---|---|
    | 월 정액 | 0원 | 19,000원 | 49,000원 |
    | 월 포함 이벤트 | 1만 | 1만 | 1만 |
    | 초과 | 429 거부 | 10만 건당 4,000원 | 10만 건당 4,000원 |
    | 멤버 | 1명 | 1명 | 무제한 |
    | 보존 | 3일 | 7일 | 30일 |

    사용량은 인그레스가 Valkey INCR로 세고 배치가 `usage_period`에 스냅샷한다. 월 전환 시
    finalize → payment(정액 + 초과분) → 빌링키 승인. 실패는 `past_due`로 두고 일 1회 재시도, 3회
    실패 시 `canceled`와 plan=free. 토스는 스케줄링을 제공하지 않으므로 이 배치는 직접 만든다.

스택 선택과 그 근거는 [context-notes.md](./context-notes.md)에 있다.

## 단계별 계획

진행 상황과 검증 항목은 [checklist.md](./checklist.md)에 있다.

1. **문서 3종 + 스캐폴딩**
2. **스키마·마이그레이션·시드**
3. **인그레스**
4. **전달 워커**
5. **목적지 보호** (세마포어, 서킷 브레이커)
6. **DLQ·리플레이·보존**
7. **관리 API·인증**
8. **결제·사용량**
9. **대시보드**
10. **부하·문서**
11. **AWS 배포**

## 검증 (전체)

- backend: `pnpm test`(유닛), `pnpm test:e2e`. 통합 시나리오는 docker compose 위에서 실행.
- frontend: `pnpm test` (커버리지 포함, 4지표 90% 미만이면 실패).
- 루트: `pnpm lint && pnpm check-types && pnpm build`.
- 배포 후: 실 웹훅 수신 1건 end-to-end, 워커 중단·복구 시 유실 0건.

## 리스크

- **서명 프리셋의 정확성.** 토스페이먼츠·포트원 문서 기준으로 구현하되, 실제 테스트 계정으로
  검증하지 않으면 "국내 특화"라는 차별점 자체가 검증되지 않은 채 남는다. 테스트 계정 발급을
  3단계 전에 시작한다.
- **Stream 컨슈머의 최대 전달 초과 처리.** `monorepo-practice`는 XACK 후 버린다. 여기서는
  dead 처리로 바꿔야 하며, 기존 spec을 그대로 옮기면 실패한다. spec도 함께 수정한다.
- **토스 빌링 테스트 상점.** 8단계 통합 테스트에 필요하다. 서명 프리셋 테스트 계정과 같이 발급한다.
- **ECS 두 서비스 구성.** 기존 Terraform backend 모듈에 없다. 수정량이 가장 큰 단계라 마지막에 둔다.
- **AWS 월 비용.** Fargate 2서비스 + RDS + ElastiCache + NAT Gateway + ALB로 월 $90~110 수준
  (NAT Gateway가 약 $32로 가장 크다). 상시 유지할지, 필요할 때만 띄울지 11단계 전에 정한다.
- **대시보드가 9단계.** 포트폴리오 목적인데 1~8단계가 끝날 때까지 보여줄 화면이 없다.
  3단계 이후 최소 이벤트 목록 화면을 먼저 끼워넣는 것을 검토한다.
