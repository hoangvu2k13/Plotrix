(() => {
	const host = window.location.hostname;
	const isLocalDev =
		host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local');

	if (!isLocalDev || !('serviceWorker' in navigator)) {
		return;
	}

	const resetKey = 'plotrix-dev-sw-reset';

	void (async () => {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			const hadRegistrations = registrations.length > 0;

			await Promise.all(registrations.map((registration) => registration.unregister()));

			if ('caches' in window) {
				const cacheKeys = await caches.keys();
				await Promise.all(
					cacheKeys
						.filter((key) => key.startsWith('plotrix-'))
						.map((key) => caches.delete(key))
				);
			}

			if (
				(hadRegistrations || navigator.serviceWorker.controller) &&
				sessionStorage.getItem(resetKey) !== 'done'
			) {
				sessionStorage.setItem(resetKey, 'done');
				window.location.reload();
				return;
			}

			sessionStorage.removeItem(resetKey);
		} catch {
			// Ignore dev-only service worker reset failures.
		}
	})();
})();
