<script lang="ts">
	import { onMount } from 'svelte';

	import { InteractionManager } from '$lib/input/interactions';
	import { CanvasRenderer } from '$lib/renderer/canvas';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { formatCoordinate } from '$utils/format';

	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let host: HTMLDivElement | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let renderer: CanvasRenderer | null = null;

	const visibleRange = $derived.by(() => ({
		xMin: (0 - graph.view.originX) / graph.view.scaleX,
		xMax: (graph.viewport.width - graph.view.originX) / graph.view.scaleX,
		yMin: (graph.view.originY - graph.viewport.height) / graph.view.scaleY,
		yMax: graph.view.originY / graph.view.scaleY
	}));

	function syncCanvasSize(): void {
		if (!host || !renderer) {
			return;
		}

		renderer.resize(host.offsetWidth, host.offsetHeight);
	}

	function zoomIn(): void {
		ui.pingInteraction();
		graph.zoomTo(1.12);
	}

	function zoomOut(): void {
		ui.pingInteraction();
		graph.zoomTo(0.9);
	}

	function fitAll(): void {
		ui.pingInteraction();
		graph.fitAll();
	}

	function resetView(): void {
		ui.pingInteraction();
		graph.resetView();
	}

	onMount(() => {
		if (!host || !canvas) {
			return;
		}

		renderer = new CanvasRenderer(canvas, graph, ui);
		graph.attachExporter(renderer);
		syncCanvasSize();

		const interactions = new InteractionManager(canvas, graph, ui, renderer);
		const observer = new ResizeObserver(() => {
			syncCanvasSize();
		});
		observer.observe(host);

		return () => {
			observer.disconnect();
			interactions.destroy();
			renderer?.destroy();
			graph.attachExporter(null);
		};
	});

	$effect(() => {
		graph.renderVersion;
		renderer?.render();
	});

	$effect(() => {
		ui.tracePoint;
		renderer?.render();
	});
</script>

<div class="canvas-shell" bind:this={host}>
	<canvas
		bind:this={canvas}
		class="canvas"
		tabindex="0"
		aria-label="Interactive Plotrix graph canvas"
	></canvas>

	<div class:visible={ui.isPanningOrZooming} class="floating-panel range-panel" aria-hidden={!ui.isPanningOrZooming}>
		<strong>Visible range</strong>
		<p>x {formatCoordinate(visibleRange.xMin)} to {formatCoordinate(visibleRange.xMax)}</p>
		<p>y {formatCoordinate(visibleRange.yMin)} to {formatCoordinate(visibleRange.yMax)}</p>
	</div>

	<div class="zoom-pod" aria-label="Viewport controls">
		<button type="button" class="zoom-icon" aria-label="Zoom in" onclick={zoomIn}>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M10 4.5v11M4.5 10h11"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width="1.8"
				/>
			</svg>
		</button>
		<button type="button" class="zoom-icon" aria-label="Zoom out" onclick={zoomOut}>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M4.5 10h11"
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width="1.8"
				/>
			</svg>
		</button>
		<button type="button" class="zoom-label" onclick={fitAll}>Fit</button>
		<button type="button" class="zoom-label" onclick={resetView}>Reset</button>
	</div>

	{#if ui.tracePoint}
		<div class="floating-panel trace-panel">
			<strong>Trace</strong>
			<p>x {formatCoordinate(ui.tracePoint.x)}</p>
			<p>y {formatCoordinate(ui.tracePoint.y)}</p>
		</div>
	{/if}
</div>

<style>
	.canvas-shell {
		position: relative;
		min-height: 540px;
		height: 100%;
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-2xl) + 4px);
		background:
			radial-gradient(
				circle at top right,
				color-mix(in srgb, var(--color-accent) 16%, transparent),
				transparent 38%
			),
			var(--color-bg-surface);
		box-shadow: var(--shadow-xl);
		overflow: visible;
	}

	.canvas {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 540px;
		cursor: grab;
	}

	.canvas:active {
		cursor: grabbing;
	}

	.floating-panel {
		position: absolute;
		z-index: var(--z-overlay);
		display: grid;
		gap: 2px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-surface) 84%, transparent);
		backdrop-filter: blur(10px);
		box-shadow: var(--shadow-md);
	}

	.range-panel {
		top: var(--space-4);
		left: var(--space-4);
		opacity: 0;
		pointer-events: none;
		transform: translateY(6px);
		transition:
			opacity 200ms var(--ease-default),
			transform 200ms var(--ease-default);
	}

	.range-panel.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.trace-panel {
		left: var(--space-4);
		bottom: var(--space-4);
	}

	.zoom-pod {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		z-index: var(--z-overlay);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-surface) 80%, transparent);
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow-lg);
	}

	.zoom-pod button {
		display: inline-grid;
		place-items: center;
		height: 36px;
		min-width: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	.zoom-pod button:hover {
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
	}

	.zoom-pod button:active {
		transform: translateY(1px);
	}

	.zoom-icon svg {
		width: 18px;
		height: 18px;
	}

	.zoom-label {
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
	}
</style>
