<script lang="ts">
	import { fly } from 'svelte/transition';

	import type { Toast, UiState } from '$stores/ui.svelte';

	let { ui } = $props<{ ui: UiState }>();

	const toneLabels: Record<Toast['tone'], string> = {
		info: 'Info',
		success: 'Success',
		warning: 'Warning',
		danger: 'Error'
	};
</script>

<aside class="viewport" aria-live="polite" aria-atomic="true">
	{#each ui.toasts as toast (toast.id)}
		<div class="toast" data-tone={toast.tone} transition:fly={{ x: 20, duration: 180 }}>
			<div class="copy">
				<p class="tone">{toneLabels[toast.tone as Toast['tone']]}</p>
				<strong>{toast.title}</strong>
				<p>{toast.description}</p>
			</div>
			<button type="button" aria-label="Dismiss toast" onclick={() => ui.dismissToast(toast.id)}>
				Close
			</button>
		</div>
	{/each}
</aside>

<style>
	.viewport {
		position: fixed;
		bottom: var(--space-6);
		right: var(--space-6);
		z-index: var(--z-toast);
		display: grid;
		gap: var(--space-3);
		width: min(360px, calc(100vw - 2rem));
	}

	.toast {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(12px);
	}

	.toast[data-tone='success'] {
		border-color: color-mix(in srgb, var(--color-success) 55%, var(--color-border));
	}

	.toast[data-tone='warning'] {
		border-color: color-mix(in srgb, var(--color-warning) 55%, var(--color-border));
	}

	.toast[data-tone='danger'] {
		border-color: color-mix(in srgb, var(--color-danger) 55%, var(--color-border));
	}

	.copy {
		display: grid;
		gap: 2px;
	}

	.copy strong {
		font-size: var(--text-base);
	}

	.copy p:last-child {
		color: var(--color-text-secondary);
	}

	.tone {
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	button {
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
		cursor: pointer;
	}
</style>
