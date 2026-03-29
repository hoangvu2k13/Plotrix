<script lang="ts">
	import type { Snippet } from 'svelte';
	import { nanoid } from 'nanoid';

	let {
		label,
		onClick = () => {},
		disabled = false,
		active = false,
		size = 36,
		variant = 'default',
		touchLabel = '',
		children
	} = $props<{
		label: string;
		onClick?: () => void;
		disabled?: boolean;
		active?: boolean;
		size?: number;
		variant?: 'default' | 'ghost' | 'accent';
		touchLabel?: string;
		children?: Snippet;
	}>();

	let visible = $state(false);
	let tooltipAlign = $state<'top' | 'end'>('top');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let root: HTMLDivElement | null = null;
	const tooltipId = `tooltip-${nanoid()}`;

	function showTooltip(): void {
		if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
			return;
		}

		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			if (root && typeof window !== 'undefined') {
				const rect = root.getBoundingClientRect();
				tooltipAlign = rect.left > window.innerWidth * 0.7 ? 'end' : 'top';
			}
			visible = true;
		}, 200);
	}

	function hideTooltip(): void {
		if (timer) clearTimeout(timer);
		visible = false;
	}
</script>

<div
	bind:this={root}
	class="icon-button-wrap"
	role="presentation"
	onmouseenter={showTooltip}
	onmouseleave={hideTooltip}
	onfocusin={showTooltip}
	onfocusout={hideTooltip}
>
	<button
		type="button"
		class={`icon-button ${variant}`}
		class:active
		class:has-touch-label={Boolean(touchLabel)}
		aria-label={label}
		aria-describedby={visible ? tooltipId : undefined}
		title={label}
		{disabled}
		style={`--button-size:${size}px;`}
		onclick={onClick}
	>
		{@render children?.()}
		{#if touchLabel}
			<span class="touch-label">{touchLabel}</span>
		{/if}
	</button>

	<div
		id={tooltipId}
		class="icon-button-tooltip"
		class:visible
		class:align-end={tooltipAlign === 'end'}
		role="tooltip"
	>
		{label}
	</div>
</div>
