import { fileURLToPath, URL } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { compression, defineAlgorithm } from 'vite-plugin-compression2';
import { VitePWA } from 'vite-plugin-pwa';
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
	plugins: [
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			includeAssets: [
				'brand/icon.svg',
				'brand/maskable.svg',
				'brand/apple-touch-icon.svg',
				'robots.txt'
			],
			manifest: {
				id: '/',
				name: 'Plotrix',
				short_name: 'Plotrix',
				description:
					'A premium 2D math graph visualizer for exploring equations with clarity and speed.',
				theme_color: '#09090b',
				background_color: '#fafafa',
				display: 'standalone',
				orientation: 'any',
				scope: '/',
				start_url: '/',
				categories: ['education', 'productivity', 'utilities'],
				icons: [
					{
						src: '/brand/icon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'any'
					},
					{
						src: '/brand/maskable.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'maskable'
					},
					{
						src: '/brand/apple-touch-icon.svg',
						sizes: '180x180',
						type: 'image/svg+xml',
						purpose: 'any'
					}
				],
				shortcuts: [
					{
						name: 'New equation',
						short_name: 'Add',
						description: 'Open Plotrix and add a new equation',
						url: '/#new',
						icons: [{ src: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
					},
					{
						name: 'Share graph',
						short_name: 'Share',
						description: 'Open Plotrix and share the current graph',
						url: '/#share',
						icons: [{ src: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2,txt}'],
				navigateFallback: '/',
				cleanupOutdatedCaches: true,
				sourcemap: true,
				runtimeCaching: [
					{
						urlPattern: ({ request }) => request.destination === 'document',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'plotrix-documents',
							networkTimeoutSeconds: 3
						}
					},
					{
						urlPattern: ({ request }) =>
							request.destination === 'script' ||
							request.destination === 'style' ||
							request.destination === 'worker',
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'plotrix-app-shell'
						}
					},
					{
						urlPattern: ({ request }) =>
							request.destination === 'image' || request.destination === 'font',
						handler: 'CacheFirst',
						options: {
							cacheName: 'plotrix-assets',
							expiration: {
								maxEntries: 64,
								maxAgeSeconds: 60 * 60 * 24 * 365
							}
						}
					}
				]
			},
			devOptions: {
				enabled: false
			}
		}),
		compression({
			threshold: 8 * 1024,
			deleteOriginalAssets: false,
			algorithms: [
				defineAlgorithm('gzip', { level: 9 })
			]
		})
	],
	optimizeDeps: {
		include: [
			'mathjs',
			'katex',
			'nanoid',
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
		cssCodeSplit: true,
		modulePreload: {
			polyfill: true
		},
		reportCompressedSize: true,
		assetsInlineLimit: 4096,
		chunkSizeWarningLimit: 700,
		minify: 'esbuild',
		copyPublicDir: true,
		rollupOptions: {
			treeshake: true,
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/@codemirror')) {
						return 'codemirror';
					}

					if (id.includes('node_modules/mathjs')) {
						return 'mathjs';
					}

					if (id.includes('node_modules/katex')) {
						return 'katex';
					}

					if (id.includes('node_modules/vite-plugin-pwa') || id.includes('workbox')) {
						return 'pwa';
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
