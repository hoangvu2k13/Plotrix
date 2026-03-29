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
	let body: HTMLDivElement | null = null;
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

	function moveCaretToEnd(): void {
		if (!view) {
			return;
		}

		const anchor = view.state.doc.length;
		view.focus();
		view.dispatch({
			selection: { anchor, head: anchor },
			scrollIntoView: true
		});
	}

	function handleBodyPointerDown(event: PointerEvent): void {
		if (!view || !(event.target instanceof HTMLElement)) {
			return;
		}

		if (
			event.target.closest(
				'.cm-line, .cm-content, .cm-selectionLayer, .cm-cursorLayer, .cm-tooltip'
			)
		) {
			return;
		}

		if (body && event.target.closest('.editor-body') !== body) {
			return;
		}

		event.preventDefault();
		moveCaretToEnd();
	}

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
	class:has-prefix={prefix.length > 0}
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
	<div
		bind:this={body}
		class="editor-body"
		role="presentation"
		onpointerdown={handleBodyPointerDown}
	>
		<div bind:this={host} class="editor-host"></div>
		{#if value.length === 0}
			<span class="placeholder">{placeholder}</span>
		{/if}
	</div>
</div>
