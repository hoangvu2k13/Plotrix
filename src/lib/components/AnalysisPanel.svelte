<script lang="ts" module>
	import { LruMap } from '$lib/utils/lru';

	const sharedKatexCache = new LruMap<string, string>(200);
</script>

<script lang="ts">
	import { ChevronDown, ClipboardCopy, X } from '@lucide/svelte';
	import katex from 'katex';

	import Icon from '$components/Icon.svelte';
	import { equationToLatex, type EquationAnalysis } from '$lib/analysis/equationAnalysis';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();
	const katexCache = sharedKatexCache;

	let loading = $state(false);
	let report = $state<EquationAnalysis | null>(null);
	let errorMessage = $state<string | null>(null);
	let swipeStart: { x: number; y: number } | null = $state(null);
	let sections = $state({
		domain: true,
		zeros: true,
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
	const equationHtml = $derived.by(() => {
		if (!equation) return '';
		const cacheKey = `${equation.kind}:${equation.raw}`;
		const cached = katexCache.get(cacheKey);
		if (cached) return cached;
		try {
			const html = katex.renderToString(equationToLatex(equation.compiled), {
				throwOnError: false,
				displayMode: true
			});
			katexCache.set(cacheKey, html);
			return html;
		} catch {
			return equation.raw;
		}
	});

	$effect(() => {
		ui.activeAnalysisEquationId;
		const target = equation;
		if (!target) {
			report = null;
			loading = false;
			errorMessage = null;
			return;
		}

		loading = true;
		errorMessage = null;
		report = graph.getEquationAnalysis(target.id);
		loading = report === null && !graph.hasEquationAnalysisFailure(target.id);
		if (!loading && report === null) {
			errorMessage =
				'Analysis is available only for Cartesian equations with finite sampled values.';
		}
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
</script>

{#if equation}
	<button
		type="button"
		class="backdrop"
		style={`left:${ui.sidebarOpen ? `${graph.settings.equationPanelWidth + 20}px` : '20px'}`}
		aria-label="Close analysis panel"
		onclick={() => ui.setActiveAnalysisEquationId(null)}
	></button>
	<div
		class="drawer"
		role="dialog"
		tabindex="-1"
		aria-label="Analysis report"
		onpointerdown={handleDrawerPointerDown}
		onpointerup={handleDrawerPointerUp}
	>
		<header class="header">
			<div class="swatch" style={`--swatch:${equation.color}`}></div>
			<div class="title">
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

		<p class="close-hint">Press `Esc`, tap the backdrop, or swipe right to close.</p>

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
							class={`accordion-icon ${!sections.domain ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.domain}
						<div class="rows mono">
							<div><strong>Domain</strong><span>{report.domain}</span></div>
							<div><strong>Range</strong><span>{report.range}</span></div>
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
							class={`accordion-icon ${!sections.zeros ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.zeros}
						<div class="pills">
							{#if report.zeros.length}
								{#each report.zeros as zero}
									<button type="button" class="pill" onclick={() => graph.panTo(zero, 0)}
										>x = {zero.toPrecision(3)}</button
									>
								{/each}
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
						onclick={() => (sections.symmetry = !sections.symmetry)}
					>
						<span>Symmetry & Period</span>
						<Icon
							icon={ChevronDown}
							size="var(--icon-md)"
							class={`accordion-icon ${!sections.symmetry ? 'collapsed' : ''}`}
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
							class={`accordion-icon ${!sections.asymptotes ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.asymptotes}
						<div class="pills">
							{#if report.verticalAsymptotes.length}
								{#each report.verticalAsymptotes as value}
									<button
										type="button"
										class="pill"
										onmouseenter={() => ui.setHighlightedAsymptotes([value])}
										onmouseleave={() => ui.setHighlightedAsymptotes([])}
									>
										x = {value.toPrecision(4)}
									</button>
								{/each}
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
							class={`accordion-icon ${!sections.critical ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.critical}
						<table class="table">
							<thead>
								<tr><th>Kind</th><th>x</th><th>y</th></tr>
							</thead>
							<tbody>
								{#each report.criticalPoints as point}
									<tr>
										<td
											><button
												type="button"
												class="table-button"
												onclick={() => graph.panTo(point.x, point.y)}>{point.kind}</button
											></td
										>
										<td>{point.x.toPrecision(3)}</td>
										<td>{point.y.toPrecision(3)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
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
							class={`accordion-icon ${!sections.derivative ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.derivative}
						<p class="mono">{report.derivative}</p>
						{#if report.derivativeExpression}
							<button
								type="button"
								class="pill"
								onclick={() =>
									graph.addEquation(report?.derivativeExpression ?? equation.raw, 'cartesian')}
								>Plot f'(x)</button
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
							class={`accordion-icon ${!sections.integral ? 'collapsed' : ''}`}
						/>
					</button>
					{#if sections.integral}
						<p class="mono">{report.integral}</p>
						{#if report.integralExpression}
							<button
								type="button"
								class="pill"
								onclick={() =>
									graph.addEquation(report?.integralExpression ?? equation.raw, 'cartesian')}
								>Plot ∫f(x)dx</button
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
							class={`accordion-icon ${!sections.behavior ? 'collapsed' : ''}`}
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
		width: min(420px, calc(100vw - 24px));
		min-width: 300px;
		padding: var(--space-4);
		border-left: 1px solid var(--color-border);
		background: var(--color-bg-surface);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
		z-index: 50;
		overflow: auto;
		-webkit-overflow-scrolling: touch;
		touch-action: pan-y;
		transform: translateX(0);
		transition: transform 280ms ease-in-out;
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
	.pill {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		cursor: pointer;
	}

	.header-actions button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	:global(.header-icon) {
		display: block;
	}

	.close-hint {
		margin: var(--space-3) 0;
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
	}

	.header-actions button:hover,
	.accordion:hover,
	.pill:hover,
	.table-button:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 76%, var(--color-bg-surface));
	}

	.katex {
		font-size: 24px;
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
	}

	:global(.accordion-icon) {
		transition: transform var(--duration-fast) var(--ease-default);
	}

	:global(.accordion-icon.collapsed) {
		transform: rotate(-90deg);
	}

	.rows div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
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
		}
	}
</style>
