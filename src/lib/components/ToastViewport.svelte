<script lang="ts">
	import { X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';
	import type { Toast, UiState } from '$stores/ui.svelte';

	let { ui } = $props<{ ui: UiState }>();

	const toneLabels: Record<Toast['tone'], string> = {
		info: 'Info',
		success: 'Success',
		warning: 'Warning',
		danger: 'Error'
	};
</script>

<aside class="toast-viewport viewport" aria-live="polite" aria-atomic="true">
	{#each ui.toasts as toast (toast.id)}
		<div class="toast" data-tone={toast.tone} transition:fly={{ x: 20, duration: 180 }}>
			<div class="copy">
				<p class="tone">{toneLabels[toast.tone as Toast['tone']]}</p>
				<strong>{toast.title}</strong>
				<p>{toast.description}</p>
			</div>
			<button
				type="button"
				class="toast-dismiss"
				aria-label="Dismiss toast"
				onclick={() => ui.dismissToast(toast.id)}
			>
				<Icon icon={X} size="var(--icon-sm)" class="dismiss-icon" />
			</button>
		</div>
	{/each}
</aside>
