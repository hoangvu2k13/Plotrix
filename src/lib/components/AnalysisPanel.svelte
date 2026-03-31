<script lang="ts">
	import { ChevronDown, ClipboardCopy, X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';
	import Toggle from '$components/Toggle.svelte';
	import {
		adaptiveSimpsonIntegral,
		equationToLatex,
		type EquationAnalysis
	} from '$lib/analysis/equationAnalysis';
	import { evaluateCartesianAt } from '$lib/math/engine';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { getCachedKatex } from '$utils/katex-cache';
	import { copyText } from '$utils/download';
	import { renderKatex } from '$utils/katexRenderer';
	import { clamp, formatCoordinate, formatDisplay } from '$utils/format';
	import { sanitizeMathHtml, sanitizePlainTextHtml } from '$utils/sanitize';
	import '../../styles/components/analysis-panel.css';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let loading = $state(false);
	let report = $state<EquationAnalysis | null>(null);
	let errorMessage = $state<string | null>(null);
	let swipeStart: { x: number; y: number } | null = $state(null);
	let equationHtml = $state('');
	let equationRenderToken = 0;
	let drawerWidth = $state(360);
	let showFullDomain = $state(false);
	let showFullRange = $state(false);
	let showAllZeros = $state(false);
	let showAllAsymptotes = $state(false);
	let showAllCriticalPoints = $state(false);
	let editingTableRange = $state(false);
	let tableRange = $state({
		start: '-10',
		end: '10',
		step: '1'
	});
	let probabilityBounds = $state({
		lower: '-inf',
		upper: '+inf'
	});
	let sections = $state({
		domain: true,
		zeros: true,
		values: false,
		symmetry: true,
		asymptotes: true,
		critical: true,
		points: true,
		derivative: true,
		tangents: true,
		integral: true,
		probability: true,
		behavior: true
	});

	const equation = $derived(
		graph.equations.find(
			(entry: GraphState['equations'][number]) => entry.id === ui.activeAnalysisEquationId
		) ?? null
	);
	const MAX_PILLS_VISIBLE = 20;
	const MAX_ASYMPTOTES_VISIBLE = 20;
	const MAX_CRITICAL_POINTS_VISIBLE = 20;
	const DOMAIN_RANGE_PREVIEW_CHARS = 84;
	const visibleZeros = $derived.by(() =>
		(report?.zeros ?? []).slice(0, showAllZeros ? undefined : MAX_PILLS_VISIBLE)
	);
	const visibleVerticalAsymptotes = $derived.by(() =>
		(report?.verticalAsymptotes ?? []).slice(
			0,
			showAllAsymptotes ? undefined : MAX_ASYMPTOTES_VISIBLE
		)
	);
	const visibleCriticalPoints = $derived.by(() =>
		(report?.criticalPoints ?? []).slice(
			0,
			showAllCriticalPoints ? undefined : MAX_CRITICAL_POINTS_VISIBLE
		)
	);
	const viewportCenterX = $derived(
		(graph.viewport.width / 2 - graph.view.originX) / Math.max(graph.view.scaleX, 1e-6)
	);
	const visibleXSpan = $derived(graph.viewport.width / Math.max(graph.view.scaleX, 1e-6));
	const equationTangentLines = $derived.by(() =>
		equation
			? graph.tangentLines.filter(
					(entry: GraphState['tangentLines'][number]) => entry.equationId === equation.id
				)
			: []
	);
	const equationIntegralShadings = $derived.by(() =>
		equation
			? graph.integralShadings.filter(
					(entry: GraphState['integralShadings'][number]) => entry.equationId === equation.id
				)
			: []
	);
	const equationConstrainedPoints = $derived.by(() =>
		equation
			? graph.constrainedPoints.filter(
					(entry: GraphState['constrainedPoints'][number]) => entry.equationId === equation.id
				)
			: []
	);
	const isDistributionEquation = $derived.by(() =>
		Boolean(equation?.raw.match(/(normalPDF|normalCDF|binomialPDF|poissonPDF|tPDF|chiSquaredPDF)/))
	);

	function summarizeText(value: string, expanded: boolean): string {
		const trimmed = value.trim();

		if (expanded || trimmed.length <= DOMAIN_RANGE_PREVIEW_CHARS) {
			return trimmed;
		}

		return `${trimmed.slice(0, DOMAIN_RANGE_PREVIEW_CHARS).trimEnd()}...`;
	}

	$effect(() => {
		void ui.activeAnalysisEquationId;
		const target = equation;
		if (!target) {
			report = null;
			loading = false;
			errorMessage = null;
			return;
		}

		showFullDomain = false;
		showFullRange = false;
		showAllZeros = false;
		showAllAsymptotes = false;
		showAllCriticalPoints = false;

		const next = graph.getEquationAnalysis(target.id);
		const failed = graph.hasEquationAnalysisFailure(target.id);

		if (next) {
			report = next;
			loading = false;
			errorMessage = null;
		} else if (failed) {
			loading = false;
			errorMessage = 'Plotrix could not build an analysis report for this equation.';
		} else {
			loading = true;
			errorMessage = null;
		}
	});

	const MAX_VALUE_ROWS = 400;
	const valueRows = $derived.by(() => {
		if (!equation || equation.kind !== 'cartesian' || !equation.compiledExpression) {
			return [];
		}

		const start = Number(tableRange.start);
		const end = Number(tableRange.end);
		const stepInput = Number(tableRange.step);
		const magnitude = Math.abs(stepInput);

		if (
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			!Number.isFinite(magnitude) ||
			magnitude <= 0
		) {
			return [];
		}

		const direction = start <= end ? 1 : -1;
		const step = magnitude * direction;
		const scope = graph.variableScope();
		const rows: Array<{ x: number; y: number | null }> = [];

		for (
			let x = start;
			rows.length < MAX_VALUE_ROWS && (direction > 0 ? x <= end + 1e-9 : x >= end - 1e-9);
			x += step
		) {
			rows.push({
				x,
				y: evaluateCartesianAt(equation.compiledExpression, x, scope)
			});
		}

		return rows;
	});

	$effect(() => {
		if (!equation) {
			equationHtml = '';
			return;
		}

		const latex = equation.compiled ? equationToLatex(equation.compiled) : equation.raw;
		const cacheKey = `${equation.kind}:${equation.raw}:display`;
		const cached = getCachedKatex(cacheKey);
		const token = ++equationRenderToken;

		equationHtml = cached ? sanitizeMathHtml(cached) : sanitizePlainTextHtml(equation.raw);

		void renderKatex(cacheKey, latex, true, equation.raw).then((html) => {
			if (token === equationRenderToken) {
				equationHtml = sanitizeMathHtml(html);
			}
		});
	});

	$effect(() => {
		if (!equation || !ui.activeConstrainedPointId) {
			return;
		}

		const target = graph.constrainedPoints.find(
			(entry: GraphState['constrainedPoints'][number]) => entry.id === ui.activeConstrainedPointId
		);

		if (target?.equationId === equation.id) {
			sections = {
				...sections,
				points: true
			};
		}
	});

	$effect(() => {
		if (!equation) {
			return;
		}

		if (editingTableRange) {
			return;
		}

		const xMin = (0 - graph.view.originX) / graph.view.scaleX;
		const xMax = (graph.viewport.width - graph.view.originX) / graph.view.scaleX;
		tableRange = {
			start: xMin.toFixed(2),
			end: xMax.toFixed(2),
			step: Math.max(0.25, (xMax - xMin) / 12).toFixed(2)
		};
	});

	function focusPoint(x: number, y: number): void {
		const rightInset = typeof window !== 'undefined' && window.innerWidth > 700 ? drawerWidth : 0;
		graph.panTo(x, y, { right: rightInset });
	}

	function focusAsymptote(x: number): void {
		const yCenter =
			(graph.view.originY - graph.viewport.height / 2) / Math.max(graph.view.scaleY, 1e-6);
		focusPoint(x, yCenter);
	}

	function addAnalysisEquation(raw: string, description: string): void {
		const created = graph.addEquation(raw, 'cartesian');
		ui.setActiveEquationId(created.id);
		ui.pushToast({
			title: `${description} added`,
			description: 'The generated equation was added to the graph.',
			tone: 'success'
		});
	}

	function addTangentLine(): void {
		if (!equation) {
			return;
		}

		const tangent = graph.addTangentLine(equation.id, viewportCenterX);

		if (!tangent) {
			return;
		}

		ui.pushToast({
			title: 'Tangent line added',
			description: 'A tangent line was added at the center of the current viewport.',
			tone: 'success'
		});
	}

	function addConstrainedPoint(): void {
		if (!equation) {
			return;
		}

		const point = graph.addConstrainedPoint(equation.id, viewportCenterX);

		if (!point) {
			return;
		}

		ui.setActiveConstrainedPointId(point.id);
	}

	function addIntegralShading(): void {
		if (!equation) {
			return;
		}

		const center = viewportCenterX;
		const halfWidth = Math.max(visibleXSpan / 8, 0.5);
		const shading = graph.addIntegralShading(equation.id, center - halfWidth, center + halfWidth);

		if (!shading) {
			return;
		}

		ui.pushToast({
			title: 'Integral shading added',
			description: 'A shaded integral region was added for the current equation.',
			tone: 'success'
		});
	}

	function parseProbabilityBound(value: string, fallback: number): number {
		const trimmed = value.trim().toLowerCase();

		if (trimmed === '-inf' || trimmed === '-infinity') {
			return Number.NEGATIVE_INFINITY;
		}

		if (
			trimmed === '+inf' ||
			trimmed === 'inf' ||
			trimmed === '+infinity' ||
			trimmed === 'infinity'
		) {
			return Number.POSITIVE_INFINITY;
		}

		const numeric = Number(trimmed);
		return Number.isFinite(numeric) ? numeric : fallback;
	}

	function finiteDistributionBounds(lower: number, upper: number): [number, number] {
		if (Number.isFinite(lower) && Number.isFinite(upper)) {
			return [lower, upper];
		}

		if (!Number.isFinite(lower) && !Number.isFinite(upper)) {
			return [-32, 32];
		}

		if (!Number.isFinite(lower)) {
			return [upper - 32, upper];
		}

		return [lower, lower + 32];
	}

	function isDiscreteDistribution(raw: string): boolean {
		return /binomialPDF|poissonPDF/.test(raw);
	}

	function calculateProbabilityShading(): void {
		if (!equation || !equation.compiledExpression) {
			return;
		}

		const lower = parseProbabilityBound(probabilityBounds.lower, Number.NEGATIVE_INFINITY);
		const upper = parseProbabilityBound(probabilityBounds.upper, Number.POSITIVE_INFINITY);
		const scope = graph.variableScope();

		if (isDiscreteDistribution(equation.raw)) {
			const start = Number.isFinite(lower) ? Math.ceil(lower) : 0;
			const hardEnd = Number.isFinite(upper) ? Math.floor(upper) : 1024;
			let total = 0;
			let misses = 0;

			for (let k = start; k <= hardEnd; k += 1) {
				const value = evaluateCartesianAt(equation.compiledExpression, k, scope);

				if (value === null || !Number.isFinite(value)) {
					misses += 1;
					if (!Number.isFinite(upper) && misses > 16) {
						break;
					}
					continue;
				}

				misses = 0;
				total += value;
			}

			const shading = graph.addIntegralShading(
				equation.id,
				Number.isFinite(lower) ? lower : start,
				Number.isFinite(upper) ? upper : Math.max(start, hardEnd)
			);

			if (shading) {
				graph.updateIntegralShading(shading.id, {
					label: `${(total * 100).toFixed(2)}%`,
					percentage: true
				});
			}

			ui.pushToast({
				title: 'Probability shaded',
				description: `P = ${(total * 100).toFixed(2)}%.`,
				tone: 'success'
			});
			return;
		}

		const [finiteLower, finiteUpper] = finiteDistributionBounds(lower, upper);
		const probability =
			adaptiveSimpsonIntegral(
				(value) => evaluateCartesianAt(equation.compiledExpression, value, scope),
				finiteLower,
				finiteUpper,
				8
			) ?? 0;
		const shading = graph.addIntegralShading(equation.id, finiteLower, finiteUpper);

		if (shading) {
			graph.updateIntegralShading(shading.id, {
				label: `${(probability * 100).toFixed(2)}%`,
				percentage: true
			});
		}

		ui.pushToast({
			title: 'Probability shaded',
			description: `P = ${(probability * 100).toFixed(2)}%.`,
			tone: 'success'
		});
	}

	async function copyReport(): Promise<void> {
		if (!equation || !report) return;
		const text = [
			`Analysis Report: ${equation.raw}`,
			`Domain: ${report.domain}`,
			`Range: ${report.range}`,
			`Zeros: ${report.zeros.map((value) => formatDisplay(value)).join(', ') || 'None'}`,
			`Period: ${report.period ? formatDisplay(report.period) : 'None'}`,
			`Derivative: ${report.derivative}`,
			`Integral: ${report.integral}`,
			`Curvature: ${report.curvature}`
		].join('\n');
		await copyText(text);
		ui.pushToast({
			title: 'Analysis copied',
			description: 'The analysis report is now on your clipboard.',
			tone: 'success'
		});
	}

	function handleDrawerPointerDown(event: PointerEvent): void {
		if (event.pointerType !== 'touch' || typeof window === 'undefined' || window.innerWidth > 700) {
			swipeStart = null;
			return;
		}

		swipeStart = { x: event.clientX, y: event.clientY };
	}

	function handleDrawerPointerUp(event: PointerEvent): void {
		if (!swipeStart) {
			return;
		}

		const deltaX = event.clientX - swipeStart.x;
		const deltaY = Math.abs(event.clientY - swipeStart.y);
		swipeStart = null;

		if (deltaX > 72 && deltaY < 44) {
			ui.setActiveAnalysisEquationId(null);
		}
	}

	function startResize(event: MouseEvent): void {
		if (typeof window === 'undefined' || window.innerWidth <= 700) {
			return;
		}

		const startX = event.clientX;
		const startWidth = drawerWidth;

		const handleMove = (moveEvent: MouseEvent) => {
			drawerWidth = clamp(startWidth + (startX - moveEvent.clientX), 280, 560);
		};

		const handleUp = () => {
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);
		};

		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);
	}
</script>

{#if equation}
	<button
		type="button"
		class="analysis-backdrop"
		style={`left:${ui.sidebarOpen ? `${graph.settings.equationPanelWidth + 20}px` : '20px'}`}
		aria-label="Close analysis panel"
		onclick={() => ui.setActiveAnalysisEquationId(null)}
		transition:fade
	></button>
	<div
		class="analysis-drawer"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label="Analysis report"
		style={`--drawer-width:${drawerWidth}px;`}
		onpointerdown={handleDrawerPointerDown}
		onpointerup={handleDrawerPointerUp}
	>
		<div
			class="resize-handle"
			role="separator"
			aria-orientation="vertical"
			aria-label="Analysis panel edge"
		>
			<button type="button" aria-label="Resize analysis panel" onmousedown={startResize}></button>
		</div>
		<div class="inner">
			<header class="header">
				<div class="swatch" style={`--swatch:${equation.color}`}></div>
				<div class="title">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="katex">{@html equationHtml}</div>
					<p>Analysis Report</p>
				</div>
				<div class="header-actions">
					<button type="button" onclick={copyReport}>
						<Icon icon={ClipboardCopy} size="var(--icon-sm)" class="header-icon" />
						<span>Copy report</span>
					</button>
					<button
						type="button"
						aria-label="Close analysis panel"
						onclick={() => ui.setActiveAnalysisEquationId(null)}
					>
						<Icon icon={X} size="var(--icon-sm)" class="header-icon" />
					</button>
				</div>
			</header>
			{#if equation.condition}
				<div class="pills">
					<span class="pill">Conditional: {equation.condition}</span>
				</div>
			{/if}

			{#if loading && !report}
				<div class="loading">
					<div></div>
					<div></div>
					<div></div>
					<div></div>
				</div>
			{:else if errorMessage || !report}
				<p class="muted">{errorMessage ?? 'Analysis is unavailable for this equation.'}</p>
			{:else}
				<div class="sections analysis-sections-shell">
					{#if loading}
						<div class="analysis-updating" aria-label="Updating analysis...">
							<div class="analysis-updating-spinner"></div>
						</div>
					{/if}
					{#if report.partial}
						<p class="partial-note">
							Showing critical points first while the full report finishes.
						</p>
					{/if}
					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.domain = !sections.domain)}
						>
							<span>Domain & Range</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.domain ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.domain}
							<div class="rows rows-domain mono">
								<div>
									<strong>Domain</strong>
									<span>{summarizeText(report.domain, showFullDomain)}</span>
								</div>
								{#if report.domain.length > DOMAIN_RANGE_PREVIEW_CHARS}
									<button
										type="button"
										class="inline-toggle"
										onclick={() => (showFullDomain = !showFullDomain)}
									>
										{showFullDomain ? 'Show less' : '... more'}
									</button>
								{/if}
								<div>
									<strong>Range</strong>
									<span>{summarizeText(report.range, showFullRange)}</span>
								</div>
								{#if report.range.length > DOMAIN_RANGE_PREVIEW_CHARS}
									<button
										type="button"
										class="inline-toggle"
										onclick={() => (showFullRange = !showFullRange)}
									>
										{showFullRange ? 'Show less' : '... more'}
									</button>
								{/if}
							</div>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.zeros = !sections.zeros)}
						>
							<span>Zeros</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.zeros ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.zeros}
							<div class="pills">
								{#if visibleZeros.length}
									{#each visibleZeros as zero (`${zero}`)}
										<button type="button" class="pill" onclick={() => focusPoint(zero, 0)}
											>x = {formatDisplay(zero)}</button
										>
									{/each}
									{#if report.zeros.length > MAX_PILLS_VISIBLE}
										<button
											type="button"
											class="pill"
											onclick={() => (showAllZeros = !showAllZeros)}
										>
											{showAllZeros
												? 'Show fewer'
												: `... ${report.zeros.length - MAX_PILLS_VISIBLE} more`}
										</button>
									{/if}
								{:else}
									<p class="muted">No zeros in visible range</p>
								{/if}
							</div>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.values = !sections.values)}
						>
							<span>Table of Values</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.values ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.values}
							<div class="values-controls">
								<label>
									<span>Start</span>
									<input
										type="number"
										bind:value={tableRange.start}
										onfocus={() => (editingTableRange = true)}
										onblur={() => (editingTableRange = false)}
									/>
								</label>
								<label>
									<span>End</span>
									<input
										type="number"
										bind:value={tableRange.end}
										onfocus={() => (editingTableRange = true)}
										onblur={() => (editingTableRange = false)}
									/>
								</label>
								<label>
									<span>Step</span>
									<input
										type="number"
										bind:value={tableRange.step}
										onfocus={() => (editingTableRange = true)}
										onblur={() => (editingTableRange = false)}
									/>
								</label>
							</div>
							<div class="values-table-wrap">
								<table class="table">
									<thead>
										<tr><th>x</th><th>f(x)</th></tr>
									</thead>
									<tbody>
										{#if valueRows.length}
											{#each valueRows as row (`${row.x}`)}
												<tr>
													<td
														><button
															type="button"
															class="table-button"
															onclick={() => focusPoint(row.x, row.y ?? 0)}
														>
															{formatCoordinate(row.x)}
														</button></td
													>
													<td>{row.y === null ? 'undefined' : formatCoordinate(row.y)}</td>
												</tr>
											{/each}
										{:else}
											<tr>
												<td colspan="2" class="muted">Enter a finite start, end, and step.</td>
											</tr>
										{/if}
									</tbody>
								</table>
							</div>
							{#if valueRows.length >= MAX_VALUE_ROWS}
								<p class="muted">Showing the first {MAX_VALUE_ROWS} rows for performance.</p>
							{/if}
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.symmetry = !sections.symmetry)}
						>
							<span>Symmetry & Period</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.symmetry ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.symmetry}
							<div class="rows">
								<div>
									<strong>Symmetry</strong><span
										>{report.isEven ? 'Even' : report.isOdd ? 'Odd' : 'None'}</span
									>
								</div>
								<div>
									<strong>Period</strong><span
										>{report.period ? `T = ${formatDisplay(report.period)}` : 'None detected'}</span
									>
								</div>
							</div>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.asymptotes = !sections.asymptotes)}
						>
							<span>Asymptotes</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.asymptotes ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.asymptotes}
							<div class="pills">
								{#if visibleVerticalAsymptotes.length}
									{#each visibleVerticalAsymptotes as value (`${value}`)}
										<button
											type="button"
											class="pill"
											onclick={() => focusAsymptote(value)}
											onmouseenter={() => ui.setHighlightedAsymptotes([value])}
											onfocus={() => ui.setHighlightedAsymptotes([value])}
											onmouseleave={() => ui.setHighlightedAsymptotes([])}
											onblur={() => ui.setHighlightedAsymptotes([])}
										>
											x = {formatDisplay(value)}
										</button>
									{/each}
									{#if report.verticalAsymptotes.length > MAX_ASYMPTOTES_VISIBLE}
										<button
											type="button"
											class="pill"
											onclick={() => (showAllAsymptotes = !showAllAsymptotes)}
										>
											{showAllAsymptotes
												? 'Show fewer'
												: `... ${report.verticalAsymptotes.length - MAX_ASYMPTOTES_VISIBLE} more`}
										</button>
									{/if}
								{:else}
									<p class="muted">None</p>
								{/if}
							</div>
							<p class="muted">
								{report.horizontalAsymptotes.left !== null ||
								report.horizontalAsymptotes.right !== null
									? `y → ${report.horizontalAsymptotes.left === null ? 'none' : formatDisplay(report.horizontalAsymptotes.left)} as x → -∞ · y → ${report.horizontalAsymptotes.right === null ? 'none' : formatDisplay(report.horizontalAsymptotes.right)} as x → +∞`
									: 'None'}
							</p>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.critical = !sections.critical)}
						>
							<span>Critical Points</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.critical ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.critical}
							{#if visibleCriticalPoints.length}
								<table class="table">
									<thead>
										<tr><th>Kind</th><th>x</th><th>y</th></tr>
									</thead>
									<tbody>
										{#each visibleCriticalPoints as point (`${point.kind}:${point.x}:${point.y}`)}
											<tr>
												<td
													><button
														type="button"
														class="table-button"
														onclick={() => focusPoint(point.x, point.y)}>{point.kind}</button
													></td
												>
												<td>{formatDisplay(point.x)}</td>
												<td>{formatDisplay(point.y)}</td>
											</tr>
										{/each}
									</tbody>
								</table>
								{#if report.criticalPoints.length > MAX_CRITICAL_POINTS_VISIBLE}
									<button
										type="button"
										class="inline-toggle"
										onclick={() => (showAllCriticalPoints = !showAllCriticalPoints)}
									>
										{showAllCriticalPoints
											? 'Show fewer critical points'
											: `... ${report.criticalPoints.length - MAX_CRITICAL_POINTS_VISIBLE} more critical points`}
									</button>
								{/if}
							{:else}
								<p class="muted">No critical points were detected in the current viewport.</p>
							{/if}
							<button type="button" class="pill" onclick={addConstrainedPoint}>Add point</button>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.points = !sections.points)}
						>
							<span>Constrained Points</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.points ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.points}
							{#if equationConstrainedPoints.length}
								<table class="table">
									<thead>
										<tr><th>x</th><th>Label</th><th>Coords</th><th>Remove</th></tr>
									</thead>
									<tbody>
										{#each equationConstrainedPoints as point (point.id)}
											<tr>
												<td>
													<input
														type="number"
														value={point.x}
														onchange={(event) =>
															graph.updateConstrainedPoint(point.id, {
																x: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</td>
												<td>
													<input
														type="text"
														value={point.label}
														placeholder="Point label"
														oninput={(event) =>
															graph.updateConstrainedPoint(point.id, {
																label: (event.currentTarget as HTMLInputElement).value
															})}
													/>
												</td>
												<td>
													<Toggle
														checked={point.showCoordinates}
														label="Show point coordinates"
														onChange={(showCoordinates) =>
															graph.updateConstrainedPoint(point.id, { showCoordinates })}
													/>
												</td>
												<td>
													<button
														type="button"
														class="table-button"
														onclick={() => graph.removeConstrainedPoint(point.id)}
													>
														Remove
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}
								<p class="muted">No constrained points are attached to this equation yet.</p>
							{/if}
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.derivative = !sections.derivative)}
						>
							<span>Derivative</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.derivative ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.derivative}
							<p class="mono">{report.derivative}</p>
							{#if report.derivativeExpression}
								<button
									type="button"
									class="pill"
									onclick={() =>
										addAnalysisEquation(report?.derivativeExpression ?? equation.raw, 'Derivative')}
									>Add derivative to graph</button
								>
							{/if}
							<button type="button" class="pill" onclick={addTangentLine}>Add tangent line</button>
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.tangents = !sections.tangents)}
						>
							<span>Tangent Lines</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.tangents ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.tangents}
							{#if equationTangentLines.length}
								<table class="table">
									<thead>
										<tr><th>Visible</th><th>x</th><th>Remove</th></tr>
									</thead>
									<tbody>
										{#each equationTangentLines as tangent (tangent.id)}
											<tr>
												<td>
													<Toggle
														checked={tangent.visible}
														label="Toggle tangent line visibility"
														onChange={(visible) => graph.updateTangentLine(tangent.id, { visible })}
													/>
												</td>
												<td>
													<input
														type="number"
														value={tangent.x}
														onchange={(event) =>
															graph.updateTangentLine(tangent.id, {
																x: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</td>
												<td>
													<button
														type="button"
														class="table-button"
														onclick={() => graph.removeTangentLine(tangent.id)}
													>
														Remove
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}
								<p class="muted">No tangent lines are attached to this equation yet.</p>
							{/if}
						{/if}
					</section>

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.integral = !sections.integral)}
						>
							<span>Integral</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.integral ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.integral}
							<p class="mono">{report.integral}</p>
							{#if report.integralExpression}
								<button
									type="button"
									class="pill"
									onclick={() =>
										addAnalysisEquation(
											report?.integralExpression ?? equation.raw,
											'Antiderivative'
										)}>Add antiderivative to graph</button
								>
							{/if}
							<button type="button" class="pill" onclick={addIntegralShading}>Add shading</button>
							{#if equationIntegralShadings.length}
								<table class="table">
									<thead>
										<tr
											><th>Visible</th><th>x min</th><th>x max</th><th>Value</th><th>Remove</th></tr
										>
									</thead>
									<tbody>
										{#each equationIntegralShadings as shading (shading.id)}
											<tr>
												<td>
													<Toggle
														checked={shading.visible}
														label="Toggle shading visibility"
														onChange={(visible) =>
															graph.updateIntegralShading(shading.id, { visible })}
													/>
												</td>
												<td>
													<input
														type="number"
														value={shading.xMin}
														onchange={(event) =>
															graph.updateIntegralShading(shading.id, {
																xMin: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</td>
												<td>
													<input
														type="number"
														value={shading.xMax}
														onchange={(event) =>
															graph.updateIntegralShading(shading.id, {
																xMax: Number((event.currentTarget as HTMLInputElement).value)
															})}
													/>
												</td>
												<td>
													<Toggle
														checked={shading.showValue}
														label="Toggle integral value label"
														onChange={(showValue) =>
															graph.updateIntegralShading(shading.id, { showValue })}
													/>
												</td>
												<td>
													<button
														type="button"
														class="table-button"
														onclick={() => graph.removeIntegralShading(shading.id)}
													>
														Remove
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{:else}
								<p class="muted">No integral shadings are attached to this equation yet.</p>
							{/if}
						{/if}
					</section>

					{#if isDistributionEquation}
						<section>
							<button
								type="button"
								class="accordion"
								onclick={() => (sections.probability = !sections.probability)}
							>
								<span>Shade Probability</span>
								<Icon
									icon={ChevronDown}
									size="var(--icon-md)"
									class={sections.probability ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
								/>
							</button>
							{#if sections.probability}
								<div class="values-controls">
									<label>
										<span>Lower</span>
										<input type="text" bind:value={probabilityBounds.lower} />
									</label>
									<label>
										<span>Upper</span>
										<input type="text" bind:value={probabilityBounds.upper} />
									</label>
								</div>
								<button type="button" class="pill" onclick={calculateProbabilityShading}>
									Calculate P(a ≤ X ≤ b)
								</button>
							{/if}
						</section>
					{/if}

					<section>
						<button
							type="button"
							class="accordion"
							onclick={() => (sections.behavior = !sections.behavior)}
						>
							<span>Behavior Summary</span>
							<Icon
								icon={ChevronDown}
								size="var(--icon-md)"
								class={sections.behavior ? 'accordion-icon' : 'accordion-icon chevron-rotated'}
							/>
						</button>
						{#if sections.behavior}
							<div class="rows">
								<div>
									<strong>Monotone</strong><span>{report.isMonotone ? 'Yes' : 'Partial'}</span>
								</div>
								<div>
									<strong>Continuous</strong><span>{report.isContinuous ? 'Yes' : 'No'}</span>
								</div>
								<div><strong>Curvature</strong><span>{report.curvature}</span></div>
							</div>
						{/if}
					</section>
				</div>
			{/if}
		</div>
	</div>
{/if}
