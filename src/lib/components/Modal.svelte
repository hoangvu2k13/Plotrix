<script lang="ts">
	import { X } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';
	import { createOutsideClickRegistry } from '$utils/outsideClick';

	type ModalRegistration = {
		close: () => void;
		isOpen: () => boolean;
		root: () => HTMLElement | null;
	};

	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const openModals = new Set<ModalRegistration>();
	const outsideClickRegistry = createOutsideClickRegistry();
	let keyListenerAttached = false;

	function handleSharedKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') {
			return;
		}

		const topmost = [...openModals].at(-1);

		if (topmost?.isOpen()) {
			topmost.close();
		}
	}

	function ensureSharedKeydownListener(): void {
		if (keyListenerAttached || typeof window === 'undefined') {
			return;
		}

		window.addEventListener('keydown', handleSharedKeydown);
		keyListenerAttached = true;
	}

	function maybeRemoveSharedKeydownListener(): void {
		if (!keyListenerAttached || openModals.size > 0 || typeof window === 'undefined') {
			return;
		}

		window.removeEventListener('keydown', handleSharedKeydown);
		keyListenerAttached = false;
	}

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
	let panel = $state<HTMLElement | null>(null);
	const registration: ModalRegistration = {
		close: () => {
			onClose();
		},
		isOpen: () => open,
		root: () => panel
	};

	$effect(() => {
		if (open) {
			openModals.add(registration);
			outsideClickRegistry.add(registration);
			ensureSharedKeydownListener();
			return;
		}

		openModals.delete(registration);
		outsideClickRegistry.delete(registration);
		maybeRemoveSharedKeydownListener();
	});

	onDestroy(() => {
		openModals.delete(registration);
		outsideClickRegistry.delete(registration);
		maybeRemoveSharedKeydownListener();
	});
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" transition:fade>
		<section
			bind:this={panel}
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
