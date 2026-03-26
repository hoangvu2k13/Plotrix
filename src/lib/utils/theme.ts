export type ThemeMode = 'light' | 'dark' | 'system';

export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
	if (theme === 'system') {
		if (typeof window === 'undefined') {
			return 'light';
		}

		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	return theme;
}

export function nextTheme(theme: ThemeMode): ThemeMode {
	if (theme === 'system') {
		return 'light';
	}

	if (theme === 'light') {
		return 'dark';
	}

	return 'system';
}
