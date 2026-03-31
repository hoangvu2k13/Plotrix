const CACHE_NAME = 'plotrix-v1';
const APP_SHELL = ['/', '/manifest.json', '/theme-init.js', '/brand/icon.svg', '/brand/maskable.svg'];
const FIREBASE_HOSTS = new Set([
	'firestore.googleapis.com',
	'identitytoolkit.googleapis.com',
	'securetoken.googleapis.com',
	'firebaseinstallations.googleapis.com'
]);
const STATIC_DESTINATIONS = new Set(['script', 'style', 'worker', 'image', 'font', 'manifest']);
const isLocalDevHost =
	self.location.hostname === 'localhost' ||
	self.location.hostname === '127.0.0.1' ||
	self.location.hostname === '[::1]' ||
	self.location.hostname.endsWith('.local');

if (isLocalDevHost) {
	self.addEventListener('install', () => {
		void self.skipWaiting();
	});

	self.addEventListener('activate', (event) => {
		event.waitUntil(self.registration.unregister());
	});
}

self.addEventListener('install', (event) => {
	if (isLocalDevHost) {
		return;
	}

	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	if (isLocalDevHost) {
		return;
	}

	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	if (isLocalDevHost) {
		return;
	}

	const { request } = event;

	if (request.method !== 'GET') {
		return;
	}

	const url = new URL(request.url);

	if (FIREBASE_HOSTS.has(url.hostname)) {
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then((response) => {
					const clone = response.clone();
					event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)));
					return response;
				})
				.catch(async () => {
					const cached = await caches.match(request);
					return cached || caches.match('/');
				})
		);
		return;
	}

	if (url.origin !== self.location.origin) {
		return;
	}

	if (!STATIC_DESTINATIONS.has(request.destination) && !url.pathname.startsWith('/_app/')) {
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) {
				return cached;
			}

			return fetch(request).then((response) => {
				const clone = response.clone();
				event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)));
				return response;
			});
		})
	);
});
