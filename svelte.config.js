import adapter from '@sveltejs/adapter-static';

const isDev = process.env.NODE_ENV !== 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: true
	},
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '200.html',
			precompress: false,
			strict: true
		}),
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'base-uri': ['self'],
				'object-src': ['none'],
				'form-action': ['self', 'https://accounts.google.com'],
				'script-src': ['self', 'https://apis.google.com'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self', 'data:'],
				'img-src': [
					'self',
					'data:',
					'blob:',
					'https://*.googleusercontent.com',
					'https://*.gstatic.com'
				],
				'connect-src': [
					'self',
					'https://*.googleapis.com',
					'https://*.firebaseapp.com',
					'https://securetoken.googleapis.com',
					'https://identitytoolkit.googleapis.com',
					'https://firestore.googleapis.com',
					'https://firebaseinstallations.googleapis.com',
					...(isDev ? ['ws:', 'wss:'] : [])
				],
				'frame-src': [
					'self',
					'https://accounts.google.com',
					'https://*.google.com',
					'https://*.firebaseapp.com'
				],
				'worker-src': ['self', 'blob:'],
				'manifest-src': ['self']
			}
		},
		prerender: {
			entries: ['*'],
			handleHttpError: 'warn'
		},
		alias: {
			$components: 'src/lib/components',
			$stores: 'src/lib/state',
			$utils: 'src/lib/utils',
			$styles: 'src/styles'
		}
	}
};

export default config;
