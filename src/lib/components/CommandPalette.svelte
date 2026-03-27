<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { formatShortcut } from '$utils/format';

	export interface CommandAction {
		id: string;
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
				action.description.toLowerCase().includes(needle)
		);
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
			const focusable = panel?.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])');
			if (!focusable?.length) {
				return;
			}

			const items = [...focusable].filter((element) => !element.hasAttribute('disabled'));
			const currentIndex = items.findIndex((element) => element === document.activeElement);
			const direction = event.shiftKey ? -1 : 1;
			const nextIndex =
				currentIndex === -1
					? 0
					: (currentIndex + direction + items.length) % items.length;
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
		class="backdrop"
		role="presentation"
		onpointerdown={handleBackdropPointerDown}
		transition:fade
	>
		<div
			bind:this={panel}
			class="panel"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			transition:fly={{ y: 18, duration: 220 }}
		>
			<div class="palette">
				<label class="search-shell">
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="m14.5 14.5 2.75 2.75M8.75 15a6.25 6.25 0 1 0 0-12.5 6.25 6.25 0 0 0 0 12.5Z"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.6"
						/>
					</svg>
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
						{#each filtered as action, index (action.id)}
							<button
								type="button"
								class:selected={index === selectedIndex}
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
					{:else}
						<p class="empty">No matching actions.</p>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: grid;
		place-items: start center;
		padding: min(14vh, 7rem) var(--space-6) var(--space-6);
		background: rgba(9, 9, 11, 0.55);
		backdrop-filter: blur(12px);
	}

	.panel {
		width: min(680px, 100%);
		border: 1px solid color-mix(in srgb, var(--color-border) 84%, transparent);
		border-radius: var(--radius-2xl);
		background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
		box-shadow: var(--shadow-xl);
		overflow: hidden;
	}

	.palette {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4);
	}

	.search-shell {
		position: relative;
		display: block;
	}

	.search-shell svg {
		position: absolute;
		top: 50%;
		left: var(--space-4);
		width: 16px;
		height: 16px;
		color: var(--color-text-secondary);
		transform: translateY(-50%);
		pointer-events: none;
	}

	input {
		width: 100%;
		padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + 24px);
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 62%, var(--color-border));
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	.results {
		display: grid;
		gap: var(--space-2);
		max-height: min(48vh, 420px);
		overflow: auto;
	}

	.results button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.results button:hover {
		background: var(--color-bg-overlay);
	}

	.results button.selected {
		padding-left: calc(var(--space-4) - 3px);
		border-color: color-mix(in srgb, var(--color-accent) 20%, transparent);
		border-left: 3px solid var(--color-accent);
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--color-accent) 20%, transparent),
			color-mix(in srgb, var(--color-accent) 8%, transparent)
		);
	}

	.copy {
		display: grid;
		gap: 2px;
	}

	.copy strong {
		color: var(--color-text-secondary);
		font-weight: var(--font-weight-medium);
	}

	.results button.selected .copy strong {
		color: var(--color-text-primary);
		font-weight: var(--font-weight-semibold);
	}

	small,
	.empty {
		color: var(--color-text-secondary);
	}

	kbd {
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		background: var(--color-bg-subtle);
	}
</style>
