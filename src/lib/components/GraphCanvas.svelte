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
