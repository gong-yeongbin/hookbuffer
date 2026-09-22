import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.spec.ts'],
		// 1단계에는 단위 테스트 대상 로직이 없다. 2단계부터 spec이 붙는다.
		passWithNoTests: true,
		setupFiles: ['./test/setup.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.module.ts', 'src/main.ts', 'src/main.consumer.ts'],
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
