# 빌드 컨텍스트는 모노레포 루트다(pnpm 워크스페이스 lockfile이 루트에 있다).
#   docker build -f apps/backend/Dockerfile -t relaydam-backend:<tag> .
#
# Fargate 태스크가 ARM64(Graviton)라 이미지도 arm64여야 한다 — x86 이미지를 push하면
# 태스크가 exec format error로 죽는다. Apple Silicon에서 빌드하면 기본이 arm64다.
FROM --platform=linux/arm64 node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

FROM base AS build
WORKDIR /repo

# 매니페스트만 먼저 복사해 install 레이어를 캐시한다 — 소스만 바뀌면 install을 건너뛴다.
# frozen-lockfile이 워크스페이스 전체를 대조하므로 쓰지 않는 워크스페이스의 package.json도 필요하다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN pnpm install --frozen-lockfile --filter backend...

COPY apps/backend apps/backend
COPY packages packages

RUN pnpm --filter backend run build

# 런타임 의존성만 담긴 자립형 트리를 만든다 — dev 의존성이 빠지고 pnpm 심볼릭 링크도 풀린다.
# pnpm 10부터 deploy는 inject-workspace-packages=true를 요구한다. 그 옵션은 워크스페이스
# 패키지를 심볼릭 링크 대신 복사로 바꿔 로컬에서 packages/* 수정이 재설치 없이는 반영되지
# 않게 만든다. backend의 워크스페이스 의존성은 devDependencies뿐이라 --prod에서 어차피
# 빠지므로, 로컬 DX를 건드리지 않는 --legacy를 쓴다.
RUN pnpm --filter backend deploy --prod --legacy /app

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node

# 실제 값은 ECS가 PORT로 주입한다.
EXPOSE 3001

CMD ["node", "dist/main"]
