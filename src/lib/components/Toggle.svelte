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
