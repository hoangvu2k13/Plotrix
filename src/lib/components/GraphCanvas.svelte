<script lang="ts">
	import {
		Copy,
		LocateFixed,
		Maximize2,
		MessageSquarePlus,
		Minus,
		Plus,
		RotateCcw
	} from '@lucide/svelte';
	import { onMount } from 'svelte';

	import Icon from '$components/Icon.svelte';
	import { InteractionManager } from '$lib/input/interactions';
	import { CanvasRenderer, type CanvasMarker } from '$lib/renderer/canvas';
	import type { GraphState } from '$stores/graph.svelte';
	import type { UiState } from '$stores/ui.svelte';
	import { copyText } from '$utils/download';
	import { formatCoordinate } from '$utils/format';
	let { graph, ui } = $props<{ graph: GraphState; ui: UiState }>();

	let host: HTMLDivElement | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let renderer: CanvasRenderer | null = null;
	let ready = $state(false);
	let editingBounds = $state(false);
	let markerMenu = $state<{
		x: number;
		y: number;
		marker: CanvasMarker;
	} | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressOrigin: { x: number; y: number } | null = null;
	let rangeInputs = $state({
		xMin: '',
		xMax: '',
		yMin: '',
		yMax: ''
	});

	function visibleRange() {
		return {
			xMin: (0 - graph.view.originX) / graph.view.scaleX,
			xMax: (graph.viewport.width - graph.view.originX) / graph.view.scaleX,
			yMin: (graph.view.originY - graph.viewport.height) / graph.view.scaleY,
			yMax: graph.view.originY / graph.view.scaleY
		};
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

	function commitBounds(): void {
		const xMin = Number(rangeInputs.xMin);
		const xMax = Number(rangeInputs.xMax);
		const yMin = Number(rangeInputs.yMin);
		const yMax = Number(rangeInputs.yMax);

		if ([xMin, xMax, yMin, yMax].every((value) => Number.isFinite(value))) {
			ui.pingInteraction();
			graph.setViewBounds(xMin, xMax, yMin, yMax);
		}

		editingBounds = false;
	}

	function markerAtEvent(event: MouseEvent | PointerEvent): CanvasMarker | null {
		if (!host || !renderer) {
			return null;
		}

		const rect = host.getBoundingClientRect();
		return renderer.getMarkerAtCanvasPoint(event.clientX - rect.left, event.clientY - rect.top);
	}

	function openMarkerMenu(marker: CanvasMarker, x: number, y: number): void {
		const width = typeof window === 'undefined' ? x : window.innerWidth;
		const height = typeof window === 'undefined' ? y : window.innerHeight;
		const menuWidth = 220;
		const menuHeight = 156;

		markerMenu = {
			x: Math.max(12, Math.min(x, width - menuWidth)),
			y: Math.max(12, Math.min(y, height - menuHeight)),
			marker
		};
	}

	function clearLongPress(): void {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}

		longPressOrigin = null;
	}

	async function copyMarkerCoordinates(marker: CanvasMarker): Promise<void> {
		await copyText(`${formatCoordinate(marker.x)}, ${formatCoordinate(marker.y)}`);
		ui.pushToast({
			title: 'Coordinates copied',
			description: `Copied (${formatCoordinate(marker.x)}, ${formatCoordinate(marker.y)}).`,
			tone: 'success'
		});
		markerMenu = null;
	}

	function annotateMarker(marker: CanvasMarker): void {
		graph.addAnnotation(marker.x, marker.y, marker.label, marker.color);
		ui.pushToast({
			title: 'Annotation added',
			description: 'A pinned annotation was added to the graph.',
			tone: 'success'
		});
		markerMenu = null;
	}

	function handleCanvasContextMenu(event: MouseEvent): void {
		const marker = markerAtEvent(event);

		if (!marker) {
			markerMenu = null;
			return;
		}

		event.preventDefault();
		openMarkerMenu(marker, event.clientX, event.clientY);
	}

	function copyOpenMarkerCoordinates(): void {
		if (!markerMenu) {
			return;
		}

		void copyMarkerCoordinates(markerMenu.marker);
	}

	function panToOpenMarker(): void {
		if (!markerMenu) {
			return;
		}

		graph.panTo(markerMenu.marker.x, markerMenu.marker.y);
		markerMenu = null;
	}

	function annotateOpenMarker(): void {
		if (!markerMenu) {
			return;
		}

		annotateMarker(markerMenu.marker);
	}

	function handleCanvasPointerDown(event: PointerEvent): void {
		if (event.pointerType !== 'touch') {
			return;
		}

		const marker = markerAtEvent(event);

		if (!marker) {
			clearLongPress();
			return;
		}

		longPressOrigin = { x: event.clientX, y: event.clientY };
		longPressTimer = setTimeout(() => {
			openMarkerMenu(marker, event.clientX, event.clientY);
			clearLongPress();
		}, 420);
	}

	function handleCanvasPointerMove(event: PointerEvent): void {
		if (!longPressOrigin) {
			return;
		}

		if (Math.hypot(event.clientX - longPressOrigin.x, event.clientY - longPressOrigin.y) > 10) {
			clearLongPress();
		}
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
			clearLongPress();
			graph.attachExporter(null);
			ready = false;
		};
	});

	$effect(() => {
		void ui.tracePoint;
		void ui.highlightedAsymptotes;
		renderer?.render();
	});

	$effect(() => {
		void graph.view.originX;
		void graph.view.originY;
		void graph.view.scaleX;
		void graph.view.scaleY;
		void graph.viewport.width;
		void graph.viewport.height;

		if (editingBounds) {
			return;
		}

		const range = visibleRange();
		rangeInputs = {
			xMin: range.xMin.toFixed(2),
			xMax: range.xMax.toFixed(2),
			yMin: range.yMin.toFixed(2),
			yMax: range.yMax.toFixed(2)
		};
	});
</script>

<div class="canvas-shell" bind:this={host}>
	<canvas
		bind:this={canvas}
		class="canvas"
		tabindex="0"
		aria-label="Interactive Plotrix graph canvas"
		oncontextmenu={handleCanvasContextMenu}
		onpointerdown={handleCanvasPointerDown}
		onpointermove={handleCanvasPointerMove}
		onpointerup={clearLongPress}
		onpointercancel={clearLongPress}
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
			<Icon icon={RotateCcw} size="var(--icon-md)" class="zoom-glyph" />
			<span>Reset</span>
		</button>
	</div>

	<div class="range-pods" aria-label="Viewport range inputs">
		<div class="range-pair">
			<label>
				<span>x min</span>
				<input
					type="number"
					bind:value={rangeInputs.xMin}
					onfocus={() => (editingBounds = true)}
					onblur={commitBounds}
					onkeydown={(event) => event.key === 'Enter' && commitBounds()}
				/>
			</label>
			<label>
				<span>x max</span>
				<input
					type="number"
					bind:value={rangeInputs.xMax}
					onfocus={() => (editingBounds = true)}
					onblur={commitBounds}
					onkeydown={(event) => event.key === 'Enter' && commitBounds()}
				/>
			</label>
		</div>

		<div class="range-pair">
			<label>
				<span>y min</span>
				<input
					type="number"
					bind:value={rangeInputs.yMin}
					onfocus={() => (editingBounds = true)}
					onblur={commitBounds}
					onkeydown={(event) => event.key === 'Enter' && commitBounds()}
				/>
			</label>
			<label>
				<span>y max</span>
				<input
					type="number"
					bind:value={rangeInputs.yMax}
					onfocus={() => (editingBounds = true)}
					onblur={commitBounds}
					onkeydown={(event) => event.key === 'Enter' && commitBounds()}
				/>
			</label>
		</div>
	</div>

	{#if markerMenu}
		<button
			type="button"
			class="marker-menu-backdrop"
			aria-label="Close point actions"
			onclick={() => (markerMenu = null)}
		></button>
		<div
			class="marker-menu"
			role="menu"
			aria-label="Point actions"
			style={`left:${markerMenu.x}px;top:${markerMenu.y}px;`}
		>
			<button type="button" role="menuitem" onclick={copyOpenMarkerCoordinates}>
				<Icon icon={Copy} size="var(--icon-md)" class="menu-icon" />
				<span>Copy coordinates</span>
			</button>
			<button type="button" role="menuitem" onclick={panToOpenMarker}>
				<Icon icon={LocateFixed} size="var(--icon-md)" class="menu-icon" />
				<span>Pan here</span>
			</button>
			<button type="button" role="menuitem" onclick={annotateOpenMarker}>
				<Icon icon={MessageSquarePlus} size="var(--icon-md)" class="menu-icon" />
				<span>Add annotation</span>
			</button>
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
		padding: 60px 120px var(--space-8) var(--space-8);
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
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-surface) 80%, transparent);
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow-lg);
	}

	.zoom-pod button {
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

	@media (hover: hover) and (pointer: fine) {
		.zoom-pod button:hover {
			background: var(--color-bg-overlay);
			color: var(--color-text-primary);
		}

		.marker-menu button:hover {
			background: var(--color-bg-overlay);
		}
	}

	.zoom-pod button:active {
		transform: translateY(1px);
	}

	.range-pods {
		position: absolute;
		left: var(--space-4);
		bottom: var(--space-4);
		z-index: var(--z-overlay);
		display: grid;
		gap: var(--space-2);
		opacity: 0;
		transform: translateY(6px);
		transition:
			opacity var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-default);
	}

	.canvas-shell:hover .range-pods,
	.canvas-shell:focus-within .range-pods {
		opacity: 1;
		transform: translateY(0);
	}

	.range-pair {
		display: inline-flex;
		gap: var(--space-2);
	}

	.range-pair label {
		display: grid;
		gap: 2px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-surface);
		box-shadow: var(--shadow-sm);
	}

	.range-pair span {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.range-pair input {
		width: 92px;
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
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

	.marker-menu-backdrop {
		position: absolute;
		inset: 0;
		z-index: calc(var(--z-overlay) + 1);
		background: transparent;
	}

	.marker-menu {
		position: fixed;
		z-index: calc(var(--z-modal) + 1);
		display: grid;
		gap: var(--space-1);
		min-width: 172px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-surface);
		box-shadow: var(--shadow-lg);
		transform: translate(8px, 8px);
	}

	.marker-menu button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		text-align: left;
	}

	:global(.menu-icon) {
		display: block;
	}

	@media (max-width: 820px) {
		.zoom-pod {
			top: auto;
			right: var(--space-3);
			bottom: calc(var(--space-3) + 112px);
			flex-wrap: wrap;
			max-width: min(240px, calc(100vw - 24px));
			justify-content: flex-end;
		}

		.zoom-label span {
			display: none;
		}

		.range-pods {
			left: var(--space-3);
			right: var(--space-3);
			bottom: var(--space-3);
		}

		.range-pair {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.range-pair label {
			backdrop-filter: blur(10px);
		}

		.range-pair input {
			width: 100%;
		}
	}

	@keyframes graph-shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	@media (max-width: 640px) {
		.canvas-shell,
		.canvas {
			min-height: 280px;
		}

		.canvas-empty {
			padding: 48px var(--space-6) 144px;
		}
	}

	@media (hover: none) {
		.range-pods {
			opacity: 1;
			transform: none;
		}
	}
</style>
