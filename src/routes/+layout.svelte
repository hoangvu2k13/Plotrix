<script lang="ts">
	import '$styles/tokens.css';
	import '$styles/global.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Plotrix</title>
	<link rel="icon" href="/brand/icon.svg" />
	<link rel="apple-touch-icon" href="/brand/apple-touch-icon.svg" />
</svelte:head>

{@render children()}
