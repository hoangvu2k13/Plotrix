<script lang="ts">
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap } from '@codemirror/view';
	import { onMount } from 'svelte';

	let {
		value = '',
		placeholder = 'Enter an equation',
		ariaLabel = 'Equation editor',
		prefix = '',
		onChange,
		onFocus,
		onBlur
	} = $props<{
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		prefix?: string;
		onChange?: (value: string) => void;
		onFocus?: () => void;
		onBlur?: () => void;
	}>();

	let host: HTMLDivElement | null = null;
	let view: EditorView | null = null;

	const theme = EditorView.theme({
		'&': {
			fontFamily: 'var(--font-mono)',
			fontSize: '1.15rem',
			lineHeight: '1.55',
			backgroundColor: 'transparent',
			color: 'var(--color-text-primary)'
		},
		'.cm-editor': {
			minHeight: '100%',
			outline: 'none',
			backgroundColor: 'transparent'
		},
		'.cm-content': {
			minHeight: '100%',
			padding: '1.125rem 0',
			caretColor: 'var(--color-accent)',
			outline: 'none'
		},
		'.cm-line': {
			padding: '0',
			outline: 'none'
		},
		'.cm-scroller': {
			fontFamily: 'inherit',
			overflow: 'auto',
			minHeight: '100%',
			outline: 'none'
		},
		'.cm-focused': {
			outline: 'none'
		},
		'.cm-activeLine': {
			backgroundColor: 'transparent'
		},
		'.cm-cursor, .cm-dropCursor': {
			borderLeftColor: 'var(--color-accent)'
		},
		'.cm-selectionBackground': {
			backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent) !important'
		}
	});

	onMount(() => {
		if (!host) {
			return;
		}

		view = new EditorView({
			state: EditorState.create({
				doc: value,
				extensions: [
					theme,
					EditorView.lineWrapping,
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							onChange?.(update.state.doc.toString());
						}
					}),
					EditorView.domEventHandlers({
						focus: () => {
							onFocus?.();
						},
						blur: () => {
							onBlur?.();
						}
					}),
					keymap.of([
						{
							key: 'Enter',
							run() {
								return true;
							}
						}
					])
				]
			}),
			parent: host
		});

		view.contentDOM.setAttribute('aria-label', ariaLabel);

		return () => {
			view?.destroy();
			view = null;
		};
	});

	$effect(() => {
		if (!view) {
			return;
		}

		const current = view.state.doc.toString();

		if (value !== current) {
			view.dispatch({
				changes: {
					from: 0,
					to: current.length,
					insert: value
				}
			});
		}
	});
</script>

<div
	class="editor-shell"
	role="group"
	aria-label={ariaLabel}
	data-empty={value.length === 0}
	data-prefixed={prefix.length > 0}
>
	{#if prefix}
		<div class="prefix-wrap" aria-hidden="true">
			<span class="prefix">{prefix}</span>
		</div>
	{/if}
	<div class="editor-body">
		<div bind:this={host} class="editor-host"></div>
		{#if value.length === 0}
			<span class="placeholder">{placeholder}</span>
		{/if}
	</div>
</div>

<style>
	.editor-shell {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: stretch;
		border: 1px solid color-mix(in srgb, var(--color-accent) 38%, var(--color-border));
		border-radius: calc(var(--radius-xl) + 2px);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 4%, transparent),
			0 10px 28px color-mix(in srgb, black 10%, transparent);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
		overflow: hidden;
	}

	.editor-shell:focus-within {
		border-color: color-mix(in srgb, var(--color-accent) 72%, var(--color-border));
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent),
			0 18px 34px color-mix(in srgb, black 14%, transparent),
			inset 0 1px 0 color-mix(in srgb, white 6%, transparent);
	}

	.prefix-wrap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: fit-content;
		padding: var(--space-3) var(--space-4);
		border-right: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-bg-overlay) 98%, transparent),
				color-mix(in srgb, var(--color-bg-surface) 92%, transparent)
			);
	}

	.editor-body {
		position: relative;
		display: flex;
		align-items: stretch;
		min-width: 0;
		min-height: 44px;
		max-height: 200px;
		padding: 0 var(--space-4);
	}

	.editor-host {
		position: relative;
		flex: 1;
		z-index: 1;
		min-width: 0;
		min-height: 44px;
		max-height: 200px;
	}

	.prefix {
		display: inline-flex;
		align-items: center;
		height: 100%;
		color: color-mix(in srgb, var(--color-text-secondary) 92%, white 8%);
		font-family: var(--font-mono);
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		pointer-events: none;
		white-space: nowrap;
	}

	.placeholder {
		position: absolute;
		inset: 0 var(--space-4);
		display: flex;
		align-items: flex-start;
		padding-top: 1.125rem;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: 1.1rem;
		line-height: 1.55;
		pointer-events: none;
	}

	.editor-shell :global(.cm-editor),
	.editor-shell :global(.cm-editor *),
	.editor-shell :global(.cm-focused) {
		outline: none !important;
		border: 0 !important;
		box-shadow: none !important;
	}

	@media (max-width: 640px) {
		.editor-shell {
			grid-template-columns: 1fr;
		}

		.prefix-wrap {
			min-width: 0;
			justify-content: flex-start;
			padding: var(--space-3) var(--space-4);
			border-right: 0;
			border-bottom: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
		}

		.editor-body,
		.editor-host {
			min-height: 44px;
		}
	}
</style>
