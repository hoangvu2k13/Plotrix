<script lang="ts">
	import { Home, Maximize2, Minus, Plus } from '@lucide/svelte';
	import { onMount } from 'svelte';

	import Icon from '$components/Icon.svelte';
	import { InteractionManager } from '$lib/input/interactions';
	import { CanvasRenderer } from '$lib/renderer/canvas';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let host: HTMLDivElement | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let renderer: CanvasRenderer | null = null;
	let ready = $state(false);

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
		requestAnimationFrame(() => {
			ready = true;
		});

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
			ready = false;
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

	{#if !ready}
		<div class="canvas-skeleton" aria-hidden="true">
			<div></div>
			<div></div>
			<div></div>
		</div>
	{:else if graph.equations.length === 0}
		<div class="canvas-empty">
			<strong>Start plotting</strong>
			<p>Add an equation from the sidebar or swipe in from the left edge on mobile.</p>
		</div>
	{/if}

	<div class="zoom-pod" aria-label="Viewport controls">
		<button type="button" class="zoom-icon" aria-label="Zoom in" onclick={zoomIn}>
			<Icon icon={Plus} size="var(--icon-lg)" class="zoom-glyph" />
		</button>
		<button type="button" class="zoom-icon" aria-label="Zoom out" onclick={zoomOut}>
			<Icon icon={Minus} size="var(--icon-lg)" class="zoom-glyph" />
		</button>
		<button type="button" class="zoom-label" onclick={fitAll}>
			<Icon icon={Maximize2} size="var(--icon-md)" class="zoom-glyph" />
			<span>Fit all</span>
		</button>
		<button type="button" class="zoom-label" onclick={resetView}>
			<Icon icon={Home} size="var(--icon-md)" class="zoom-glyph" />
			<span>Reset</span>
		</button>
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
		border-radius: calc(var(--radius-2xl) + 4px);
		cursor: grab;
	}

	.canvas-skeleton,
	.canvas-empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.canvas-skeleton {
		gap: var(--space-3);
		padding: var(--space-8);
		align-content: center;
	}

	.canvas-skeleton div {
		width: min(420px, 70%);
		height: 18px;
		border-radius: var(--radius-full);
		background: linear-gradient(
			90deg,
			var(--color-bg-overlay),
			color-mix(in srgb, var(--color-bg-overlay) 56%, var(--color-bg-surface)),
			var(--color-bg-overlay)
		);
		background-size: 200% 100%;
		animation: graph-shimmer 1.2s ease-in-out infinite;
	}

	.canvas-empty {
		gap: var(--space-2);
		padding: var(--space-8);
		text-align: center;
		color: var(--color-text-secondary);
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
		border-radius: var(--radius-full);
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

	.zoom-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
	}

	:global(.zoom-glyph) {
		display: block;
	}

	@keyframes graph-shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}
</style>
