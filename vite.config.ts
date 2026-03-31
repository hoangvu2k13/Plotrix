import { fileURLToPath, URL } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const resolveAlias = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	clearScreen: false,
	resolve: {
		alias: {
			$components: resolveAlias('./src/lib/components'),
			$stores: resolveAlias('./src/lib/state'),
			$utils: resolveAlias('./src/lib/utils'),
			$styles: resolveAlias('./src/styles')
		},
		dedupe: ['svelte']
	},
	plugins: [sveltekit()],
	optimizeDeps: {
		include: [
			'mathjs',
			'katex',
			'nanoid',
			'firebase/app',
			'firebase/auth',
			'firebase/firestore',
			'@codemirror/view',
			'@codemirror/state',
			'@codemirror/lang-javascript'
		]
	},
	esbuild: {
		target: 'es2022',
		legalComments: 'none',
		charset: 'utf8'
	},
	css: {
		devSourcemap: false
	},
	server: {
		host: 'localhost',
		strictPort: true,
		hmr: {
			host: 'localhost',
			protocol: 'ws',
			clientPort: 5173
		},
		fs: {
			strict: true
		}
	},
	worker: {
		format: 'es'
	},
	build: {
		target: 'es2022',
		sourcemap: false,
		modulePreload: {
			polyfill: true
		},
		reportCompressedSize: false,
		assetsInlineLimit: 8192,
		chunkSizeWarningLimit: 700,
		minify: 'esbuild',
		copyPublicDir: false,
		rollupOptions: {
			treeshake: true,
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/@codemirror')) {
						return 'editor';
					}

					if (id.includes('node_modules/mathjs')) {
						return 'math-engine';
					}

					if (id.includes('node_modules/katex')) {
						return 'math-typesetting';
					}

					if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
						return 'firebase';
					}

					if (id.includes('node_modules/@lucide') || id.includes('node_modules/phosphor-svelte')) {
						return 'icons';
					}

					if (
						id.includes('/src/lib/state/graph.svelte.ts') ||
						id.includes('/src/lib/math/') ||
						id.includes('/src/lib/analysis/') ||
						id.includes('/src/lib/renderer/')
					) {
						return 'graph-core';
					}

					if (
						id.includes('/src/lib/components/AnalysisPanel.svelte') ||
						id.includes('/src/lib/components/DataPanel.svelte') ||
						id.includes('/src/lib/components/RegressionPanel.svelte') ||
						id.includes('/src/lib/components/VariableSliderPanel.svelte') ||
						id.includes('/src/lib/components/CommandPalette.svelte')
					) {
						return 'panels';
					}

					if (id.includes('node_modules')) {
						return 'vendor';
					}

					return undefined;
				}
			}
		}
	}
});
