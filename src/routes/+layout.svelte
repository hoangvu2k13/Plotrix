<script lang="ts">
	import { onMount } from 'svelte';

	import '$styles/tokens.css';
	import '$styles/global.css';
	import '$styles/app.css';

	let { children } = $props();

	onMount(() => {
		if (typeof CSS === 'undefined' || typeof document === 'undefined') {
			return;
		}

		document.documentElement.dataset.colorMix = CSS.supports(
			'color',
			'color-mix(in srgb, black, white)'
		)
			? 'supported'
			: 'unsupported';

		if ('serviceWorker' in navigator) {
			if (import.meta.env.DEV) {
				void navigator.serviceWorker
					.getRegistrations()
					.then((registrations) =>
						Promise.all(registrations.map((registration) => registration.unregister()))
					);
				return;
			}

			void navigator.serviceWorker.register('/sw.js', { scope: '/' });
		}
	});
</script>

<svelte:head>
	<title>Plotrix</title>
	<link rel="icon" href="/brand/icon.svg" />
	<link rel="apple-touch-icon" href="/brand/apple-touch-icon.svg" />
</svelte:head>

{@render children()}
