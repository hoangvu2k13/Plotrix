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
		class="backdrop"
		style={`left:${ui.sidebarOpen ? `${graph.settings.equationPanelWidth + 20}px` : '20px'}`}
		aria-label="Close analysis panel"
		onclick={() => ui.setActiveAnalysisEquationId(null)}
		transition:fade
	></button>
	<div
		class="drawer"
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

<style>
	.backdrop {
		position: fixed;
		top: 48px;
		right: 0;
		bottom: 0;
		background: rgba(9, 9, 11, 0.28);
		z-index: 49;
		transition: opacity 280ms ease-in-out;
	}

	.drawer {
		position: fixed;
		top: 48px;
		right: 0;
		bottom: 0;
		width: min(var(--drawer-width), calc(100vw - 24px));
		min-width: 300px;
		padding: var(--space-4);
		border-left: 1px solid var(--color-border);
		background: var(--color-bg-surface);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
		z-index: 50;
		overflow: auto;
		scrollbar-gutter: stable;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
		transform: translateX(0);
		transition: transform 280ms ease-in-out;
	}

	.resize-handle {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 10px;
	}

	.resize-handle button {
		width: 100%;
		height: 100%;
		cursor: col-resize;
	}

	.header,
	.title,
	.sections,
	.rows,
	.loading {
		display: grid;
		gap: var(--space-3);
	}

	.header {
		grid-template-columns: 10px minmax(0, 1fr) auto;
		align-items: start;
		position: sticky;
		top: calc(-1 * var(--space-4));
		padding-bottom: var(--space-3);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-bg-surface) 98%, transparent),
			color-mix(in srgb, var(--color-bg-surface) 94%, transparent)
		);
		backdrop-filter: blur(10px);
		z-index: 1;
	}

	.swatch {
		border-radius: var(--radius-full);
		background: var(--swatch);
	}

	.header-actions {
		display: flex;
		gap: var(--space-2);
	}

	.header-actions button,
	.accordion,
	.pill,
	.inline-toggle,
	.table-button {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	.header-actions button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	:global(.header-icon) {
		display: block;
	}

	.header-actions button:hover,
	.accordion:hover,
	.pill:hover,
	.inline-toggle:hover,
	.table-button:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 76%, var(--color-bg-surface));
		color: var(--color-text-primary);
		transform: translateY(-1px);
	}

	.katex {
		font-size: 24px;
	}

	.title p {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.sections section {
		padding-bottom: var(--space-3);
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.accordion {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	:global(.accordion-icon) {
		transition: transform var(--duration-fast) var(--ease-default);
	}

	.rows div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-2) 0;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
	}

	.rows div:last-child {
		border-bottom: none;
	}

	.rows strong {
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.rows span {
		max-width: 62%;
		color: var(--color-text-primary);
		text-align: right;
	}

	.rows-domain span {
		max-width: 68%;
		line-height: var(--line-height-relaxed);
	}

	.mono {
		font-family: var(--font-mono);
		word-break: break-word;
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.pill {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-overlay));
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		background: var(--color-bg-overlay);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	th,
	td {
		padding: var(--space-2);
		border: 1px solid var(--color-border);
	}

	tr {
		cursor: pointer;
	}

	.table-button {
		width: 100%;
		text-align: left;
	}

	.inline-toggle {
		justify-self: start;
		width: fit-content;
		color: var(--color-accent);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.loading div {
		height: 42px;
		border-radius: var(--radius-md);
		background: linear-gradient(
			90deg,
			var(--color-bg-overlay),
			color-mix(in srgb, var(--color-bg-overlay) 50%, var(--color-bg-surface)),
			var(--color-bg-overlay)
		);
		background-size: 200% 100%;
		animation: shimmer 1.2s ease-in-out infinite;
	}

	.loading div:nth-child(2) {
		animation-delay: 80ms;
	}

	.loading div:nth-child(3) {
		animation-delay: 140ms;
	}

	.loading div:nth-child(4) {
		animation-delay: 220ms;
	}

	.muted {
		color: var(--color-text-muted);
	}

	.partial-note {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.values-controls {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
	}

	.values-controls label {
		display: grid;
		gap: 4px;
	}

	.values-controls span {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.values-controls input {
		height: 32px;
		padding: 0 var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
		font-family: var(--font-mono);
	}

	.values-table-wrap {
		max-height: 220px;
		overflow: auto;
		border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
		border-radius: var(--radius-md);
	}

	@media (hover: hover) and (pointer: fine) {
		.resize-handle button:hover {
			background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		}
	}

	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	@media (max-width: 700px) {
		.backdrop {
			left: 0 !important;
		}

		.drawer {
			width: 100vw;
			min-width: 0;
			padding-inline: var(--space-3);
		}

		.resize-handle {
			display: none;
		}

		.header {
			grid-template-columns: 10px minmax(0, 1fr);
		}

		.header-actions {
			grid-column: 1 / -1;
			justify-content: space-between;
		}

		.rows div {
			flex-direction: column;
			align-items: stretch;
		}

		.rows span {
			max-width: 100%;
			text-align: left;
		}

		.values-controls {
			grid-template-columns: 1fr;
		}
	}
</style>
