<script lang="ts">
	import katex from 'katex';

	import { equationToLatex, type EquationAnalysis } from '$lib/analysis/equationAnalysis';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();
	const katexCache = sharedKatexCache;

	let loading = $state(false);
	let report = $state<EquationAnalysis | null>(null);
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
		graph.equations.find((entry: GraphState['equations'][number]) => entry.id === ui.activeAnalysisEquationId) ?? null
	);
	const equationHtml = $derived.by(() => {
		if (!equation) return '';
		const cacheKey = `${equation.kind}:${equation.raw}`;
		const cached = katexCache.get(cacheKey);
		if (cached) return cached;
		try {
			const html = katex.renderToString(equationToLatex(equation.compiled), { throwOnError: false, displayMode: true });
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
			return;
		}

		loading = true;
		report = graph.getEquationAnalysis(target.id);
		loading = report === null;
	});

	$effect(() => {
		if (!equation) return;
		const next = graph.getEquationAnalysis(equation.id);
		if (next) {
			report = next;
			loading = false;
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
	}
</script>

<script lang="ts" module>
	const sharedKatexCache = new Map<string, string>();
</script>

{#if equation}
	<button
		type="button"
		class="backdrop"
		style={`left:${ui.sidebarOpen ? `${graph.settings.equationPanelWidth + 20}px` : '20px'}`}
		aria-label="Close analysis panel"
		onclick={() => ui.setActiveAnalysisEquationId(null)}
	></button>
	<div class="drawer" role="dialog" aria-label="Analysis report">
		<header class="header">
			<div class="swatch" style={`--swatch:${equation.color}`}></div>
			<div class="title">
				<div class="katex">{@html equationHtml}</div>
				<p>Analysis Report</p>
			</div>
			<div class="header-actions">
				<button type="button" onclick={copyReport}>Copy report</button>
				<button type="button" aria-label="Close analysis panel" onclick={() => ui.setActiveAnalysisEquationId(null)}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M5.5 5.5 14.5 14.5M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" />
					</svg>
				</button>
			</div>
		</header>

		{#if loading || !report}
			<div class="loading">
				<div></div>
				<div></div>
				<div></div>
				<div></div>
			</div>
		{:else}
			<div class="sections">
				<section>
					<button type="button" class="accordion" onclick={() => (sections.domain = !sections.domain)}>Domain & Range</button>
					{#if sections.domain}
						<div class="rows mono">
							<div><strong>Domain</strong><span>{report.domain}</span></div>
							<div><strong>Range</strong><span>{report.range}</span></div>
						</div>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.zeros = !sections.zeros)}>Zeros</button>
					{#if sections.zeros}
						<div class="pills">
							{#if report.zeros.length}
								{#each report.zeros as zero}
									<button type="button" class="pill" onclick={() => graph.panTo(zero, 0)}>x = {zero.toPrecision(3)}</button>
								{/each}
							{:else}
								<p class="muted">No zeros in visible range</p>
							{/if}
						</div>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.symmetry = !sections.symmetry)}>Symmetry & Period</button>
					{#if sections.symmetry}
						<div class="rows">
							<div><strong>Symmetry</strong><span>{report.isEven ? 'Even' : report.isOdd ? 'Odd' : 'None'}</span></div>
							<div><strong>Period</strong><span>{report.period ? `T = ${report.period.toPrecision(3)}` : 'None detected'}</span></div>
						</div>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.asymptotes = !sections.asymptotes)}>Asymptotes</button>
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
							{report.horizontalAsymptotes.left !== null || report.horizontalAsymptotes.right !== null
								? `y → ${report.horizontalAsymptotes.left?.toPrecision(3) ?? 'none'} as x → -∞ · y → ${report.horizontalAsymptotes.right?.toPrecision(3) ?? 'none'} as x → +∞`
								: 'None'}
						</p>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.critical = !sections.critical)}>Critical Points</button>
					{#if sections.critical}
						<table class="table">
							<thead>
								<tr><th>Kind</th><th>x</th><th>y</th></tr>
							</thead>
							<tbody>
								{#each report.criticalPoints as point}
									<tr>
										<td><button type="button" class="table-button" onclick={() => graph.panTo(point.x, point.y)}>{point.kind}</button></td>
										<td>{point.x.toPrecision(3)}</td>
										<td>{point.y.toPrecision(3)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.derivative = !sections.derivative)}>Derivative</button>
					{#if sections.derivative}
						<p class="mono">{report.derivative}</p>
						<button type="button" class="pill" onclick={() => graph.addEquation((report?.derivative ?? 'numerical') === 'numerical' ? `((${equation.raw.replaceAll('x', '(x+0.0001)')}) - (${equation.raw.replaceAll('x', '(x-0.0001)')}))/0.0002` : (report?.derivative ?? equation.raw), 'cartesian')}>Plot f'(x)</button>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.integral = !sections.integral)}>Integral</button>
					{#if sections.integral}
						<p class="mono">{report.integral}</p>
						<button type="button" class="pill" onclick={() => graph.addEquation((report?.integral ?? equation.raw).replace(/\s*\+\s*C$/, ''), 'cartesian')}>Plot ∫f(x)dx</button>
					{/if}
				</section>

				<section>
					<button type="button" class="accordion" onclick={() => (sections.behavior = !sections.behavior)}>Behavior Summary</button>
					{#if sections.behavior}
						<div class="rows">
							<div><strong>Monotone</strong><span>{report.isMonotone ? 'Yes' : 'Partial'}</span></div>
							<div><strong>Continuous</strong><span>{report.isContinuous ? 'Yes' : 'No'}</span></div>
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
	}

	.drawer {
		position: fixed;
		top: 48px;
		right: 0;
		bottom: 0;
		width: 320px;
		padding: var(--space-4);
		border-left: 1px solid var(--color-border);
		background: var(--color-bg-surface);
		box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
		z-index: 50;
		overflow: auto;
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
		display: inline-grid;
		place-items: center;
	}

	.header-actions button svg {
		width: 14px;
		height: 14px;
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
		background: linear-gradient(90deg, var(--color-bg-overlay), color-mix(in srgb, var(--color-bg-overlay) 50%, var(--color-bg-surface)), var(--color-bg-overlay));
		background-size: 200% 100%;
		animation: shimmer 1.1s linear infinite;
	}

	.muted {
		color: var(--color-text-muted);
	}

	@keyframes shimmer {
		from { background-position: 200% 0; }
		to { background-position: -200% 0; }
	}
</style>
