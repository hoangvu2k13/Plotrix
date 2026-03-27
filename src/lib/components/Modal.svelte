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
			transition:fly={{ y: 18, duration: 220 }}
		>
			<header class="header">
				<div>
					<h2>{title}</h2>
					{#if description}
						<p class="description">{description}</p>
					{/if}
				</div>
				<button class="close" type="button" aria-label="Close dialog" onclick={onClose}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M5.5 5.5 14.5 14.5M14.5 5.5l-9 9"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					</svg>
				</button>
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
		backdrop-filter: blur(12px);
	}

	.panel {
		width: 70%;
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

	h2 {
		font-size: var(--text-xl);
		line-height: var(--line-height-tight);
	}

	.description {
		margin-top: var(--space-2);
		color: var(--color-text-secondary);
	}

	.close {
		display: inline-grid;
		place-items: center;
		width: 36px;
		height: 36px;
		align-self: flex-start;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	.close:hover {
		border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 82%, var(--color-bg-surface));
		color: var(--color-text-primary);
		transform: translateY(-1px);
	}

	.close svg {
		width: 16px;
		height: 16px;
	}

	.body {
		padding: var(--space-5) calc(var(--space-5) - var(--space-1)) var(--space-5);
	}
</style>
