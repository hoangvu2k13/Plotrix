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
	class="button-wrap"
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
		class="tooltip"
		class:visible
		class:align-end={tooltipAlign === 'end'}
		role="tooltip"
	>
		{label}
	</div>
</div>

<style>
	.button-wrap {
		position: relative;
		display: inline-flex;
	}

	.icon-button {
		display: inline-grid;
		place-items: center;
		width: var(--button-size);
		height: var(--button-size);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	.icon-button.has-touch-label {
		width: auto;
		padding: 0 var(--space-3);
		grid-auto-flow: column;
		gap: var(--space-2);
	}

	.icon-button :global(.icon) {
		display: block;
	}

	.icon-button.default {
		border-color: var(--color-border);
		background: var(--color-bg-surface);
	}

	.icon-button.ghost {
		background: transparent;
	}

	.icon-button.accent {
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	@media (hover: hover) and (pointer: fine) {
		.icon-button:hover:not(:disabled) {
			background: var(--color-bg-overlay);
			color: var(--color-text-primary);
			transform: translateY(-1px);
		}
	}

	.icon-button.active {
		border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-surface));
		color: var(--color-accent);
	}

	.icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.tooltip {
		position: absolute;
		left: 50%;
		bottom: calc(100% + 8px);
		transform: translateX(-50%) translateY(4px);
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-surface) 92%, transparent);
		box-shadow: var(--shadow-md);
		color: var(--color-text-primary);
		font-size: var(--text-xs);
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transition:
			opacity 200ms var(--ease-default),
			transform 200ms var(--ease-default);
	}

	.tooltip.visible {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}

	.tooltip.align-end {
		left: auto;
		right: 0;
		bottom: calc(100% + 8px);
		transform: translateY(4px);
	}

	.tooltip.align-end.visible {
		transform: translateY(0);
	}

	.touch-label {
		display: none;
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
	}

	@media (max-width: 960px) {
		.icon-button.has-touch-label {
			min-width: 36px;
		}

		.touch-label {
			display: inline;
		}
	}
</style>
