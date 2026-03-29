<script lang="ts">
	import { Search } from '@lucide/svelte';
	import { fade, fly } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';
	import { formatShortcut } from '$utils/format';

	export interface CommandAction {
		id: string;
		category: string;
		title: string;
		description: string;
		shortcut?: string;
		run: () => void;
	}

	let {
		open = false,
		actions = [] as CommandAction[],
		onClose = () => {}
	} = $props<{
		open?: boolean;
		actions?: CommandAction[];
		onClose?: () => void;
	}>();

	let query = $state('');
	let debouncedQuery = $state('');
	let selectedIndex = $state(0);
	let input = $state<HTMLInputElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const filtered = $derived.by(() => {
		const needle = debouncedQuery.trim().toLowerCase();

		if (!needle) {
			return actions;
		}

		return actions.filter(
			(action: CommandAction) =>
				action.title.toLowerCase().includes(needle) ||
				action.description.toLowerCase().includes(needle) ||
				action.category.toLowerCase().includes(needle)
		);
	});

	const grouped = $derived.by(() => {
		const groups: Record<string, CommandAction[]> = {};

		for (const action of filtered) {
			const current = groups[action.category] ?? [];
			current.push(action);
			groups[action.category] = current;
		}

		return Object.entries(groups);
	});

	$effect(() => {
		if (!open) {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			return;
		}

		query = '';
		debouncedQuery = '';
		selectedIndex = 0;
		queueMicrotask(() => input?.focus());
	});

	$effect(() => {
		if (!open) {
			return;
		}

		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			debouncedQuery = query;
			debounceTimer = null;
		}, 70);
	});

	function handleBackdropPointerDown(event: PointerEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function execute(action: CommandAction): void {
		action.run();
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		event.stopPropagation();

		if (event.key === 'Tab') {
			const focusable = panel?.querySelectorAll<HTMLElement>(
				'input, button, [tabindex]:not([tabindex="-1"])'
			);
			if (!focusable?.length) {
				return;
			}

			const items = [...focusable].filter((element) => !element.hasAttribute('disabled'));
			const currentIndex = items.findIndex((element) => element === document.activeElement);
			const direction = event.shiftKey ? -1 : 1;
			const nextIndex =
				currentIndex === -1 ? 0 : (currentIndex + direction + items.length) % items.length;
			event.preventDefault();
			items[nextIndex]?.focus();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = (selectedIndex + 1) % Math.max(filtered.length, 1);
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex =
				(selectedIndex - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1);
		}

		if (event.key === 'Enter' && filtered[selectedIndex]) {
			event.preventDefault();
			execute(filtered[selectedIndex]!);
		}
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (open && event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<div
		class="command-palette-backdrop"
		role="presentation"
		onpointerdown={handleBackdropPointerDown}
		transition:fade
	>
		<div
			bind:this={panel}
			class="command-palette-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			transition:fly={{ y: 18, duration: 220 }}
		>
			<div class="command-palette">
				<label class="search-shell">
					<Icon icon={Search} size="var(--icon-md)" class="search-icon" />
					<input
						bind:this={input}
						bind:value={query}
						type="text"
						placeholder="Search commands"
						onkeydown={handleKeydown}
					/>
				</label>

				<div class="results">
					{#if filtered.length}
						{#each grouped as [category, items] (category)}
							<div class="group">
								<p class="group-label">{category}</p>
								{#each items as action (action.id)}
									<button
										type="button"
										class:selected={filtered.indexOf(action) === selectedIndex}
										onclick={() => execute(action)}
									>
										<span class="copy">
											<strong>{action.title}</strong>
											<small>{action.description}</small>
										</span>
										{#if action.shortcut}
											<kbd>{formatShortcut(action.shortcut)}</kbd>
										{/if}
									</button>
								{/each}
							</div>
						{/each}
					{:else}
						<p class="empty">No matching actions.</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
