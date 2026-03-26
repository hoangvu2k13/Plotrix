<script lang="ts">
	let {
		checked = false,
		onChange = () => {},
		label = 'Toggle'
	} = $props<{
		checked?: boolean;
		onChange?: (next: boolean) => void;
		label?: string;
	}>();
</script>

<button
	type="button"
	class="toggle"
	class:checked
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={() => onChange(!checked)}
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
	}

	.toggle.checked {
		border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
		background: color-mix(in srgb, var(--color-accent) 28%, var(--color-accent-subtle));
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
</style>
