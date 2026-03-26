import { fileURLToPath, URL } from 'node:url';
import { constants } from 'node:zlib';

import { sveltekit } from '@sveltejs/kit/vite';
import { compression, defineAlgorithm } from 'vite-plugin-compression2';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

const resolveAlias = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$components: resolveAlias('./src/lib/components'),
			$stores: resolveAlias('./src/lib/state'),
			$utils: resolveAlias('./src/lib/utils'),
			$styles: resolveAlias('./src/styles')
		}
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
				enabled: true
			}
		}),
		compression({
			threshold: 10 * 1024,
			algorithms: [
				defineAlgorithm('gzip', { level: 9 }),
				defineAlgorithm('brotliCompress', {
					params: {
						[constants.BROTLI_PARAM_QUALITY]: 11
					}
				})
			]
		})
	],
	optimizeDeps: {
		include: ['mathjs', '@codemirror/view', '@codemirror/state', '@codemirror/lang-javascript']
	},
	build: {
		target: 'esnext',
		sourcemap: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/@codemirror')) {
						return 'codemirror';
					}

					if (id.includes('node_modules/mathjs')) {
						return 'mathjs';
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
