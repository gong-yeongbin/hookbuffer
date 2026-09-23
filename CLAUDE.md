# relaydam

웹훅 수신 게이트웨이. pnpm + Turborepo 모노레포. `apps/backend`(NestJS), `apps/frontend`(React),
`packages/{eslint-config,typescript-config}`.

## 문서

`docs/webhook-gateway/`에 세 문서가 있다. 코드보다 먼저 여기를 본다.

- `plan.md` — 제품 범위, 시스템 구조, 데이터 모델, 단계별 계획. 바꾸려면 사용자와 합의한다.
- `context-notes.md` — 결정과 근거. 코드만 봐서는 "왜"를 알 수 없는 결정을 내렸으면 여기에 덧붙인다.
- `checklist.md` — 단계별 작업과 verify. verify를 실제로 실행해 통과한 것만 체크한다.

## 버전 동결

메이저를 올리지 않는다. Node 24, pnpm 10.13.1, NestJS 11, Vitest 4, ioredis 5, React 19.
`@nestjs/swagger`는 11.4.7 고정. 근거와 예외는 `context-notes.md` "스택 선택" 절.

## 완료 기준

루트에서 `pnpm lint && pnpm check-types && pnpm build && pnpm test`. lint는 경고 0.
통합·e2e는 `pnpm docker:up`(postgres 17 + valkey 9.1, 런타임은 Colima) 뒤에 실행한다.
환경 변수를 추가하면 해당 앱의 `.env.example`과 루트 `turbo.json`의 `globalEnv`에 같이 넣는다.
구현 변경에는 테스트가 같은 커밋에 따라온다. 무엇을 테스트할지는 `checklist.md`의 verify 항목,
어떻게 테스트할지는 각 앱의 `CLAUDE.md`를 따른다.
커버리지는 앱마다 4지표(lines·branches·functions·statements) 90% 이상. vitest `thresholds`가
`pnpm test`에서 강제하므로 미만이면 완료가 아니다. 임계값을 낮추거나 파일을 exclude에 넣어 맞추지 않는다.

## 커밋

`type: 한국어 요약` 한 줄. 예: `feat: 웹훅 게이트웨이 모노레포 스캐폴딩과 /health 엔드포인트 추가`.
`.claude/settings.json`이 git 변경 명령을 막으므로 커밋은 사용자가 직접 한다. 메시지만 제안한다.
