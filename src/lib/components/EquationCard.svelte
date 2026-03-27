<script lang="ts">
	import katex from 'katex';

	import ExpressionEditor from '$components/ExpressionEditor.svelte';
	import ColorPicker from '$components/ColorPicker.svelte';
	import Slider from '$components/Slider.svelte';
	import Select from '$components/Select.svelte';
	import Toggle from '$components/Toggle.svelte';
	import { toLatex, type EquationKind } from '$lib/math/engine';
	import type { GraphState, PlotEquation } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { formatDuration } from '$utils/format';

	let {
		graph,
		ui,
		equation,
		index,
		onActivate = () => {}
	} = $props<{
		graph: GraphState;
		ui: UiState;
		equation: PlotEquation;
		index: number;
		onActivate?: (id: string) => void;
	}>();

	let expanded = $state(false);
	const katexCache = sharedKatexCache;

	const active = $derived(ui.activeEquationId === equation.id);
	const isSelected = $derived(ui.selectedEquationIds.has(equation.id));
	const previewHtml = $derived.by(() => {
		const source = equation.raw.trim() || 'y=x';
		const latex = toLatex(source, equation.kind);
		const cacheKey = `${equation.kind}:${latex}`;
		const cached = katexCache.get(cacheKey);

		if (cached) {
			return cached;
		}

		try {
			const html = katex.renderToString(latex, {
				throwOnError: false,
				displayMode: false
			});
			katexCache.set(cacheKey, html);
			return html;
		} catch {
			return source;
		}
	});

	const lineStyleOptions = [
		{ value: 'solid', label: 'Solid' },
		{ value: 'dashed', label: 'Dashed' },
		{ value: 'dotted', label: 'Dotted' }
	];

	const kindOptions = [
		{ value: 'cartesian', label: 'Cartesian' },
		{ value: 'polar', label: 'Polar' },
		{ value: 'parametric', label: 'Parametric' },
		{ value: 'implicit', label: 'Implicit' },
		{ value: 'inequality', label: 'Inequality' }
	];

	$effect(() => {
		if (active) expanded = true;
	});

	$effect(() => {
		equation.errorMessage;
		if (equation.errorMessage) {
			ui.announce(`Equation error: ${equation.errorMessage}`);
		}
	});

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		const from = Number(event.dataTransfer?.getData('text/plain'));
		if (Number.isFinite(from)) graph.reorderEquations(from, index);
	}

	function handleDragStart(event: DragEvent): void {
		const target = event.target;
		if (
			!(target instanceof HTMLElement) ||
			!target.closest('.summary-row') ||
			target.closest('button,input,select,label')
		) {
			event.preventDefault();
			return;
		}

		event.dataTransfer?.setData('text/plain', String(index));
	}

	function setActive(event?: MouseEvent): void {
		onActivate?.(equation.id);

		if (event?.shiftKey) {
			ui.toggleSelectedEquationId(equation.id);
			return;
		}

		ui.setSelectedEquationIds([equation.id]);
	}

	function expressionPrefix(kind: EquationKind): string {
		switch (kind) {
			case 'polar':
				return 'θ =';
			case 'parametric':
				return '';
			case 'implicit':
				return '';
			case 'inequality':
				return '';
			default:
				return 'f(x) =';
		}
	}
</script>

<script lang="ts" module>
	const sharedKatexCache = new Map<string, string>();
</script>

<article
	class:active
	class:expanded
	class:selected={isSelected}
	class="card"
	draggable="true"
	ondragstart={handleDragStart}
	ondragover={(event) => event.preventDefault()}
	ondrop={handleDrop}
	onfocusin={() => setActive()}
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

		<div class="swatch" aria-label="Equation color" style={`--swatch:${equation.color};`}>
			<ColorPicker
				value={equation.color}
				label="Equation color"
				onChange={(value) => graph.updateEquation(equation.id, { color: value })}
			/>
		</div>

		<button type="button" class="summary-copy" onclick={(event) => setActive(event)}>
			<div class="preview" aria-hidden="true">
				{@html previewHtml}
			</div>
			{#if equation.errorMessage}
				<span class="warning-badge" aria-hidden="true">
					<svg viewBox="0 0 20 20">
						<path
							d="M10 4.25 16 15.75H4L10 4.25Zm0 4.25v2.75m0 2.5h.01"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.6"
						/>
					</svg>
				</span>
			{/if}
		</button>

		<button
			type="button"
			class="reorder"
			aria-label="Move equation up"
			disabled={index === 0}
			onclick={(event) => {
				event.stopPropagation();
				graph.reorderEquations(index, index - 1);
				ui.announce('Equation moved up');
			}}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="m10 6-4 4h8l-4-4Z"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.7"
				/>
			</svg>
		</button>

		<button
			type="button"
			class="reorder"
			aria-label="Move equation down"
			disabled={index === graph.equations.length - 1}
			onclick={(event) => {
				event.stopPropagation();
				graph.reorderEquations(index, index + 1);
				ui.announce('Equation moved down');
			}}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="m10 14 4-4H6l4 4Z"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.7"
				/>
			</svg>
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
				<span>{equation.kind}</span>
				{#if graph.settings.showRenderTime}
					<span>{formatDuration(equation.renderTimeMs)}</span>
				{/if}
			</div>

			<div class="editor">
				<ExpressionEditor
					value={equation.raw}
					prefix={expressionPrefix(equation.kind)}
					placeholder={equation.kind === 'polar'
						? '2 + 2*cos(t)'
						: equation.kind === 'parametric'
							? 'x(t)=3cos(t); y(t)=2sin(t)'
							: equation.kind === 'inequality'
								? 'y > sin(x)'
								: 'sin(x)+cos(x)'}
					onChange={(value) => graph.updateEquation(equation.id, { raw: value })}
					onFocus={() => setActive()}
				/>
			</div>

			<div class="controls">
				<label>
					<span>Type</span>
					<Select
						value={equation.kind}
						options={kindOptions}
						ariaLabel="Equation type"
						onChange={(value) =>
							graph.updateEquation(equation.id, {
								kind: value as EquationKind,
								raw:
									value === 'parametric'
										? 'x(t)=cos(t); y(t)=sin(t)'
										: value === 'polar'
											? '2 + 2*cos(t)'
											: value === 'implicit'
												? 'x^2 + y^2 = 9'
												: value === 'inequality'
													? 'y <= x^2'
													: equation.raw
							})}
					/>
				</label>

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
					<Slider
						min={1.5}
						max={6}
						step={0.1}
						value={equation.lineWidth}
						ariaLabel="Line width"
						onChange={(value) => graph.updateEquation(equation.id, { lineWidth: value })}
					/>
				</label>

				<label>
					<span>Opacity</span>
					<Slider
						min={0.1}
						max={1}
						step={0.05}
						value={equation.opacity}
						ariaLabel="Opacity"
						onChange={(value) => graph.updateEquation(equation.id, { opacity: value })}
					/>
				</label>

				{#if equation.kind === 'parametric'}
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

			<div class="footer-tools">
				<div class="tool-row">
					<span class="tool-label">
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M10 17.25s4.75-4.68 4.75-8.1a4.75 4.75 0 1 0-9.5 0c0 3.42 4.75 8.1 4.75 8.1Z"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
							/>
							<circle
								cx="10"
								cy="9.25"
								r="1.75"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
							/>
						</svg>
						<span>Show markers</span>
					</span>
					<Toggle
						label="Show markers"
						checked={equation.showMarkers}
						onChange={(checked) => graph.updateEquation(equation.id, { showMarkers: checked })}
					/>
				</div>

				<button
					type="button"
					class="analyze"
					onclick={(event) => {
						event.stopPropagation();
						ui.setActiveAnalysisEquationId(equation.id);
					}}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M4 14.5h12M5.5 12V8m4 4V5.5m4 6.5V7"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
						/>
					</svg>
					<span>Analyze</span>
				</button>
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
				ui.announce('Equation duplicated');
			}}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M6 6.25h8v9H6zM4 3.75h8v9"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
				/>
			</svg>
			Duplicate
		</button>
		<button
			type="button"
			class="ghost danger"
			onclick={(event) => {
				event.stopPropagation();
				graph.removeEquation(equation.id);
				ui.announce('Equation removed');
			}}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M5.5 6.5h9m-7.5 0V15m3-8.5V15m3-11.25H7.75l-.5 1.5H5.5v1.25h9V5.25h-1.75l-.5-1.5Z"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="1.5"
				/>
			</svg>
			Delete
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
		cursor: grab;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}

	.card:hover {
		box-shadow: var(--shadow-md);
	}

	.card.active,
	.card.selected {
		border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
		box-shadow: var(--shadow-md);
	}

	.summary-row {
		display: grid;
		grid-template-columns: 24px 10px minmax(0, 1fr) 24px 24px 28px;
		align-items: center;
		gap: var(--space-3);
		min-height: 42px;
	}

	.visibility,
	.reorder,
	.chevron {
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.visibility:hover,
	.reorder:hover,
	.chevron:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.visibility svg,
	.reorder svg,
	.chevron svg {
		width: 18px;
		height: 18px;
	}

	.reorder:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.swatch {
		position: relative;
		display: inline-grid;
		width: 10px;
		height: 42px;
		border-radius: var(--radius-full);
		background: var(--swatch);
		overflow: hidden;
	}

	.swatch :global(.swatch) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: 0;
	}

	.summary-copy {
		position: relative;
		min-width: 0;
		padding: var(--space-2) 0;
		text-align: left;
		cursor: text;
	}

	.preview {
		min-height: 1.6rem;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.editor {
		padding: 0;
	}

	.details,
	.controls,
	.meta,
	.footer-tools {
		display: grid;
		gap: var(--space-3);
	}

	.meta {
		grid-auto-flow: column;
		justify-content: space-between;
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		text-transform: capitalize;
	}

	.controls {
		grid-template-columns: 1fr;
	}

	label,
	.tool-row {
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}

	label span,
	.tool-row span {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	label {
		align-content: start;
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--color-border) 78%, transparent);
		border-radius: var(--radius-xl);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-bg-overlay) 88%, transparent),
				color-mix(in srgb, var(--color-bg-surface) 92%, transparent)
			);
	}

	input[type='text'],
	input[type='number'] {
		width: 100%;
		min-width: 0;
		min-height: 42px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-lg);
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--color-bg-base) 96%, transparent),
				color-mix(in srgb, var(--color-bg-surface) 94%, transparent)
			);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}

	input[type='text']:hover,
	input[type='number']:hover {
		border-color: color-mix(in srgb, var(--color-accent) 38%, var(--color-border));
	}

	input[type='text']:focus,
	input[type='number']:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 62%, var(--color-border));
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent);
	}

	.controls :global(.select-shell) {
		width: 100%;
		min-width: 0;
	}

	.controls :global(.slider) {
		align-self: center;
	}

	.footer-tools {
		padding-top: var(--space-2);
		border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.tool-row {
		grid-template-columns: 1fr auto;
		align-items: center;
	}

	.tool-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.tool-label svg {
		width: 16px;
		height: 16px;
	}

	.analyze,
	.ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 34px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
	}

	.analyze {
		border: 1px solid color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	.analyze svg {
		width: 16px;
		height: 16px;
	}

	.card-footer {
		display: flex;
		gap: var(--space-2);
	}

	.ghost {
		flex: 1;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-secondary);
		justify-content: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		transition:
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}

	.ghost.danger {
		color: var(--color-danger);
		border-color: transparent;
	}

	.ghost:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.ghost.danger:hover {
		background: color-mix(in srgb, var(--color-danger) 8%, transparent);
		border-color: color-mix(in srgb, var(--color-danger) 30%, transparent);
	}

	.ghost svg {
		width: 14px;
		height: 14px;
	}

	.error {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 10%, var(--color-bg-overlay));
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	.warning-badge {
		position: absolute;
		top: 50%;
		right: 0;
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		color: var(--color-danger);
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		transform: translateY(-50%);
	}

	.warning-badge svg {
		width: 14px;
		height: 14px;
	}

	.card:has(.error) .swatch {
		background: linear-gradient(180deg, var(--color-danger), var(--swatch));
	}

	@media (max-width: 720px) {
		.summary-row {
			grid-template-columns: 24px 10px minmax(0, 1fr) 24px 24px 28px;
			gap: var(--space-2);
		}

		.controls {
			grid-template-columns: 1fr;
		}
	}
</style>
