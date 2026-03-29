<script lang="ts">
	import { ChevronDown, ClipboardCopy, X } from '@lucide/svelte';
	import { fade } from 'svelte/transition';

	import Icon from '$components/Icon.svelte';
	import { equationToLatex, type EquationAnalysis } from '$lib/analysis/equationAnalysis';
	import { evaluateCartesianAt } from '$lib/math/engine';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { getCachedKatex } from '$utils/katex-cache';
	import { renderKatex } from '$utils/katexRenderer';
	import { clamp, formatCoordinate } from '$utils/format';

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
	let sections = $state({
		domain: true,
		zeros: true,
		values: false,
		symmetry: true,
		asymptotes: true,
		critical: true,
		derivative: true,
		integral: true,
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

		loading = true;
		errorMessage = null;
		report = graph.getEquationAnalysis(target.id);
		loading = report === null && !graph.hasEquationAnalysisFailure(target.id);
		if (!loading && report === null) {
			errorMessage =
				'Analysis is available only for Cartesian equations with finite sampled values.';
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
		if (!equation) return;
		const next = graph.getEquationAnalysis(equation.id);
		if (next) {
			report = next;
			loading = false;
			errorMessage = null;
		} else if (graph.hasEquationAnalysisFailure(equation.id)) {
			loading = false;
			errorMessage = 'Plotrix could not build an analysis report for this equation.';
		}
	});

	$effect(() => {
		if (!equation) {
			equationHtml = '';
			return;
		}

		const latex = equationToLatex(equation.compiled);
		const cacheKey = `${equation.kind}:${equation.raw}:display`;
		const cached = getCachedKatex(cacheKey);
		const token = ++equationRenderToken;

		equationHtml = cached ?? equation.raw;

		void renderKatex(cacheKey, latex, true, equation.raw).then((html) => {
			if (token === equationRenderToken) {
				equationHtml = html;
			}
		});
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

	async function copyReport(): Promise<void> {
		if (!equation || !report) return;
		const text = [
			`Analysis Report: ${equation.raw}`,
			`Domain: ${report.domain}`,
			`Range: ${report.range}`,
			`Zeros: ${report.zeros.map((value) => value.toPrecision(3)).join(', ') || 'None'}`,
			`Period: ${report.period ? report.period.toPrecision(3) : 'None'}`,
			`Derivative: ${report.derivative}`,
			`Integral: ${report.integral}`,
			`Curvature: ${report.curvature}`
		].join('\n');
		await navigator.clipboard.writeText(text);
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

		{#if loading}
			<div class="loading">
				<div></div>
				<div></div>
				<div></div>
				<div></div>
			</div>
		{:else if errorMessage || !report}
			<p class="muted">{errorMessage ?? 'Analysis is unavailable for this equation.'}</p>
		{:else}
			<div class="sections">
				{#if report.partial}
					<p class="partial-note">Showing critical points first while the full report finishes.</p>
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
							class={!sections.domain ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
							class={!sections.zeros ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
						/>
					</button>
					{#if sections.zeros}
						<div class="pills">
							{#if visibleZeros.length}
								{#each visibleZeros as zero (`${zero}`)}
									<button type="button" class="pill" onclick={() => focusPoint(zero, 0)}
										>x = {zero.toPrecision(3)}</button
									>
								{/each}
								{#if report.zeros.length > MAX_PILLS_VISIBLE}
									<button type="button" class="pill" onclick={() => (showAllZeros = !showAllZeros)}>
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
							class={!sections.values ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
							class={!sections.symmetry ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
									>{report.period ? `T = ${report.period.toPrecision(3)}` : 'None detected'}</span
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
							class={!sections.asymptotes ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
										x = {value.toPrecision(4)}
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
								? `y → ${report.horizontalAsymptotes.left?.toPrecision(3) ?? 'none'} as x → -∞ · y → ${report.horizontalAsymptotes.right?.toPrecision(3) ?? 'none'} as x → +∞`
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
							class={!sections.critical ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
											<td>{point.x.toPrecision(3)}</td>
											<td>{point.y.toPrecision(3)}</td>
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
							class={!sections.derivative ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
							class={!sections.integral ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
						/>
					</button>
					{#if sections.integral}
						<p class="mono">{report.integral}</p>
						{#if report.integralExpression}
							<button
								type="button"
								class="pill"
								onclick={() =>
									addAnalysisEquation(report?.integralExpression ?? equation.raw, 'Antiderivative')}
								>Add antiderivative to graph</button
							>
						{/if}
					{/if}
				</section>

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
							class={!sections.behavior ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
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
{/if}
