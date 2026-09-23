import { nestJsConfig } from '@repo/eslint-config/nestjs';

// 헥사고날 import 경계. 근거는 docs/webhook-gateway/context-notes.md "코드 아키텍처" 절.
// 공유 설정이 typescript-eslint 플러그인을 이미 등록하므로 규칙 이름만 쓴다.
const boundary = (message, extraPatterns = []) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: [
        { name: '@prisma/client', message, allowTypeImports: true },
        { name: 'ioredis', message },
      ],
      patterns: [{ group: ['@/infra/*', ...extraPatterns], message }],
    },
  ],
});

export default [
  ...nestJsConfig,
  {
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/**/adapters/**'],
    rules: boundary('adapters/에서만 import한다. 타입은 import type으로'),
  },
  {
    files: ['src/modules/**/domain/**/*.ts'],
    rules: boundary('domain/은 순수 함수만 둔다', ['@nestjs/*', '@/modules/*/adapters/*']),
  },
];
