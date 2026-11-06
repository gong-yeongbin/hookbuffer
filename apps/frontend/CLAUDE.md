# apps/frontend

랜딩과 대시보드. React 19 + Tailwind 4 + shadcn/ui(Base UI) + react-router 7 + TanStack Query + axios. Vite, Vitest + Testing Library + MSW.
루트 `CLAUDE.md`와 `docs/webhook-gateway/`가 전제다. 화면은 하나씩 스케치로 합의한 뒤 만든다.
제품 사실은 `PRODUCT.md`(impeccable), 디자인 방향·색·글꼴 근거는 context-notes "프론트 스타일 교체(2026-10-28)" 절.

## 폴더

```
src/
  App.tsx          라우트 표. 화면이 늘 때마다 한 줄
  main.tsx         진입점. QueryClient + TooltipProvider + BrowserRouter + Toaster, index.css
  index.css        Tailwind + 색·글꼴 토큰(CSS 변수). 랜딩과 대시보드가 같이 쓴다. 다크 모드 없음
  api/             axios 인스턴스 + 엔드포인트별 함수(events.ts, deliveries.ts …)
  auth/            토큰 보관, 로그인 상태, 보호 라우트
  components/      두 화면 이상이 쓰는 것만 (StatusTag·Time·Faq)
  components/ui/   shadcn이 복사해 준 컴포넌트. 우리 코드라 고쳐도 되고, 안 쓰는 export는 지운다
  layout/          공개 틀(PublicLayout)과 대시보드 셸(AppShell: 56px 아이콘 레일 + 48px 상단 바)
  pages/<화면>/    화면 하나에 폴더 하나. 전용 컴포넌트·테스트는 안에
  test/            Vitest 셋업(jsdom 폴리필), MSW 핸들러, renderApp
```

- 화면 전용은 `pages/<화면>/` 안에 둔다. 두 곳 이상이 쓰게 되면 그때 `components/`로 올린다. 미리 올리지 않는다.
- 폴더는 필요할 때 만든다.

## 규칙

- 컴포넌트는 `components/ui`의 shadcn 것을 쓴다. 없으면 `node node_modules/shadcn/dist/index.js add <이름>`으로 받고, 안 쓰는 서브 컴포넌트는 지운다
  (커버리지 90%를 exclude 없이 지키기 위해). `pnpm dlx`·`npx`는 이 저장소 셸 정책이 막는다.
- 색·글꼴은 `index.css`의 변수 한 곳. 화면마다 따로 정하지 않는다. 라틴 글꼴은 제목·워드마크의 League Spartan뿐, 나머지는 Pretendard.
- 대시보드는 표가 중심이다: 행 42px, 본문 13px, 제목 26px/500, 표는 흰 카드 안, 선택 표시는 2px 코발트 선. 상태는 색만으로 구분하지 않고 라벨을 같이 쓴다(`StatusTag`).
- 랜딩 규칙(design-taste-frontend): 눈썹 라벨·번호 매기기·그라데이션·그림자·얇은 선·아이콘 카드 금지. 장식은 히어로의 댐 모양 하나.
- 데스크톱 전용(최소 폭 1024px). 모바일 대응을 넣지 않는다.
- 상태는 서버 상태(TanStack Query)와 URL뿐이다. 전역 스토어를 두지 않는다.
- 토큰은 localStorage. 401이면 토큰을 지우고 `/login`으로.
- API 응답 필드 이름은 백엔드 DTO 그대로(snake_case). 매퍼를 두지 않는다.
- 행 클릭으로 여는 Sheet/Dialog는 한 틱 뒤에 `open`을 켠다(`EventSheet` 참고). 같은 클릭 이벤트 안에서 열면 Base UI가 바깥 클릭으로 보고 닫는다.

## 테스트

- `MemoryRouter` 안에서 Testing Library로 "사용자가 보는 것"(role·텍스트)만 본다. 팝업(Select·Menu·Dialog)은 `@testing-library/user-event`로 연다.
  Select 항목은 닫힌 뒤에도 DOM에 잠시 남으니 표 내용은 `role: 'cell'`로 본다.
- API는 MSW로 흉내 낸다. axios를 mock하지 않는다.
- jsdom에 없는 것(`matchMedia`·`ResizeObserver`·`scrollIntoView`·pointer capture)은 `test/setup.ts`에서 채운다.
- `pnpm test`는 커버리지 4지표 90% 미만이면 실패한다. `main.tsx`와 `test/`만 제외.

## 로컬 확인

백엔드는 `PORT=3010`(3001은 다른 프로젝트가 씀), Vite는 `VITE_API_TARGET=http://localhost:3010 pnpm dev`.
`VITE_GOOGLE_CLIENT_ID`(백엔드 `GOOGLE_CLIENT_ID`와 같은 값)가 있으면 실제 구글 버튼(GIS)이 뜨고, 없으면 `.env.local`의 `VITE_DEV_TOKEN`(시드 유저 JWT, 7일)으로 들어가는 개발용 버튼이다.
401로 튕기면 토큰이 만료된 것이다. 테스트는 `test/setup.ts`가 클라이언트 ID를 비워 개발용 버튼으로 돈다.

## 공개 범위

`src/config.ts`의 `LANDING_ONLY`가 지금 공개하는 범위다. true면 `/`만 열리고 나머지 경로는 `/`로 가며, 상단 바는 워드마크만,
본문의 시작·요금 버튼은 "준비 중"이다. 기능이 준비되면 false로 바꾼다(환경 변수가 아니다). 정적 호스팅은 모든 경로를
`index.html`로 돌려주는 SPA fallback이 있어야 한다. 테스트의 `renderApp`은 기본 false라 전체 화면을 검사한다.

## 하지 않는 것

- Redux·Zustand 등 전역 스토어. antd·Mantine 등 다른 UI 라이브러리. `@tanstack/react-table`·폼 라이브러리·날짜 선택기는 필요해질 때까지.
- `any`. `console.log`.
