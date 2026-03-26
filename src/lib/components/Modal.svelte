<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	let {
		open = false,
		title,
		description = '',
		onClose = () => {},
		children
	} = $props<{
		open?: boolean;
		title: string;
		description?: string;
		onClose?: () => void;
		children?: Snippet;
	}>();

	function handleBackdropPointerDown(event: PointerEvent): void {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (open && event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div
		class="backdrop"
		role="presentation"
		onpointerdown={handleBackdropPointerDown}
		transition:fade
	>
		<section
			class="panel"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 18, duration: 180 }}
		>
			<header class="header">
				<div>
					<p class="eyebrow">Plotrix</p>
					<h2>{title}</h2>
					{#if description}
						<p class="description">{description}</p>
					{/if}
				</div>
				<button class="close" type="button" aria-label="Close dialog" onclick={onClose}
					>Close</button
				>
			</header>
			<div class="body">
				{@render children?.()}
			</div>
		</section>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: grid;
		place-items: center;
		padding: var(--space-6);
		background: rgba(9, 9, 11, 0.55);
		backdrop-filter: blur(10px);
	}

	.panel {
		width: min(720px, 100%);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: var(--radius-2xl);
		background: color-mix(in srgb, var(--color-bg-surface) 92%, transparent);
		box-shadow: var(--shadow-xl);
		overflow: hidden;
	}

	.header {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-5) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.eyebrow {
		margin-bottom: var(--space-1);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	h2 {
		font-size: var(--text-xl);
		line-height: var(--line-height-tight);
	}

	.description {
		margin-top: var(--space-2);
		color: var(--color-text-secondary);
	}

	.close {
		align-self: flex-start;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.body {
		padding: var(--space-5);
	}
</style>
