<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';

	import Icon from '$components/Icon.svelte';

	type SelectRegistration = {
		close: () => void;
		isOpen: () => boolean;
		root: () => HTMLDivElement | null;
	};

	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const openSelects = new Set<SelectRegistration>();
	let pointerListenerAttached = false;

	function handleSharedPointerDown(event: PointerEvent): void {
		for (const registration of openSelects) {
			const target = event.target;
			const root = registration.root();

			if (registration.isOpen() && root && target instanceof Node && !root.contains(target)) {
				registration.close();
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
		if (!pointerListenerAttached || openSelects.size > 0 || typeof document === 'undefined') {
			return;
		}

		document.removeEventListener('pointerdown', handleSharedPointerDown);
		pointerListenerAttached = false;
	}

	export interface SelectOption {
		value: string;
		label: string;
	}

	let {
		value,
		options,
		onChange = () => {},
		ariaLabel = 'Select option',
		disabled = false
	} = $props<{
		value: string;
		options: SelectOption[];
		onChange?: (value: string) => void;
		ariaLabel?: string;
		disabled?: boolean;
	}>();

	let open = $state(false);
	let root: HTMLDivElement | null = null;
	let activeIndex = $state(-1);
	let registration: SelectRegistration | null = null;

	const selectedIndex = $derived(
		Math.max(
			0,
			options.findIndex((option: SelectOption) => option.value === value)
		)
	);
	const selectedOption = $derived(options[selectedIndex] ?? options[0] ?? null);

	$effect(() => {
		if (!open) {
			activeIndex = selectedIndex;
		}
	});

	$effect(() => {
		if (!registration) {
			return;
		}

		if (open) {
			openSelects.add(registration);
			ensureSharedPointerListener();
			return;
		}

		openSelects.delete(registration);
		maybeRemoveSharedPointerListener();
	});

	function closeListbox(): void {
		open = false;
	}

	function openListbox(nextIndex = selectedIndex): void {
		if (disabled || options.length === 0) {
			return;
		}

		open = true;
		activeIndex = Math.max(0, Math.min(options.length - 1, nextIndex));
	}

	function toggleListbox(): void {
		if (open) {
			closeListbox();
			return;
		}

		openListbox();
	}

	function commitSelection(index: number): void {
		const option = options[index];

		if (!option) {
			return;
		}

		onChange(option.value);
		closeListbox();
	}

	function moveHighlight(delta: number): void {
		if (options.length === 0) {
			return;
		}

		const start = activeIndex >= 0 ? activeIndex : selectedIndex;
		activeIndex = (start + delta + options.length) % options.length;
	}

	function handleTriggerKeydown(event: KeyboardEvent): void {
		if (disabled) {
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) {
				openListbox(selectedIndex);
				return;
			}
			moveHighlight(1);
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) {
				openListbox(selectedIndex);
				return;
			}
			moveHighlight(-1);
		}

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (!open) {
				openListbox(selectedIndex);
				return;
			}
			commitSelection(activeIndex >= 0 ? activeIndex : selectedIndex);
		}

		if (event.key === 'Escape' && open) {
			event.preventDefault();
			closeListbox();
		}
	}

	function handleListboxKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveHighlight(1);
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveHighlight(-1);
		}

		if (event.key === 'Home') {
			event.preventDefault();
			activeIndex = 0;
		}

		if (event.key === 'End') {
			event.preventDefault();
			activeIndex = Math.max(0, options.length - 1);
		}

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			commitSelection(activeIndex >= 0 ? activeIndex : selectedIndex);
		}

		if (event.key === 'Escape' || event.key === 'Tab') {
			closeListbox();
		}
	}

	onMount(() => {
		registration = {
			close: () => {
				closeListbox();
			},
			isOpen: () => open,
			root: () => root
		};
	});

	onDestroy(() => {
		if (registration) {
			openSelects.delete(registration);
		}

		maybeRemoveSharedPointerListener();
	});
</script>

<div bind:this={root} class="select-shell" class:disabled class:open>
	<button
		type="button"
		class="select-trigger"
		aria-label={ariaLabel}
		aria-expanded={open}
		aria-haspopup="listbox"
		{disabled}
		onclick={toggleListbox}
		onkeydown={handleTriggerKeydown}
	>
		<span class="select-label">{selectedOption?.label ?? ariaLabel}</span>
		<Icon icon={ChevronDown} size="var(--icon-sm)" class="select-icon" />
	</button>

	{#if open}
		<div class="select-popover">
			<ul
				class="select-list"
				role="listbox"
				tabindex="-1"
				aria-label={ariaLabel}
				onkeydown={handleListboxKeydown}
			>
				{#each options as option, index (option.value)}
					<li>
						<button
							type="button"
							class="select-option"
							class:selected={option.value === value}
							class:highlighted={index === activeIndex}
							role="option"
							aria-selected={option.value === value}
							onmouseenter={() => (activeIndex = index)}
							onclick={() => commitSelection(index)}
						>
							{option.label}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
