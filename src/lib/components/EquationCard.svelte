<script lang="ts">
	import katex from 'katex';

	import ExpressionEditor from '$components/ExpressionEditor.svelte';
	import Select from '$components/Select.svelte';
	import { toLatex } from '$lib/math/engine';
	import type { GraphState, PlotEquation } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { formatDuration } from '$utils/format';

	let { graph, ui, equation, index, onActivate = () => {} } = $props<{
		graph: GraphState;
		ui: UiState;
		equation: PlotEquation;
		index: number;
		onActivate?: (id: string) => void;
	}>();

	let expanded = $state(false);

	const active = $derived(ui.activeEquationId === equation.id);
	const previewHtml = $derived.by(() => {
		const source = equation.raw.trim() || 'y=x';

		try {
			return katex.renderToString(toLatex(source), {
				throwOnError: false,
				displayMode: false
			});
		} catch {
			return source;
		}
	});

	const lineStyleOptions = [
		{ value: 'solid', label: 'Solid' },
		{ value: 'dashed', label: 'Dashed' },
		{ value: 'dotted', label: 'Dotted' }
	];

	$effect(() => {
		if (active) {
			expanded = true;
		}
	});

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		const from = Number(event.dataTransfer?.getData('text/plain'));

		if (Number.isFinite(from)) {
			graph.reorderEquations(from, index);
		}
	}

	function setActive(): void {
		onActivate?.(equation.id);
	}
</script>

<article
	class:active
	class:expanded
	class="card"
	draggable="true"
	ondragstart={(event) => event.dataTransfer?.setData('text/plain', String(index))}
	ondragover={(event) => event.preventDefault()}
	ondrop={handleDrop}
>
	<div class="summary-row">
		<button
			type="button"
			class="visibility"
			aria-label={equation.visible ? 'Hide equation' : 'Show equation'}
			onclick={(event) => {
				event.stopPropagation();
				graph.updateEquation(equation.id, { visible: !equation.visible });
			}}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{#if equation.visible}
					<path
						d="M2.25 12S5.75 5.25 12 5.25 21.75 12 21.75 12 18.25 18.75 12 18.75 2.25 12 2.25 12Z"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
					<circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" stroke-width="1.7" />
				{:else}
					<path
						d="M3 3 21 21M10.72 5.35C11.13 5.29 11.56 5.25 12 5.25 18.25 5.25 21.75 12 21.75 12a18.9 18.9 0 0 1-3.64 4.68M6.08 6.08A18.6 18.6 0 0 0 2.25 12S5.75 18.75 12 18.75c1.53 0 2.91-.41 4.14-1.04"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				{/if}
			</svg>
		</button>

		<label class="swatch" aria-label="Equation color" style={`--swatch:${equation.color};`}>
			<input
				type="color"
				value={equation.color}
				onfocus={setActive}
				onclick={(event) => event.stopPropagation()}
				oninput={(event) =>
					graph.updateEquation(equation.id, {
						color: (event.currentTarget as HTMLInputElement).value
					})}
			/>
		</label>

		<button type="button" class="summary-copy" onclick={setActive}>
			<div class="preview" aria-hidden="true">
				{@html previewHtml}
			</div>
		</button>

		<button
			type="button"
			class="chevron"
			aria-expanded={expanded}
			aria-label={expanded ? 'Collapse equation details' : 'Expand equation details'}
			onclick={(event) => {
				event.stopPropagation();
				setActive();
				expanded = !expanded;
			}}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="m6 8 4 4 4-4"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.8"
				/>
			</svg>
		</button>
	</div>

	{#if expanded}
		<div class="details">
			<div class="meta">
				<span>{equation.isParametric ? 'Parametric' : 'Cartesian'}</span>
				{#if graph.settings.showRenderTime}
					<span>{formatDuration(equation.renderTimeMs)}</span>
				{/if}
			</div>

			<div class="editor">
				<ExpressionEditor
					value={equation.raw}
					placeholder="sin(x) + cos(x)"
					onChange={(value) => graph.updateEquation(equation.id, { raw: value })}
					onFocus={setActive}
				/>
			</div>

			<div class="controls">
				<label>
					<span>Label</span>
					<input
						type="text"
						value={equation.label}
						placeholder="Optional curve label"
						oninput={(event) =>
							graph.updateEquation(equation.id, {
								label: (event.currentTarget as HTMLInputElement).value
							})}
					/>
				</label>

				<label>
					<span>Line style</span>
					<Select
						value={equation.lineStyle}
						options={lineStyleOptions}
						ariaLabel="Line style"
						onChange={(value) =>
							graph.updateEquation(equation.id, {
								lineStyle: value as PlotEquation['lineStyle']
							})}
					/>
				</label>

				<label>
					<span>Line width</span>
					<input
						type="range"
						min="1.5"
						max="6"
						step="0.1"
						value={equation.lineWidth}
						oninput={(event) =>
							graph.updateEquation(equation.id, {
								lineWidth: Number((event.currentTarget as HTMLInputElement).value)
							})}
					/>
				</label>

				<label>
					<span>Opacity</span>
					<input
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						value={equation.opacity}
						oninput={(event) =>
							graph.updateEquation(equation.id, {
								opacity: Number((event.currentTarget as HTMLInputElement).value)
							})}
					/>
				</label>

				{#if equation.isParametric}
					<label>
						<span>t start</span>
						<input
							type="number"
							value={equation.paramRange[0]}
							oninput={(event) =>
								graph.updateEquation(equation.id, {
									paramRange: [
										Number((event.currentTarget as HTMLInputElement).value),
										equation.paramRange[1]
									]
								})}
						/>
					</label>

					<label>
						<span>t end</span>
						<input
							type="number"
							value={equation.paramRange[1]}
							oninput={(event) =>
								graph.updateEquation(equation.id, {
									paramRange: [
										equation.paramRange[0],
										Number((event.currentTarget as HTMLInputElement).value)
									]
								})}
						/>
					</label>
				{/if}
			</div>

			{#if equation.errorMessage}
				<p class="error">{equation.errorMessage}</p>
			{/if}
		</div>
	{/if}

	<footer class="card-footer">
		<button
			type="button"
			class="ghost"
			onclick={(event) => {
				event.stopPropagation();
				graph.duplicateEquation(equation.id);
			}}
		>
			Duplicate
		</button>
		<button
			type="button"
			class="ghost danger"
			onclick={(event) => {
				event.stopPropagation();
				graph.removeEquation(equation.id);
			}}
		>
			Remove
		</button>
	</footer>
</article>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-surface) 96%, transparent);
		box-shadow: var(--shadow-sm);
		cursor: pointer;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}

	.card:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-md);
	}

	.card.active {
		border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
		box-shadow: var(--shadow-md);
	}

	.summary-row {
		display: grid;
		grid-template-columns: 24px 10px minmax(0, 1fr) 28px;
		align-items: center;
		gap: var(--space-3);
		min-height: 42px;
	}

	.visibility,
	.chevron {
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.visibility:hover,
	.chevron:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.visibility svg,
	.chevron svg {
		width: 18px;
		height: 18px;
	}

	.chevron {
		width: 28px;
		height: 28px;
	}

	.card.expanded .chevron svg {
		transform: rotate(180deg);
	}

	.swatch {
		position: relative;
		display: block;
		width: 10px;
		height: 42px;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, black 8%, transparent);
		cursor: pointer;
	}

	.swatch input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.summary-copy {
		padding: 0;
		border: 0;
		background: transparent;
		text-align: left;
		min-width: 0;
		cursor: pointer;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.meta span {
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		background: var(--color-bg-overlay);
	}

	.preview {
		min-width: 0;
		overflow: hidden;
		color: var(--color-text-primary);
	}

	.preview :global(.katex) {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 1.02rem;
	}

	.details {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.editor {
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-base);
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
	}

	label {
		display: grid;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	label span {
		color: var(--color-text-secondary);
	}

	input[type='text'],
	input[type='number'] {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	input[type='range'] {
		width: 100%;
	}

	.error {
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.card-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		max-height: 0;
		overflow: hidden;
		opacity: 0;
		transition:
			max-height var(--duration-normal) var(--ease-default),
			opacity var(--duration-fast) var(--ease-default);
	}

	.card:hover .card-footer,
	.card.expanded .card-footer,
	.card:focus-within .card-footer {
		max-height: 42px;
		opacity: 1;
	}

	.ghost {
		height: 28px;
		padding: 0 var(--space-3);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
	}

	.ghost:hover {
		border-color: var(--color-border);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.ghost.danger {
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.controls {
			grid-template-columns: 1fr;
		}
	}
</style>
