<script lang="ts">
	import Modal from '$components/Modal.svelte';
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
	let selectedIndex = $state(0);
	let input: HTMLInputElement | null = null;

	const filtered = $derived.by(() => {
		const needle = query.trim().toLowerCase();

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
			return;
		}

		query = '';
		selectedIndex = 0;
		queueMicrotask(() => input?.focus());
	});

	function execute(action: CommandAction): void {
		action.run();
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
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
</script>

<Modal
	{open}
	title="Command palette"
	description="Jump to actions without leaving the graph."
	{onClose}
>
	<div class="palette">
		<input
			bind:this={input}
			bind:value={query}
			type="text"
			placeholder="Search commands"
			onkeydown={handleKeydown}
		/>

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
</Modal>

<style>
	.palette {
		display: grid;
		gap: var(--space-4);
	}

	input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
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
