import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: 3000,
		// 백엔드에 CORS 없이 붙는다. 프론트는 /api로 부르고 프록시가 떼어 넘긴다. 다른 포트면 VITE_API_TARGET
		proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3001', rewrite: (path) => path.replace(/^\/api/, '') } },
	},
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		setupFiles: ['./src/test/setup.ts'],
		// user-event로 폼을 채우는 테스트가 기본 5초를 넘길 때가 있다(머신이 바쁠 때). 느린 게 아니라 글자 수 때문
		testTimeout: 15000,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,tsx}'],
			// 진입점은 DOM 마운트뿐이라 제외한다. backend의 main.ts와 같은 이유. 테스트 셋업도 제품 코드가 아니다.
			exclude: ['src/main.tsx', 'src/test/**'],
			// 4지표 90% 미만이면 pnpm test가 실패한다. 근거는 루트 CLAUDE.md "완료 기준".
			thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
		},
	},
});
