<script lang="ts">
	import { onMount } from 'svelte';

	import { InteractionManager } from '$lib/input/interactions';
	import { CanvasRenderer } from '$lib/renderer/canvas';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let host: HTMLDivElement | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let renderer: CanvasRenderer | null = null;

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
		const rect = host.getBoundingClientRect();
		renderer.resize(rect.width, rect.height);

		const interactions = new InteractionManager(canvas, graph, ui, renderer);
		let resizeFrame = 0;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			if (resizeFrame) cancelAnimationFrame(resizeFrame);
			resizeFrame = requestAnimationFrame(() => {
				renderer?.resize(width, height);
			});
		});
		observer.observe(host);

		return () => {
			if (resizeFrame) cancelAnimationFrame(resizeFrame);
			observer.disconnect();
			interactions.destroy();
			renderer?.destroy();
			graph.attachExporter(null);
		};
	});

	$effect(() => {
		ui.tracePoint;
		ui.highlightedAsymptotes;
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
		border-radius: 16px;
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
