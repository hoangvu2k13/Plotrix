<script lang="ts">
	import {
		AlertTriangle,
		BarChart2,
		ChevronDown,
		Copy,
		Eye,
		EyeOff,
		GripVertical,
		Info,
		Trash2
	} from '@lucide/svelte';

	import ColorPicker from '$components/ColorPicker.svelte';
	import ExpressionEditor from '$components/ExpressionEditor.svelte';
	import Icon from '$components/Icon.svelte';
	import Select from '$components/Select.svelte';
	import Slider from '$components/Slider.svelte';
	import Toggle from '$components/Toggle.svelte';
	import { onDestroy } from 'svelte';
	import { toLatex, type EquationKind } from '$lib/math/engine';
	import { STARTER_EQUATIONS, type GraphState, type PlotEquation } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { getCachedKatex } from '$utils/katex-cache';
	import { formatDuration } from '$utils/format';
	import { renderKatex } from '$utils/katexRenderer';
	import { sanitizeMathHtml, sanitizePlainTextHtml } from '$utils/sanitize';
	import '../../styles/components/equation-card.css';

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
	let katexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
		{ value: 'inequality', label: 'Inequality' },
		{ value: 'slopefield', label: 'Slope field' },
		{ value: 'vectorfield', label: 'Vector field' }
	];

	const defaultRawByKind: Record<EquationKind, string> = {
		cartesian:
			STARTER_EQUATIONS.find((entry) => entry.kind === 'cartesian')?.raw ?? '{x<0:-x,x>=0:x}',
		polar: '2 + 2*cos(t)',
		parametric:
			STARTER_EQUATIONS.find((entry) => entry.kind === 'parametric')?.raw ??
			'x(t)=cos(t); y(t)=sin(t)',
		implicit: 'x^2 + y^2 = 9',
		inequality: 'y <= x^2',
		slopefield: 'x - y',
		vectorfield: 'x(t)=y; y(t)=-x'
	};

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

		previewHtml = cached ? sanitizeMathHtml(cached) : sanitizePlainTextHtml(source);

		if (katexDebounceTimer) {
			clearTimeout(katexDebounceTimer);
		}

		katexDebounceTimer = setTimeout(() => {
			void renderKatex(cacheKey, latex, false, source).then((html) => {
				if (token === previewRenderToken) {
					previewHtml = sanitizeMathHtml(html);
				}
			});
		}, 200);
	});

	$effect(() => {
		void active;
		void isSelected;
		if (!active && !isSelected) {
			deleteRevealed = false;
		}
	});

	onDestroy(() => {
		if (katexDebounceTimer) {
			clearTimeout(katexDebounceTimer);
		}
	});

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		const payload = event.dataTransfer?.getData('application/x-plotrix-item');
		if (payload) {
			try {
				const parsed = JSON.parse(payload) as { type?: string; index?: number };
				if (parsed.type === 'equation' && Number.isFinite(parsed.index)) {
					graph.reorderEquations(parsed.index, index);
					return;
				}
			} catch {
				// Fall back to the legacy plain-text payload below.
			}
		}

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
			event.dataTransfer.setData(
				'application/x-plotrix-item',
				JSON.stringify({
					type: 'equation',
					equationId: equation.id,
					index
				})
			);
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
			case 'slopefield':
				return 'dy/dx =';
			case 'vectorfield':
				return 'F(x,y) =';
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
	class="equation-card"
	draggable="true"
	style={`--equation-count:${graph.equations.length};`}
	ondragstart={handleDragStart}
	ondragover={(event) => event.preventDefault()}
	ondrop={handleDrop}
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

				<label class="control">
					<span>Show when</span>
					<div class="condition-input-wrap">
						<input
							type="text"
							value={equation.condition ?? ''}
							placeholder="e.g. a > 0"
							oninput={(event) =>
								graph.updateEquation(equation.id, {
									condition: (event.currentTarget as HTMLInputElement).value || null
								})}
						/>
						{#if equation.conditionError}
							<span title={equation.conditionError} aria-label={equation.conditionError}>
								<Icon icon={Info} size="var(--icon-sm)" class="warning-icon" />
							</span>
						{/if}
					</div>
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
