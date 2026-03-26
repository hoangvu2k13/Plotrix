<script lang="ts">
	export interface SelectOption {
		value: string;
		label: string;
	}

	let {
		value,
		options,
		onChange = () => {},
		ariaLabel = 'Select option'
	} = $props<{
		value: string;
		options: SelectOption[];
		onChange?: (value: string) => void;
		ariaLabel?: string;
	}>();
</script>

<label class="select-shell">
	<select
		aria-label={ariaLabel}
		value={value}
		onchange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>

	<svg viewBox="0 0 20 20" aria-hidden="true">
		<path
			d="M5.75 7.75 10 12l4.25-4.25"
			fill="none"
			stroke="currentColor"
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="1.8"
		/>
	</svg>
</label>

<style>
	.select-shell {
		position: relative;
		display: inline-flex;
		min-width: 180px;
	}

	select {
		width: 100%;
		padding: 9px 38px 9px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
		appearance: none;
		cursor: pointer;
	}

	svg {
		position: absolute;
		top: 50%;
		right: 12px;
		width: 14px;
		height: 14px;
		color: var(--color-text-secondary);
		transform: translateY(-50%);
		pointer-events: none;
	}
</style>
