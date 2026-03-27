<script lang="ts">
	let {
		checked = false,
		onChange = () => {},
		label = 'Toggle',
		ariaLabelledby,
		disabled = false
	} = $props<{
		checked?: boolean;
		onChange?: (next: boolean) => void;
		label?: string;
		ariaLabelledby?: string;
		disabled?: boolean;
	}>();
</script>

<button
	type="button"
	class="toggle"
	class:checked
	class:disabled
	role="switch"
	aria-checked={checked}
	aria-label={label}
	aria-labelledby={ariaLabelledby}
	{disabled}
	onclick={() => {
		if (!disabled) onChange(!checked);
	}}
>
	<span class="thumb"></span>
</button>

<style>
	.toggle {
		position: relative;
		width: 42px;
		height: 24px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
		background: var(--color-bg-subtle);
		cursor: pointer;
		transition:
			opacity var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.toggle.checked {
		border-color: var(--color-accent);
		background: var(--color-accent);
	}

	.thumb {
		display: block;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--color-bg-surface);
		box-shadow: var(--shadow-xs);
		transition: transform 200ms var(--ease-spring);
	}

	.toggle.checked .thumb {
		transform: translateX(18px);
	}

	.toggle.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
