<script lang="ts">
	import {
		AlertTriangle,
		BarChart2,
		ChevronDown,
		Copy,
		Eye,
		EyeOff,
		GripVertical,
		Trash2
	} from '@lucide/svelte';

	import ColorPicker from '$components/ColorPicker.svelte';
	import ExpressionEditor from '$components/ExpressionEditor.svelte';
	import Icon from '$components/Icon.svelte';
	import Select from '$components/Select.svelte';
	import Slider from '$components/Slider.svelte';
	import Toggle from '$components/Toggle.svelte';
	import { toLatex, type EquationKind } from '$lib/math/engine';
	import type { GraphState, PlotEquation } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { getCachedKatex } from '$utils/katex-cache';
	import { formatDuration } from '$utils/format';
	import { renderKatex } from '$utils/katexRenderer';

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
	let previewHtml = $state('y=x');
	let previewRenderToken = 0;
	let deleteRevealed = $state(false);
	let swipeStart: { x: number; y: number } | null = $state(null);
	let wasActive = false;

	const active = $derived(ui.activeEquationId === equation.id);
	const isSelected = $derived(ui.selectedEquationIds.has(equation.id));
	const canAnalyze = $derived(equation.kind === 'cartesian' && !equation.errorMessage);

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

	const defaultRawByKind: Record<EquationKind, string> = {
		cartesian: 'sin(x)',
		polar: '2 + 2*cos(t)',
		parametric: 'x(t)=cos(t); y(t)=sin(t)',
		implicit: 'x^2 + y^2 = 9',
		inequality: 'y <= x^2'
	};

	$effect(() => {
		if (active && !wasActive) {
			expanded = true;
		}

		wasActive = active;
	});

	$effect(() => {
		void equation.errorMessage;
		if (equation.errorMessage) {
			ui.announce(`Equation error: ${equation.errorMessage}`);
		}
	});

	$effect(() => {
		const source = equation.raw.trim() || 'y=x';
		const latex = toLatex(source, equation.kind);
		const cacheKey = `${equation.kind}:${latex}:inline`;
		const cached = getCachedKatex(cacheKey);
		const token = ++previewRenderToken;

		previewHtml = cached ?? source;

		void renderKatex(cacheKey, latex, false, source).then((html) => {
			if (token === previewRenderToken) {
				previewHtml = html;
			}
		});
	});

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		const from = Number(event.dataTransfer?.getData('text/plain'));
		if (Number.isFinite(from)) {
			graph.reorderEquations(from, index);
		}
	}

	function handleDragStart(event: DragEvent): void {
		const target = event.target;
		const dragHandle = target instanceof HTMLElement ? target.closest('.drag-handle') : null;

		if (
			!(target instanceof HTMLElement) ||
			!(dragHandle instanceof HTMLElement) ||
			target.closest('input,textarea,select,label,[contenteditable="true"]')
		) {
			event.preventDefault();
			return;
		}

		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
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
			case 'implicit':
			case 'inequality':
				return '';
			default:
				return 'f(x) =';
		}
	}

	function expressionPlaceholder(kind: EquationKind): string {
		return defaultRawByKind[kind];
	}

	function handleKindChange(value: string): void {
		const nextKind = value as EquationKind;
		const nextRaw =
			nextKind === equation.kind
				? equation.raw
				: nextKind === 'cartesian'
					? equation.raw || defaultRawByKind.cartesian
					: defaultRawByKind[nextKind];

		graph.updateEquation(equation.id, { kind: nextKind, raw: nextRaw });

		if (nextKind !== equation.kind && equation.raw.trim()) {
			ui.pushToast({
				title: 'Equation type changed',
				description: 'Use undo to restore the previous equation type and expression.',
				tone: 'info',
				duration: 2200
			});
		}
	}

	function startSummarySwipe(event: PointerEvent): void {
		if (event.pointerType !== 'touch') {
			swipeStart = null;
			return;
		}

		swipeStart = { x: event.clientX, y: event.clientY };
	}

	function finishSummarySwipe(event: PointerEvent): void {
		if (!swipeStart) {
			return;
		}

		const deltaX = event.clientX - swipeStart.x;
		const deltaY = Math.abs(event.clientY - swipeStart.y);
		swipeStart = null;

		if (deltaY > 28) {
			return;
		}

		if (deltaX < -40) {
			deleteRevealed = true;
		} else if (deltaX > 20) {
			deleteRevealed = false;
		}
	}
</script>

<article
	class:active
	class:expanded
	class:selected={isSelected}
	class:delete-revealed={deleteRevealed}
	class="card"
	draggable="true"
	style={`--equation-count:${graph.equations.length};`}
	ondragstart={handleDragStart}
	ondragover={(event) => event.preventDefault()}
	ondrop={handleDrop}
	onfocusin={() => setActive()}
>
	<div
		class="summary-row"
		role="group"
		aria-label="Equation summary"
		onpointerdown={startSummarySwipe}
		onpointerup={finishSummarySwipe}
	>
		<div class="summary-color" aria-label="Equation color" style={`--swatch:${equation.color};`}>
			<ColorPicker
				value={equation.color}
				label="Equation color"
				onChange={(value) => graph.updateEquation(equation.id, { color: value })}
			/>
		</div>

		<button type="button" class="drag-handle" aria-label="Drag to reorder equation">
			<Icon icon={GripVertical} size="var(--icon-md)" class="summary-icon" />
		</button>

		<button
			type="button"
			class="summary-action"
			aria-label={equation.visible ? 'Hide equation' : 'Show equation'}
			onclick={(event) => {
				event.stopPropagation();
				graph.updateEquation(equation.id, { visible: !equation.visible });
			}}
		>
			<Icon icon={equation.visible ? Eye : EyeOff} size="var(--icon-md)" class="summary-icon" />
		</button>

		<button type="button" class="preview-button" onclick={(event) => setActive(event)}>
			<div class="preview" aria-hidden="true">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html previewHtml}
			</div>
			{#if equation.errorMessage}
				<span class="warning-badge" aria-hidden="true">
					<Icon icon={AlertTriangle} size="var(--icon-sm)" class="warning-icon" />
				</span>
			{/if}
		</button>

		<button
			type="button"
			class="summary-action"
			aria-label="Analyze equation"
			title={canAnalyze ? 'Analyze equation' : 'Analysis is available for cartesian equations.'}
			disabled={!canAnalyze}
			onclick={(event) => {
				event.stopPropagation();
				if (canAnalyze) {
					ui.setActiveAnalysisEquationId(equation.id);
				}
			}}
		>
			<Icon icon={BarChart2} size="var(--icon-md)" class="summary-icon" />
		</button>

		<button
			type="button"
			class="summary-action"
			aria-label="Duplicate equation"
			onclick={(event) => {
				event.stopPropagation();
				graph.duplicateEquation(equation.id);
				ui.announce('Equation duplicated');
			}}
		>
			<Icon icon={Copy} size="var(--icon-md)" class="summary-icon" />
		</button>

		<button
			type="button"
			class="summary-action summary-delete"
			aria-label="Delete equation"
			onclick={(event) => {
				event.stopPropagation();
				graph.removeEquation(equation.id);
				ui.announce('Equation removed');
			}}
		>
			<Icon icon={Trash2} size="var(--icon-md)" class="summary-icon" />
		</button>

		<button
			type="button"
			class="summary-action"
			aria-expanded={expanded}
			aria-label={expanded ? 'Collapse equation settings' : 'Expand equation settings'}
			onclick={(event) => {
				event.stopPropagation();
				setActive();
				expanded = !expanded;
			}}
		>
			<Icon
				icon={ChevronDown}
				size="var(--icon-md)"
				class={expanded ? 'summary-icon chevron-icon' : 'summary-icon chevron-icon chevron-rotated'}
			/>
		</button>
	</div>

	<div class="editor-row">
		<ExpressionEditor
			value={equation.raw}
			kind={equation.kind}
			prefix={expressionPrefix(equation.kind)}
			singleLine={true}
			placeholder={expressionPlaceholder(equation.kind)}
			errorMessage={equation.errorMessage}
			onChange={(value) => graph.updateEquation(equation.id, { raw: value })}
			onFocus={() => setActive()}
		/>
	</div>

	{#if expanded}
		<div class="settings-drawer">
			<div class="meta">
				<span>{equation.kind}</span>
				{#if graph.settings.showRenderTime}
					<span>{formatDuration(equation.renderTimeMs)}</span>
				{/if}
			</div>

			<div class="settings-grid">
				<label class="control">
					<span>Type</span>
					<Select
						value={equation.kind}
						options={kindOptions}
						ariaLabel="Equation type"
						onChange={handleKindChange}
					/>
				</label>

				<label class="control">
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

				<label class="control">
					<span>Width</span>
					<Slider
						min={1.5}
						max={6}
						step={0.1}
						value={equation.lineWidth}
						ariaLabel="Line width"
						onChange={(value) => graph.updateEquation(equation.id, { lineWidth: value })}
					/>
				</label>

				<label class="control">
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

				<div class="control toggle-control">
					<span>Show markers</span>
					<Toggle
						label="Show markers"
						checked={equation.showMarkers}
						onChange={(checked) => graph.updateEquation(equation.id, { showMarkers: checked })}
					/>
				</div>

				<label class="control">
					<span>Label</span>
					<input
						type="text"
						value={equation.label}
						placeholder="Add a label"
						oninput={(event) =>
							graph.updateEquation(equation.id, {
								label: (event.currentTarget as HTMLInputElement).value
							})}
					/>
				</label>

				{#if equation.kind === 'parametric'}
					<label class="control">
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

					<label class="control">
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
</article>

<style>
	.card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-surface);
		box-shadow: var(--shadow-sm);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}

	.card.active,
	.card.selected {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		box-shadow: var(--shadow-md);
	}

	.summary-row {
		position: relative;
		display: grid;
		grid-template-columns: 16px 28px 28px minmax(0, 1fr) 28px 28px 28px 28px;
		align-items: center;
		gap: var(--space-1-5);
		min-height: 44px;
	}

	.summary-color {
		position: relative;
		align-self: stretch;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--swatch);
	}

	.summary-color :global(.picker),
	.summary-color :global(.swatch) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: 0;
	}

	.summary-color :global(.swatch span) {
		border-radius: 0;
	}

	.drag-handle,
	.summary-action {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.drag-handle {
		cursor: grab;
	}

	.summary-action:hover:not(:disabled),
	.drag-handle:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.summary-action:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.summary-delete:hover {
		color: var(--color-danger);
	}

	.preview-button {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		height: 44px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		text-align: left;
		cursor: pointer;
	}

	.preview-button:hover {
		background: var(--color-bg-overlay);
	}

	.preview {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.warning-badge {
		display: inline-grid;
		place-items: center;
		color: var(--color-warning);
	}

	.editor-row :global(.editor-shell) {
		border-radius: var(--radius-md);
	}

	.editor-row :global(.editor-body),
	.editor-row :global(.editor-host) {
		min-height: 44px;
		max-height: 44px;
	}

	.settings-drawer {
		display: grid;
		gap: var(--space-3);
		max-height: min(200px, max(120px, calc(100dvh - 240px - (var(--equation-count) * 88px))));
		padding: var(--space-1) 0 0;
		overflow: auto;
	}

	.meta {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.control {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-base);
	}

	.control > span {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.control input {
		height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-surface);
		color: var(--color-text-primary);
		font-size: var(--text-sm);
	}

	.toggle-control {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
	}

	.toggle-control > span {
		align-self: center;
	}

	.error {
		color: var(--color-danger);
		font-size: var(--text-xs);
	}

	:global(.summary-icon),
	:global(.warning-icon) {
		display: block;
	}

	@media (pointer: coarse) {
		.summary-row::after {
			content: '';
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			width: 40px;
			border-radius: var(--radius-sm);
			background: color-mix(in srgb, var(--color-danger) 16%, transparent);
			opacity: 0;
			transition: opacity var(--duration-fast) var(--ease-default);
		}

		.card.delete-revealed .summary-row::after {
			opacity: 1;
		}

		.summary-delete {
			opacity: 0;
			pointer-events: none;
		}

		.card.delete-revealed .summary-delete {
			opacity: 1;
			pointer-events: auto;
		}
	}

	@media (max-width: 640px) {
		.settings-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
