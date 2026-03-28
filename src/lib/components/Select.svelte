<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';

	import Icon from '$components/Icon.svelte';

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
</script>

<label class="select-shell" class:disabled>
	<select
		aria-label={ariaLabel}
		{value}
		{disabled}
		onchange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>

	<Icon icon={ChevronDown} size="var(--icon-sm)" class="select-icon" />
</label>

<style>
	.select-shell {
		position: relative;
		display: inline-flex;
		width: 100%;
		min-width: 0;
	}

	.select-shell.disabled {
		opacity: 0.55;
	}

	select {
		width: 100%;
		min-width: 0;
		min-height: 42px;
		padding: 0.75rem 2.5rem 0.75rem 0.875rem;
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-lg);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-bg-overlay) 96%, transparent),
				color-mix(in srgb, var(--color-bg-surface) 94%, transparent)
			);
		color: var(--color-text-primary);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
		appearance: none;
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	select:disabled {
		cursor: not-allowed;
	}

	select:hover {
		border-color: color-mix(in srgb, var(--color-accent) 38%, var(--color-border));
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-bg-overlay) 92%, transparent),
				color-mix(in srgb, var(--color-bg-surface) 90%, transparent)
			);
	}

	select:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 62%, var(--color-border));
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	:global(.select-icon) {
		position: absolute;
		top: 50%;
		right: 12px;
		color: var(--color-text-secondary);
		transform: translateY(-50%);
		pointer-events: none;
	}
</style>
