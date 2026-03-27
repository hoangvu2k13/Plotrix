<script lang="ts">
	import { onMount } from 'svelte';

	let {
		value = 0,
		min = 0,
		max = 100,
		step = 1,
		ariaLabel = 'Slider',
		onChange = () => {}
	} = $props<{
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		ariaLabel?: string;
		onChange?: (value: number) => void;
	}>();

	let input: HTMLInputElement | null = null;

	function syncFill(): void {
		if (!input) {
			return;
		}

		const range = Math.max(1e-9, max - min);
		const pct = ((value - min) / range) * 100;
		input.style.setProperty('--slider-fill-pct', `${Math.max(0, Math.min(100, pct))}%`);
	}

	onMount(syncFill);

	$effect(() => {
		value;
		min;
		max;
		syncFill();
	});
</script>

<input
	bind:this={input}
	class="slider"
	type="range"
	{min}
	{max}
	{step}
	{value}
	aria-label={ariaLabel}
	oninput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
/>

<style>
	.slider {
		width: 100%;
	}
</style>
