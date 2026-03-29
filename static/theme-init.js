(() => {
	try {
		const saved = localStorage.getItem('plotrix-theme') ?? 'system';
		const resolved =
			saved === 'system'
				? window.matchMedia('(prefers-color-scheme: dark)').matches
					? 'dark'
					: 'light'
				: saved;

		document.documentElement.dataset.theme = resolved;
		document.documentElement.style.colorScheme = resolved;
	} catch {
		document.documentElement.dataset.theme = 'light';
		document.documentElement.style.colorScheme = 'light';
	}
})();
