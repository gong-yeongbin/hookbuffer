import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.spec.ts'],
		setupFiles: ['./test/setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.module.ts', 'src/main.ts', 'src/main.consumer.ts'],
			// 4지표 90% 미만이면 pnpm test가 실패한다. 근거는 루트 CLAUDE.md "완료 기준".
			thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
		},
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	// Vitest의 기본 변환기(esbuild)는 emitDecoratorMetadata를 지원하지 않아
	// NestJS DI가 생성자 타입을 읽지 못한다. SWC로 데코레이터 메타데이터를 내보낸다.
	plugins: [
		swc.vite({
			module: { type: 'es6' },
			jsc: {
				parser: { syntax: 'typescript', decorators: true },
				transform: { legacyDecorator: true, decoratorMetadata: true },
				target: 'es2022',
			},
		}),
	],
});
