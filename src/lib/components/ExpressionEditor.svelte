<script lang="ts">
	import { EditorState } from '@codemirror/state';
	import { EditorView, keymap } from '@codemirror/view';
	import { javascript } from '@codemirror/lang-javascript';
	import { onMount } from 'svelte';

	let {
		value = '',
		placeholder = 'Enter an equation',
		ariaLabel = 'Equation editor',
		onChange,
		onFocus,
		onBlur
	} = $props<{
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		onChange?: (value: string) => void;
		onFocus?: () => void;
		onBlur?: () => void;
	}>();

	let host: HTMLDivElement | null = null;
	let view: EditorView | null = null;
	let focused = $state(false);

	const theme = EditorView.theme({
		'&': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--text-md)',
			backgroundColor: 'transparent',
			color: 'var(--color-text-primary)'
		},
		'.cm-content': {
			padding: '0',
			caretColor: 'var(--color-accent)'
		},
		'.cm-line': {
			padding: '0'
		},
		'.cm-scroller': {
			fontFamily: 'inherit'
		},
		'.cm-focused': {
			outline: 'none'
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
					javascript(),
					EditorView.lineWrapping,
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							onChange?.(update.state.doc.toString());
						}
					}),
					EditorView.domEventHandlers({
						focus: () => {
							focused = true;
							onFocus?.();
						},
						blur: () => {
							focused = false;
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

<div class="editor-shell" data-empty={value.length === 0} data-focused={focused}>
	<div bind:this={host} class="editor-host"></div>
	{#if value.length === 0}
		<span class="placeholder">{placeholder}</span>
	{/if}
</div>

<style>
	.editor-shell {
		position: relative;
		min-height: 1.4rem;
	}

	.editor-host {
		position: relative;
		z-index: 1;
	}

	.placeholder {
		position: absolute;
		inset: 0;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-md);
		pointer-events: none;
	}
</style>
