<script lang="ts">
	import { autocompletion, closeBrackets, completeFromList } from '@codemirror/autocomplete';
	import { EditorState } from '@codemirror/state';
	import { bracketMatching } from '@codemirror/language';
	import { forceLinting, linter } from '@codemirror/lint';
	import { EditorView, keymap } from '@codemirror/view';
	import { onMount } from 'svelte';

	import type { EquationKind } from '$lib/math/engine';

	let {
		value = '',
		placeholder = 'Enter an equation',
		ariaLabel = 'Equation editor',
		prefix = '',
		kind = 'cartesian',
		singleLine = false,
		errorMessage = null,
		onChange,
		onFocus,
		onBlur
	} = $props<{
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		prefix?: string;
		kind?: EquationKind;
		singleLine?: boolean;
		errorMessage?: string | null;
		onChange?: (value: string) => void;
		onFocus?: () => void;
		onBlur?: () => void;
	}>();

	let host: HTMLDivElement | null = null;
	let view: EditorView | null = null;

	function completionEntries(kind: EquationKind) {
		const variables =
			kind === 'parametric'
				? ['t']
				: kind === 'polar'
					? ['t', 'theta']
					: kind === 'implicit'
						? ['x', 'y']
						: ['x'];

		return [
			'sin',
			'cos',
			'tan',
			'sec',
			'csc',
			'cot',
			'asin',
			'acos',
			'atan',
			'sinh',
			'cosh',
			'tanh',
			'sqrt',
			'abs',
			'log',
			'ln',
			'exp',
			'min',
			'max',
			'pow',
			'pi',
			'e',
			...variables
		].map((label) => ({
			label,
			type: label.length === 1 || label === 'theta' ? 'variable' : 'function'
		}));
	}

	const mathLinter = linter((view) => {
		const source = view.state.doc.toString();

		if (!source.trim() || !errorMessage) {
			return [];
		}

		return [
			{
				from: 0,
				to: Math.max(1, source.length),
				severity: 'error',
				message: errorMessage
			}
		];
	});

	const theme = EditorView.theme({
		'&': {
			fontFamily: 'var(--font-mono)',
			fontSize: 'var(--text-md)',
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
		},
		'.cm-tooltip-autocomplete': {
			border: '1px solid var(--color-border)',
			borderRadius: 'var(--radius-md)',
			backgroundColor: 'var(--color-bg-surface)'
		},
		'.cm-diagnostic': {
			borderBottom: '2px wavy var(--color-danger)'
		}
	});

	const singleLineEnterKeymap = keymap.of([
		{
			key: 'Enter',
			run() {
				return true;
			}
		}
	]);

	onMount(() => {
		if (!host) {
			return;
		}

		view = new EditorView({
			state: EditorState.create({
				doc: value,
				extensions: [
					theme,
					...(singleLine ? [] : [EditorView.lineWrapping]),
					bracketMatching(),
					closeBrackets(),
					autocompletion({
						override: [(context) => completeFromList(completionEntries(kind))(context)]
					}),
					mathLinter,
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
					...(singleLine ? [singleLineEnterKeymap] : [])
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

	$effect(() => {
		void errorMessage;
		if (view) {
			forceLinting(view);
		}
	});
</script>

<div
	class="editor-shell"
	role="group"
	aria-label={ariaLabel}
	data-empty={value.length === 0}
	data-prefixed={prefix.length > 0}
	data-single-line={singleLine}
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
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg-overlay) 98%, transparent),
			color-mix(in srgb, var(--color-bg-surface) 92%, transparent)
		);
	}

	.editor-body {
		position: relative;
		display: flex;
		min-width: 0;
		width: 100%;
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

	.editor-shell[data-single-line='true'] .editor-body,
	.editor-shell[data-single-line='true'] .editor-host {
		max-height: 44px;
	}

	.editor-shell[data-single-line='true'] :global(.cm-scroller) {
		overflow-x: auto;
		overflow-y: hidden;
	}

	.editor-shell[data-single-line='true'] :global(.cm-content) {
		padding: 0.7rem 0;
		white-space: nowrap;
	}

	.prefix {
		display: inline-flex;
		align-items: center;
		height: 100%;
		color: color-mix(in srgb, var(--color-text-secondary) 92%, white 8%);
		font-family: var(--font-mono);
		font-size: var(--text-md);
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
		font-size: var(--text-md);
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
