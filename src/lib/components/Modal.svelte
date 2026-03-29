<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';

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
		class="modal-backdrop"
		role="presentation"
		onpointerdown={handleBackdropPointerDown}
		transition:fade
	>
		<section
			class="modal-panel"
			role="dialog"
			aria-modal="true"
			transition:fly={{ y: 18, duration: 220 }}
		>
			<header class="modal-header">
				<div>
					<h2>{title}</h2>
					{#if description}
						<p class="modal-description">{description}</p>
					{/if}
				</div>
				<button class="modal-close" type="button" aria-label="Close dialog" onclick={onClose}>
					<Icon icon={X} size="var(--icon-md)" class="close-icon" />
				</button>
			</header>
			<div class="modal-body">
				{@render children?.()}
			</div>
		</section>
	</div>
{/if}
