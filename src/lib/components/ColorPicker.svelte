<script lang="ts">
	import { onDestroy } from 'svelte';

	import { EXTENDED_COLOR_PALETTE } from '$lib/constants/palette';

	const PRESET_COLORS = [...EXTENDED_COLOR_PALETTE];
	const COLOR_NAMES: Record<string, string> = {
		'#6366f1': 'Indigo',
		'#0ea5e9': 'Sky blue',
		'#14b8a6': 'Teal',
		'#22c55e': 'Green',
		'#eab308': 'Yellow',
		'#f97316': 'Orange',
		'#ef4444': 'Red',
		'#ec4899': 'Pink',
		'#8b5cf6': 'Violet',
		'#64748b': 'Slate',
		'#ffffff': 'White',
		'#09090b': 'Black'
	};

	let {
		value = '#6366f1',
		label = 'Pick color',
		onChange = () => {}
	} = $props<{
		value?: string;
		label?: string;
		onChange?: (value: string) => void;
	}>();

	let open = $state(false);
	let hexValue = $state('#6366f1');
	let root: HTMLDivElement | null = null;

	function normalizeHex(next: string): string {
		const trimmed = next.trim();

		if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
			return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
		}

		return value;
	}

	$effect(() => {
		value;
		hexValue = value;
	});

	function handleDocumentPointerDown(event: PointerEvent): void {
		if (!open || !root) {
			return;
		}

		const target = event.target;
		if (target instanceof Node && !root.contains(target)) {
			open = false;
		}
	}

	if (typeof document !== 'undefined') {
		document.addEventListener('pointerdown', handleDocumentPointerDown);
	}

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('pointerdown', handleDocumentPointerDown);
		}
	});
</script>

<div bind:this={root} class="picker">
	<button
		type="button"
		class="swatch"
		aria-label={label}
		aria-expanded={open}
		style={`--swatch:${value};`}
		onclick={() => (open = !open)}
	>
		<span aria-hidden="true"></span>
	</button>

	{#if open}
		<div class="popover" role="dialog" aria-label={`${label} options`}>
			<div class="grid" role="listbox" aria-label="Preset colors">
				{#each PRESET_COLORS as color}
					<button
						type="button"
						class:selected={color.toLowerCase() === value.toLowerCase()}
						class="color"
						style={`--swatch:${color};`}
						aria-label={`Use ${COLOR_NAMES[color] ?? color}`}
						role="option"
						aria-selected={color.toLowerCase() === value.toLowerCase()}
						onclick={() => {
							onChange(color);
							open = false;
						}}
					></button>
				{/each}
			</div>

			<label class="hex">
				<span>Hex</span>
				<input
					type="text"
					bind:value={hexValue}
					maxlength="7"
					spellcheck="false"
					aria-label={`${label} hex value`}
					onblur={() => {
						const next = normalizeHex(hexValue);
						hexValue = next;
						onChange(next);
					}}
				/>
			</label>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		display: inline-flex;
	}

	.swatch {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		cursor: pointer;
		transition:
			transform var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.swatch span,
	.color {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		background: var(--swatch);
	}

	.swatch:hover {
		transform: scale(1.06);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-color: var(--color-accent);
	}

	.popover {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: var(--z-tooltip);
		display: grid;
		gap: var(--space-3);
		min-width: 180px;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-surface) 96%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(12px);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: var(--space-2);
	}

	.color {
		width: 22px;
		height: 22px;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.color.selected {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	.hex {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.hex input {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-base);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
</style>
