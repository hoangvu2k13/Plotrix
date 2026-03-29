<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { EXTENDED_COLOR_PALETTE } from '$lib/constants/palette';

	type PickerRegistration = {
		root: () => HTMLDivElement | null;
		close: () => void;
		isOpen: () => boolean;
	};

	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const openPickers = new Set<PickerRegistration>();
	let pointerListenerAttached = false;

	function handleSharedPointerDown(event: PointerEvent): void {
		for (const picker of openPickers) {
			const root = picker.root();
			const target = event.target;

			if (picker.isOpen() && root && target instanceof Node && !root.contains(target)) {
				picker.close();
			}
		}
	}

	function ensureSharedPointerListener(): void {
		if (pointerListenerAttached || typeof document === 'undefined') {
			return;
		}

		document.addEventListener('pointerdown', handleSharedPointerDown);
		pointerListenerAttached = true;
	}

	function maybeRemoveSharedPointerListener(): void {
		if (!pointerListenerAttached || openPickers.size > 0 || typeof document === 'undefined') {
			return;
		}

		document.removeEventListener('pointerdown', handleSharedPointerDown);
		pointerListenerAttached = false;
	}

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
		'#64748b': 'Slate'
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
	let invalidHex = $state(false);
	let root: HTMLDivElement | null = null;
	let registration: PickerRegistration | null = null;

	function normalizeHex(next: string): string {
		const trimmed = next.trim();

		if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
			return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
		}

		return value;
	}

	$effect(() => {
		hexValue = value;
		invalidHex = false;
	});

	$effect(() => {
		if (!registration) {
			return;
		}

		if (open) {
			openPickers.add(registration);
			ensureSharedPointerListener();
			return;
		}

		openPickers.delete(registration);
		maybeRemoveSharedPointerListener();
	});

	onMount(() => {
		registration = {
			root: () => root,
			close: () => {
				open = false;
			},
			isOpen: () => open
		};
	});

	onDestroy(() => {
		if (registration) {
			openPickers.delete(registration);
		}
		maybeRemoveSharedPointerListener();
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
				{#each PRESET_COLORS as color (color)}
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
					class:invalid={invalidHex}
					maxlength="7"
					spellcheck="false"
					aria-label={`${label} hex value`}
					oninput={() => {
						invalidHex = !/^#?[0-9a-fA-F]{0,6}$/.test(hexValue);
					}}
					onblur={() => {
						const next = normalizeHex(hexValue);
						hexValue = next;
						invalidHex = false;
						onChange(next);
					}}
				/>
			</label>
		</div>
	{/if}
</div>
