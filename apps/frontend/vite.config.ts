import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: 3000,
	},
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,tsx}'],
			// 진입점은 DOM 마운트뿐이라 제외한다. backend의 main.ts와 같은 이유.
			exclude: ['src/main.tsx'],
			// 4지표 90% 미만이면 pnpm test가 실패한다. 근거는 루트 CLAUDE.md "완료 기준".
			thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
		},
	},
});
