<script lang="ts">
	import { onDestroy } from 'svelte';

	import ExpressionEditor from '$components/ExpressionEditor.svelte';
	import type { RegressionModel, RegressionResult } from '$lib/analysis/regression';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { getCachedKatex } from '$utils/katex-cache';
	import { renderKatex } from '$utils/katexRenderer';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let model = $state<RegressionModel>('linear');
	let degree = $state(2);
	let customExpression = $state('a * sin(b*x + c) + d');
	let currentResult = $state<RegressionResult | null>(null);
	let equationHtml = $state('');
	let equationRenderToken = 0;
	let pending = $state(false);
	let regressionWorker: Worker | null = null;

	function ensureRegressionWorker(): Worker | null {
		if (regressionWorker || typeof Worker === 'undefined') {
			return regressionWorker;
		}

		regressionWorker = new Worker(new URL('../workers/regression.worker.ts', import.meta.url), {
			type: 'module'
		});
		regressionWorker.onmessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: string;
				result?: RegressionResult & { coefficients?: Float64Array | number[] };
			};

			if (data?.type !== 'fit' || !data.result) {
				return;
			}

			const normalized: RegressionResult = {
				...data.result,
				coefficients: Array.from(data.result.coefficients ?? [])
			};

			currentResult = normalized;
			graph.upsertRegressionResult(normalized);
			pending = false;
		};

		return regressionWorker;
	}

	const dataset = $derived.by(() => {
		const active =
			graph.dataSeries.find(
				(series: GraphState['dataSeries'][number]) => series.id === ui.activeRegressionSeriesId
			) ??
			graph.dataSeries.find((series: GraphState['dataSeries'][number]) => series.plotted) ??
			graph.dataSeries[0];

		if (!active) return null;

		const rows = active.rows
			.map((row: string[]) => ({ x: Number(row[0]), y: Number(row[1]) }))
			.filter(
				(point: { x: number; y: number }) => Number.isFinite(point.x) && Number.isFinite(point.y)
			);

		return rows.length
			? {
					active,
					x: rows.map((row: { x: number; y: number }) => row.x),
					y: rows.map((row: { x: number; y: number }) => row.y)
				}
			: null;
	});

	const comparison = $derived(
		[...graph.regressionResults].sort((left, right) => right.metrics.r2 - left.metrics.r2)
	);

	$effect(() => {
		if (!currentResult) {
			equationHtml = '';
			return;
		}

		const cacheKey = `regression:${currentResult.model}:${currentResult.latex}`;
		const cached = getCachedKatex(cacheKey);
		const token = ++equationRenderToken;

		equationHtml = cached ?? currentResult.equation;

		void renderKatex(cacheKey, currentResult.latex, true, currentResult.equation).then((html) => {
			if (token === equationRenderToken) {
				equationHtml = html;
			}
		});
	});

	function fit(): void {
		const worker = ensureRegressionWorker();
		if (!dataset || !worker) return;
		pending = true;
		const x = new Float64Array(dataset.x);
		const y = new Float64Array(dataset.y);
		worker.postMessage(
			{
				type: 'fit',
				key: `${model}:${Date.now()}`,
				model,
				x,
				y,
				degree,
				expression: customExpression
			},
			[x.buffer, y.buffer]
		);
	}

	function addToGraph(): void {
		if (!currentResult) return;
		graph.addEquation(currentResult.equation.replace(/^y\s*=\s*/, ''), 'cartesian');
		ui.closeModal();
	}

	function badgeTone(r2: number): 'success' | 'warning' | 'danger' {
		if (r2 > 0.95) return 'success';
		if (r2 >= 0.8) return 'warning';
		return 'danger';
	}

	onDestroy(() => {
		regressionWorker?.terminate();
	});
</script>

<div class="panel">
	<div class="models" role="tablist" aria-label="Regression model">
		{#each [['linear', 'Linear'], ['polynomial', 'Poly'], ['exponential', 'Exp'], ['logarithmic', 'Log'], ['power', 'Power'], ['sinusoidal', 'Sine'], ['custom', 'Custom']] as [value, label] (value)}
			<button
				type="button"
				role="tab"
				class:active={model === value}
				onclick={() => (model = value as RegressionModel)}
			>
				{label}
			</button>
		{/each}
	</div>

	{#if model === 'polynomial'}
		<div class="stepper">
			<span>Degree</span>
			<button type="button" onclick={() => (degree = Math.max(1, degree - 1))}>-</button>
			<strong>{degree}</strong>
			<button type="button" onclick={() => (degree = Math.min(6, degree + 1))}>+</button>
		</div>
	{/if}

	{#if model === 'custom'}
		<ExpressionEditor value={customExpression} onChange={(value) => (customExpression = value)} />
	{/if}

	<button
		type="button"
		class="fit"
		title={!dataset
			? 'Plot or enter at least two numeric data points to enable regression.'
			: undefined}
		onclick={fit}
		disabled={!dataset || pending}
	>
		Fit
	</button>

	{#if !dataset}
		<p class="hint">Plot or enter at least two numeric data points to enable regression.</p>
	{/if}

	{#if currentResult}
		<section class="results">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="equation">{@html equationHtml}</div>
			<div class={`badge ${badgeTone(currentResult.metrics.r2)}`}>
				R² {currentResult.metrics.r2.toPrecision(4)}
			</div>
			<p>RMSE {currentResult.metrics.rmse.toPrecision(4)}</p>
			<p>MAE {currentResult.metrics.mae.toPrecision(4)}</p>
			<button type="button" class="fit" onclick={addToGraph}>Add to graph</button>
		</section>
	{/if}

	{#if comparison.length}
		<div class="history-header">
			<button type="button" class="clear-history" onclick={() => graph.clearRegressionResults()}>
				Clear history
			</button>
		</div>
		<table class="comparison">
			<thead>
				<tr>
					<th>Model</th>
					<th>R²</th>
				</tr>
			</thead>
			<tbody>
				{#each comparison as result (`${result.model}:${result.equation}`)}
					<tr>
						<td>{result.model}</td>
						<td>{result.metrics.r2.toPrecision(4)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.panel,
	.results {
		display: grid;
		gap: var(--space-4);
	}

	.hint {
		margin-top: calc(-1 * var(--space-2));
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}

	.models {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.history-header {
		display: flex;
		justify-content: flex-end;
	}

	.clear-history {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.models button,
	.fit,
	.stepper button {
		height: 32px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-overlay);
		cursor: pointer;
	}

	.models button.active,
	.fit {
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	.models button:hover,
	.stepper button:hover {
		border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 78%, var(--color-bg-surface));
		transform: translateY(-1px);
	}

	.fit:hover {
		box-shadow: var(--shadow-sm);
		transform: translateY(-1px);
	}

	.stepper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.equation {
		display: grid;
		place-items: center;
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
	}

	.badge {
		display: inline-flex;
		width: fit-content;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
	}

	.badge.success {
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
		color: var(--color-success);
	}

	.badge.warning {
		background: color-mix(in srgb, var(--color-warning) 14%, transparent);
		color: var(--color-warning);
	}

	.badge.danger {
		background: color-mix(in srgb, var(--color-danger) 14%, transparent);
		color: var(--color-danger);
	}

	.comparison {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: var(--space-2);
		border-bottom: 1px solid var(--color-border);
		text-align: left;
	}
</style>
