import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['test/**/*.e2e-spec.ts'],
		setupFiles: ['./test/setup.ts'],
		// e2e는 앱을 실제로 띄운다 — 포트·DB를 공유하므로 병렬 실행하지 않는다.
		fileParallelism: false,
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
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
