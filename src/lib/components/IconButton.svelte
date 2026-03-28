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
		children
	} = $props<{
		label: string;
		onClick?: () => void;
		disabled?: boolean;
		active?: boolean;
		size?: number;
		variant?: 'default' | 'ghost' | 'accent';
		children?: Snippet;
	}>();

	let visible = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	const tooltipId = `tooltip-${nanoid()}`;

	function showTooltip(): void {
		if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
			return;
		}

		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			visible = true;
		}, 200);
	}

	function hideTooltip(): void {
		if (timer) clearTimeout(timer);
		visible = false;
	}
</script>

<div
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
		aria-label={label}
		aria-describedby={visible ? tooltipId : undefined}
		title={label}
		{disabled}
		style={`--button-size:${size}px;`}
		onclick={onClick}
	>
		{@render children?.()}
	</button>

	<div id={tooltipId} class="tooltip" class:visible role="tooltip">{label}</div>
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

	.icon-button:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
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
</style>
