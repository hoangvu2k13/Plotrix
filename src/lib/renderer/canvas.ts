import {
	evaluateCartesianAt,
	evaluateImplicitAt,
	evaluateInequalityBoundaryAt,
	evaluatePolarAt,
	sampleEquation,
	type EquationKind
} from '$lib/math/engine';
import type { CriticalPoint } from '$lib/analysis/criticalPoints';
import type { IntersectionPoint } from '$lib/analysis/intersections';
import type { DataSeries, GraphState, PlotEquation } from '$stores/graph.svelte';
import type { UiState } from '$stores/ui.svelte';
import { clamp, formatCoordinate, formatSig } from '$utils/format';

interface SurfaceContext {
	ctx: CanvasRenderingContext2D;
	width: number;
	height: number;
	dpr: number;
}

interface ThemeTokens {
	canvas: string;
	gridMinor: string;
	gridMajor: string;
	axis: string;
	text: string;
	muted: string;
	accent: string;
	surface: string;
	border: string;
	fontSans: string;
}

type CacheLayer = HTMLCanvasElement | OffscreenCanvas;
type CanvasPoint = [number, number];

interface ScalarField {
	values: Float64Array;
	cols: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
}

const ISO_EPSILON = 1e-9;
const CACHE_MEMORY_LIMIT = 96 * 1024 * 1024;

class MemoryBoundCanvasCache {
	private entries = new Map<string, { layer: CacheLayer; bytes: number }>();
	private totalBytes = 0;

	get(key: string): CacheLayer | undefined {
		const entry = this.entries.get(key);

		if (!entry) {
			return undefined;
		}

		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.layer;
	}

	set(key: string, layer: CacheLayer): CacheLayer[] {
		const bytes = layer.width * layer.height * 4;
		const existing = this.entries.get(key);
		const evicted: CacheLayer[] = [];

		if (existing) {
			this.totalBytes -= existing.bytes;
			this.entries.delete(key);
			evicted.push(existing.layer);
		}

		this.entries.set(key, { layer, bytes });
		this.totalBytes += bytes;

		while (this.totalBytes > CACHE_MEMORY_LIMIT && this.entries.size > 1) {
			const oldest = this.entries.keys().next().value;

			if (!oldest) {
				break;
			}

			const entry = this.entries.get(oldest);

			if (entry) {
				this.totalBytes -= entry.bytes;
				evicted.push(entry.layer);
			}

			this.entries.delete(oldest);
		}

		return evicted;
	}

	clear(): void {
		this.entries.clear();
		this.totalBytes = 0;
	}
}

function formatAxisLabel(v: number, step: number): string {
	if (Math.abs(v) < 1e-10) return '0';
	if (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0)) {
		return v.toExponential(1);
	}
	if (Math.abs(v) >= 1e4) {
		return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
	}
	const decimals = Math.max(0, -Math.floor(Math.log10(step)));
	return v.toFixed(Math.min(decimals, 4));
}

function niceStep(units: number): number {
	const exponent = Math.floor(Math.log10(units));
	const fraction = units / 10 ** exponent;

	if (fraction <= 1) return 10 ** exponent;
	if (fraction <= 2) return 2 * 10 ** exponent;
	if (fraction <= 5) return 5 * 10 ** exponent;
	return 10 * 10 ** exponent;
}

function dashPattern(style: PlotEquation['lineStyle']): number[] {
	if (style === 'dashed') return [8, 4];
	if (style === 'dotted') return [2, 4];
	return [];
}

function clipLineToRect(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	left: number,
	top: number,
	right: number,
	bottom: number
): [number, number, number, number] | null {
	const INSIDE = 0;
	const LEFT = 1;
	const RIGHT = 2;
	const BOTTOM = 4;
	const TOP = 8;

	const outCode = (x: number, y: number): number => {
		let code = INSIDE;
		if (x < left) code |= LEFT;
		else if (x > right) code |= RIGHT;
		if (y < top) code |= TOP;
		else if (y > bottom) code |= BOTTOM;
		return code;
	};

	let startX = x0;
	let startY = y0;
	let endX = x1;
	let endY = y1;
	let startCode = outCode(startX, startY);
	let endCode = outCode(endX, endY);

	while (true) {
		if (!(startCode | endCode)) {
			return [startX, startY, endX, endY];
		}

		if (startCode & endCode) {
			return null;
		}

		const code = startCode || endCode;
		let x = 0;
		let y = 0;

		if (code & TOP) {
			x = startX + ((endX - startX) * (top - startY)) / (endY - startY || 1e-6);
			y = top;
		} else if (code & BOTTOM) {
			x = startX + ((endX - startX) * (bottom - startY)) / (endY - startY || 1e-6);
			y = bottom;
		} else if (code & RIGHT) {
			y = startY + ((endY - startY) * (right - startX)) / (endX - startX || 1e-6);
			x = right;
		} else if (code & LEFT) {
			y = startY + ((endY - startY) * (left - startX)) / (endX - startX || 1e-6);
			x = left;
		}

		if (code === startCode) {
			startX = x;
			startY = y;
			startCode = outCode(startX, startY);
		} else {
			endX = x;
			endY = y;
			endCode = outCode(endX, endY);
		}
	}
}

function hexToRgb(hex: string): [number, number, number] {
	const normalized = hex.replace('#', '');
	const value =
		normalized.length === 3
			? normalized
					.split('')
					.map((part) => part + part)
					.join('')
			: normalized;
	const int = parseInt(value, 16);
	return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function blendLinearRgb(left: string, right: string): string {
	const [lr, lg, lb] = hexToRgb(left);
	const [rr, rg, rb] = hexToRgb(right);
	const linear = [lr, lg, lb].map((value) => (value / 255) ** 2.2);
	const linearRight = [rr, rg, rb].map((value) => (value / 255) ** 2.2);
	const result = linear.map((value, index) =>
		Math.round(((value + linearRight[index]!) / 2) ** (1 / 2.2) * 255)
	);
	return `rgb(${result[0]}, ${result[1]}, ${result[2]})`;
}

function isFiniteScalar(value: number): boolean {
	return Number.isFinite(value);
}

function scalarCrossesZero(a: number, b: number): boolean {
	if (!isFiniteScalar(a) || !isFiniteScalar(b)) return false;
	if (Math.abs(a) < ISO_EPSILON && Math.abs(b) < ISO_EPSILON) return false;
	return (a <= 0 && b >= 0) || (a >= 0 && b <= 0);
}

function interpolateZeroPoint(
	start: CanvasPoint,
	end: CanvasPoint,
	startValue: number,
	endValue: number
): CanvasPoint {
	if (!isFiniteScalar(startValue) || !isFiniteScalar(endValue)) {
		return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
	}

	if (Math.abs(startValue) < ISO_EPSILON) return start;
	if (Math.abs(endValue) < ISO_EPSILON) return end;

	const delta = startValue - endValue;
	const t = Math.abs(delta) < ISO_EPSILON ? 0.5 : clamp(startValue / delta, 0, 1);
	return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

function dedupePoints(points: CanvasPoint[], tolerance = 0.35): CanvasPoint[] {
	const unique: CanvasPoint[] = [];

	for (const point of points) {
		if (
			unique.some(
				(existing) =>
					Math.abs(existing[0] - point[0]) <= tolerance &&
					Math.abs(existing[1] - point[1]) <= tolerance
			)
		) {
			continue;
		}
		unique.push(point);
	}

	return unique;
}

export class CanvasRenderer {
	ctx: CanvasRenderingContext2D;
	dpr = 1;
	animFrame = 0;
	renderQueue = false;

	private pointer: { x: number; y: number } | null = null;
	private surface: SurfaceContext;
	private tokenCache: ThemeTokens | null = null;
	private tokenSignature = '';
	private themeObserver: MutationObserver | null = null;
	private scatterCache = new MemoryBoundCanvasCache();
	private shadingCache = new MemoryBoundCanvasCache();
	private inequalitySystemCache = new MemoryBoundCanvasCache();
	private polarCache = new MemoryBoundCanvasCache();
	private curveBudgetCache = new Map<string, { baseSamples: number; maxSamples: number }>();
	private cacheLayerPool = new Map<string, CacheLayer[]>();

	private setCanvasCacheEntry(cache: MemoryBoundCanvasCache, key: string, layer: CacheLayer): void {
		const evicted = cache.set(key, layer);

		for (const entry of evicted) {
			if (entry !== layer) {
				this.releaseCacheLayer(entry);
			}
		}
	}

	private poolKey(width: number, height: number): string {
		return `${width}x${height}`;
	}

	private releaseCacheLayer(layer: CacheLayer): void {
		const key = this.poolKey(layer.width, layer.height);
		const bucket = this.cacheLayerPool.get(key) ?? [];

		if (bucket.length >= 4) {
			return;
		}

		bucket.push(layer);
		this.cacheLayerPool.set(key, bucket);
	}

	private get2dContext(
		layer: CacheLayer
	): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
		const ctx = layer.getContext('2d');

		if (
			ctx &&
			'setTransform' in ctx &&
			'clearRect' in ctx &&
			'drawImage' in ctx &&
			'beginPath' in ctx
		) {
			return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
		}

		return null;
	}

	private createCacheLayer(
		width: number,
		height: number,
		dpr: number
	): {
		layer: CacheLayer;
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	} {
		const pixelWidth = Math.floor(width * dpr);
		const pixelHeight = Math.floor(height * dpr);
		const pooled = this.cacheLayerPool.get(this.poolKey(pixelWidth, pixelHeight))?.pop();

		if (pooled) {
			const ctx = this.get2dContext(pooled);
			if (ctx) {
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				ctx.clearRect(0, 0, width, height);
			}

			return { layer: pooled, ctx };
		}

		if (typeof OffscreenCanvas !== 'undefined') {
			const layer = new OffscreenCanvas(pixelWidth, pixelHeight);
			const ctx = this.get2dContext(layer);
			if (ctx) {
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			}
			return { layer, ctx };
		}

		const layer = document.createElement('canvas');
		layer.width = pixelWidth;
		layer.height = pixelHeight;
		const ctx = this.get2dContext(layer);
		if (ctx) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		return { layer, ctx };
	}

	constructor(
		private canvas: HTMLCanvasElement,
		private state: GraphState,
		private ui?: UiState
	) {
		const ctx = canvas.getContext('2d');

		if (!ctx) {
			throw new Error('Plotrix could not create a 2D canvas context.');
		}

		this.ctx = ctx;
		this.surface = { ctx, width: 0, height: 0, dpr: 1 };
		this.observeThemeChanges();
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) return;
		this.dpr =
			this.state.settings.highDPI && typeof window !== 'undefined'
				? window.devicePixelRatio || 1
				: 1;
		this.canvas.width = Math.floor(width * this.dpr);
		this.canvas.height = Math.floor(height * this.dpr);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		this.surface = { ctx: this.ctx, width, height, dpr: this.dpr };
		this.refreshTokenCache();
		this.scatterCache.clear();
		this.shadingCache.clear();
		this.inequalitySystemCache.clear();
		this.polarCache.clear();
		this.curveBudgetCache.clear();
		this.state.setViewportSize(width, height);
		this.render(true);
	}

	requestRender(): void {
		this.render();
	}

	destroy(): void {
		if (this.animFrame) cancelAnimationFrame(this.animFrame);
		this.themeObserver?.disconnect();
		this.cacheLayerPool.clear();
	}

	setPointerPosition(point: { x: number; y: number } | null): void {
		this.pointer = point;
		this.render();
	}

	mathToCanvas(mx: number, my: number): [number, number] {
		return [
			this.state.view.originX + mx * this.state.view.scaleX,
			this.state.view.originY - my * this.state.view.scaleY
		];
	}

	canvasToMath(cx: number, cy: number): [number, number] {
		return [
			(cx - this.state.view.originX) / this.state.view.scaleX,
			(this.state.view.originY - cy) / this.state.view.scaleY
		];
	}

	visibleMathRange() {
		return {
			xMin: (0 - this.state.view.originX) / this.state.view.scaleX,
			xMax: (this.surface.width - this.state.view.originX) / this.state.view.scaleX,
			yMin: (this.state.view.originY - this.surface.height) / this.state.view.scaleY,
			yMax: this.state.view.originY / this.state.view.scaleY
		};
	}

	private expandedMathRange(pixelPadding = 24) {
		const range = this.visibleMathRange();
		const padX = pixelPadding / Math.max(this.state.view.scaleX, 1e-6);
		const padY = pixelPadding / Math.max(this.state.view.scaleY, 1e-6);

		return {
			xMin: range.xMin - padX,
			xMax: range.xMax + padX,
			yMin: range.yMin - padY,
			yMax: range.yMax + padY
		};
	}

	render(immediate = false): void {
		if (!this.surface.width || !this.surface.height) return;

		if (immediate) {
			if (this.animFrame) cancelAnimationFrame(this.animFrame);
			this.renderQueue = false;
			this.paint(this.surface);
			return;
		}

		if (this.renderQueue) return;
		this.renderQueue = true;
		this.animFrame = requestAnimationFrame(() => {
			this.renderQueue = false;
			this.paint(this.surface);
		});
	}

	async toPNGBlob(scale: 1 | 2 | 3): Promise<Blob | null> {
		if (!this.surface.width || !this.surface.height) return null;
		const exportCanvas = document.createElement('canvas');
		const exportRatio = (this.state.settings.highDPI ? window.devicePixelRatio || 1 : 1) * scale;
		exportCanvas.width = Math.floor(this.surface.width * exportRatio);
		exportCanvas.height = Math.floor(this.surface.height * exportRatio);
		const ctx = exportCanvas.getContext('2d');

		if (!ctx) return null;
		ctx.setTransform(exportRatio, 0, 0, exportRatio, 0, 0);
		this.paint({ ctx, width: this.surface.width, height: this.surface.height, dpr: exportRatio });
		return await new Promise((resolve) =>
			exportCanvas.toBlob((blob) => resolve(blob), 'image/png')
		);
	}

	toSVGString(): string {
		const { width, height } = this.surface;
		const tokens = this.readTokens();
		const range = this.expandedMathRange();
		const scope = this.state.variableScope();
		const paths = this.state.equations
			.filter(
				(equation) =>
					equation.visible &&
					!equation.errorMessage &&
					equation.kind !== 'implicit' &&
					equation.kind !== 'inequality'
			)
			.map((equation) => {
				const segments = sampleEquation(equation, range.xMin, range.xMax, 240, 1200, scope);
				const d = segments
					.map((segment) => {
						const commands: string[] = [];

						for (let index = 0; index < segment.length; index += 2) {
							const [x, y] = this.mathToCanvas(segment[index]!, segment[index + 1]!);
							commands.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
						}

						return commands.join(' ');
					})
					.filter(Boolean)
					.join(' ');

				return d
					? `<path d="${d}" fill="none" stroke="${equation.color}" stroke-width="${equation.lineWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${equation.opacity}" />`
					: '';
			})
			.filter(Boolean)
			.join('');
		const scatter = this.state.dataSeries
			.filter((entry) => entry.plotted && entry.visible)
			.flatMap((series) =>
				series.rows
					.map((row) => ({ x: Number(row[0]), y: Number(row[1]) }))
					.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
					.map((point) => {
						const [cx, cy] = this.mathToCanvas(point.x, point.y);
						return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(series.style.size / 2).toFixed(2)}" fill="${series.style.color}" fill-opacity="0.85" />`;
					})
			)
			.join('');

		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
			`<rect width="${width}" height="${height}" fill="${this.state.settings.backgroundColor ?? tokens.canvas}" />`,
			paths,
			scatter,
			`<text x="${width - 20}" y="${height - 18}" font-family="${tokens.fontSans}" font-size="12" fill="${tokens.text}" fill-opacity="0.15" text-anchor="end">Plotrix</text>`,
			'</svg>'
		].join('');
	}

	private paint(surface: SurfaceContext): void {
		surface.ctx.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
		surface.ctx.clearRect(0, 0, surface.width, surface.height);
		surface.ctx.imageSmoothingEnabled = this.state.settings.antialiasing;
		this.syncTokenCache();
		const viewportKey = this.viewportBucket();
		this.drawBackground(surface);

		if (this.state.settings.gridVisible) {
			if (
				this.state.settings.gridStyle === 'polar' &&
				this.state.equations.some((equation) => equation.visible && equation.kind === 'polar')
			) {
				this.drawPolarGrid(surface);
			} else {
				if (this.state.settings.minorGridVisible) this.drawMinorGrid(surface);
				this.drawMajorGrid(surface);
			}
		}

		this.drawAxes(surface);
		if (this.state.settings.axisLabelsVisible) this.drawAxisLabels(surface);
		this.drawInequalitySystems(surface, viewportKey);
		this.drawEquations(surface, viewportKey);
		this.drawScatterData(surface, viewportKey);
		this.drawAsymptoteHighlights(surface);
		this.drawCriticalPointOverlays(surface);
		this.drawIntersectionOverlays(surface);
		if (this.state.settings.traceMode) this.drawTracePoint(surface);
		if (this.state.settings.crosshairVisible) this.drawCrosshair(surface);
		this.drawWatermark(surface);
	}

	private viewportBucket(panThreshold = 0.01, zoomThreshold = 0.02): string {
		const width = Math.max(1, this.surface.width);
		const height = Math.max(1, this.surface.height);
		return [
			Math.round(this.state.view.originX / Math.max(1, width * panThreshold)),
			Math.round(this.state.view.originY / Math.max(1, height * panThreshold)),
			Math.round(this.state.view.scaleX / Math.max(1e-6, this.state.view.scaleX * zoomThreshold)),
			Math.round(this.state.view.scaleY / Math.max(1e-6, this.state.view.scaleY * zoomThreshold))
		].join(':');
	}

	private syncTokenCache(): void {
		const signature = [
			document.documentElement.dataset.theme ?? '',
			this.state.settings.backgroundColor ?? '',
			this.state.settings.axisColor ?? '',
			this.state.settings.theme
		].join(':');

		if (!this.tokenCache || signature !== this.tokenSignature) {
			this.refreshTokenCache(signature);
		}
	}

	private observeThemeChanges(): void {
		if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
			return;
		}

		this.themeObserver = new MutationObserver(() => {
			this.refreshTokenCache();
			this.render();
		});
		this.themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme', 'style']
		});
	}

	private refreshTokenCache(signature?: string): void {
		const styles = getComputedStyle(document.documentElement);
		this.tokenSignature =
			signature ??
			[
				document.documentElement.dataset.theme ?? '',
				this.state.settings.backgroundColor ?? '',
				this.state.settings.axisColor ?? '',
				this.state.settings.theme
			].join(':');
		this.tokenCache = {
			canvas: (
				this.state.settings.backgroundColor ?? styles.getPropertyValue('--color-canvas')
			).trim(),
			gridMinor: styles.getPropertyValue('--color-grid-minor').trim(),
			gridMajor: styles.getPropertyValue('--color-grid-major').trim(),
			axis: (this.state.settings.axisColor ?? styles.getPropertyValue('--color-axis')).trim(),
			text: styles.getPropertyValue('--color-text-primary').trim(),
			muted: styles.getPropertyValue('--color-text-secondary').trim(),
			accent: styles.getPropertyValue('--color-accent').trim(),
			surface: styles.getPropertyValue('--color-bg-surface').trim(),
			border: styles.getPropertyValue('--color-border').trim(),
			fontSans: styles.getPropertyValue('--font-sans').trim()
		};
	}

	private readTokens(): ThemeTokens {
		if (!this.tokenCache) {
			this.refreshTokenCache();
		}
		return this.tokenCache!;
	}

	private sampleScalarField(
		surface: SurfaceContext,
		cols: number,
		rows: number,
		evaluator: (x: number, y: number) => number | null
	): ScalarField {
		const safeCols = Math.max(1, cols);
		const safeRows = Math.max(1, rows);
		const cellWidth = surface.width / safeCols;
		const cellHeight = surface.height / safeRows;
		const stride = safeCols + 1;
		const values = new Float64Array(stride * (safeRows + 1));

		for (let row = 0; row <= safeRows; row += 1) {
			const cy = row * cellHeight;
			for (let col = 0; col <= safeCols; col += 1) {
				const cx = col * cellWidth;
				const [mx, my] = this.canvasToMath(cx, cy);
				const value = evaluator(mx, my);
				values[row * stride + col] = value ?? Number.NaN;
			}
		}

		return { values, cols: safeCols, rows: safeRows, cellWidth, cellHeight };
	}

	private appendTriangleContour(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		p0: CanvasPoint,
		v0: number,
		p1: CanvasPoint,
		v1: number,
		p2: CanvasPoint,
		v2: number
	): void {
		if (!isFiniteScalar(v0) || !isFiniteScalar(v1) || !isFiniteScalar(v2)) return;

		const intersections: CanvasPoint[] = [];
		if (scalarCrossesZero(v0, v1)) intersections.push(interpolateZeroPoint(p0, p1, v0, v1));
		if (scalarCrossesZero(v1, v2)) intersections.push(interpolateZeroPoint(p1, p2, v1, v2));
		if (scalarCrossesZero(v2, v0)) intersections.push(interpolateZeroPoint(p2, p0, v2, v0));

		const points = dedupePoints(intersections);
		if (points.length !== 2) return;
		const start = points[0]!;
		const end = points[1]!;

		ctx.moveTo(start[0], start[1]);
		ctx.lineTo(end[0], end[1]);
	}

	private appendTriangleFill(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		p0: CanvasPoint,
		v0: number,
		p1: CanvasPoint,
		v1: number,
		p2: CanvasPoint,
		v2: number,
		isInside: (value: number) => boolean
	): void {
		if (!isFiniteScalar(v0) || !isFiniteScalar(v1) || !isFiniteScalar(v2)) return;

		const vertices = [
			{ point: p0, value: v0 },
			{ point: p1, value: v1 },
			{ point: p2, value: v2 }
		] as const;
		const polygon: CanvasPoint[] = [];
		let previous = vertices[vertices.length - 1]!;
		let previousInside = isInside(previous.value);

		for (const current of vertices) {
			const currentInside = isInside(current.value);
			if (previousInside !== currentInside) {
				polygon.push(
					interpolateZeroPoint(previous.point, current.point, previous.value, current.value)
				);
			}
			if (currentInside) {
				polygon.push(current.point);
			}
			previous = current;
			previousInside = currentInside;
		}

		const points = dedupePoints(polygon);
		if (points.length < 3) return;
		const start = points[0]!;

		ctx.moveTo(start[0], start[1]);
		for (let index = 1; index < points.length; index += 1) {
			ctx.lineTo(points[index]![0], points[index]![1]);
		}
		ctx.closePath();
	}

	private traceScalarContour(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		field: ScalarField
	): void {
		const { values, cols, rows, cellWidth, cellHeight } = field;
		const stride = cols + 1;

		for (let row = 0; row < rows; row += 1) {
			for (let col = 0; col < cols; col += 1) {
				const topLeft = values[row * stride + col]!;
				const topRight = values[row * stride + col + 1]!;
				const bottomLeft = values[(row + 1) * stride + col]!;
				const bottomRight = values[(row + 1) * stride + col + 1]!;

				if (
					!isFiniteScalar(topLeft) ||
					!isFiniteScalar(topRight) ||
					!isFiniteScalar(bottomLeft) ||
					!isFiniteScalar(bottomRight)
				) {
					continue;
				}

				const minValue = Math.min(topLeft, topRight, bottomLeft, bottomRight);
				const maxValue = Math.max(topLeft, topRight, bottomLeft, bottomRight);
				if (minValue > 0 || maxValue < 0) continue;

				const x0 = col * cellWidth;
				const y0 = row * cellHeight;
				const x1 = x0 + cellWidth;
				const y1 = y0 + cellHeight;
				const center: CanvasPoint = [x0 + cellWidth / 2, y0 + cellHeight / 2];
				const centerValue = (topLeft + topRight + bottomLeft + bottomRight) / 4;

				this.appendTriangleContour(ctx, [x0, y0], topLeft, [x1, y0], topRight, center, centerValue);
				this.appendTriangleContour(
					ctx,
					[x1, y0],
					topRight,
					[x1, y1],
					bottomRight,
					center,
					centerValue
				);
				this.appendTriangleContour(
					ctx,
					[x1, y1],
					bottomRight,
					[x0, y1],
					bottomLeft,
					center,
					centerValue
				);
				this.appendTriangleContour(
					ctx,
					[x0, y1],
					bottomLeft,
					[x0, y0],
					topLeft,
					center,
					centerValue
				);
			}
		}
	}

	private fillScalarMask(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		field: ScalarField,
		isInside: (value: number) => boolean
	): void {
		const { values, cols, rows, cellWidth, cellHeight } = field;
		const stride = cols + 1;

		ctx.beginPath();

		for (let row = 0; row < rows; row += 1) {
			for (let col = 0; col < cols; col += 1) {
				const topLeft = values[row * stride + col]!;
				const topRight = values[row * stride + col + 1]!;
				const bottomLeft = values[(row + 1) * stride + col]!;
				const bottomRight = values[(row + 1) * stride + col + 1]!;

				if (
					!isFiniteScalar(topLeft) ||
					!isFiniteScalar(topRight) ||
					!isFiniteScalar(bottomLeft) ||
					!isFiniteScalar(bottomRight)
				) {
					continue;
				}

				const insideTopLeft = isInside(topLeft);
				const insideTopRight = isInside(topRight);
				const insideBottomLeft = isInside(bottomLeft);
				const insideBottomRight = isInside(bottomRight);
				const insideCount =
					Number(insideTopLeft) +
					Number(insideTopRight) +
					Number(insideBottomLeft) +
					Number(insideBottomRight);

				if (!insideCount) continue;

				const x0 = col * cellWidth;
				const y0 = row * cellHeight;
				const x1 = x0 + cellWidth;
				const y1 = y0 + cellHeight;

				if (insideCount === 4) {
					ctx.rect(x0, y0, cellWidth, cellHeight);
					continue;
				}

				const center: CanvasPoint = [x0 + cellWidth / 2, y0 + cellHeight / 2];
				const centerValue = (topLeft + topRight + bottomLeft + bottomRight) / 4;

				this.appendTriangleFill(
					ctx,
					[x0, y0],
					topLeft,
					[x1, y0],
					topRight,
					center,
					centerValue,
					isInside
				);
				this.appendTriangleFill(
					ctx,
					[x1, y0],
					topRight,
					[x1, y1],
					bottomRight,
					center,
					centerValue,
					isInside
				);
				this.appendTriangleFill(
					ctx,
					[x1, y1],
					bottomRight,
					[x0, y1],
					bottomLeft,
					center,
					centerValue,
					isInside
				);
				this.appendTriangleFill(
					ctx,
					[x0, y1],
					bottomLeft,
					[x0, y0],
					topLeft,
					center,
					centerValue,
					isInside
				);
			}
		}

		ctx.fill();
	}

	private drawBackground(surface: SurfaceContext): void {
		const tokens = this.readTokens();
		surface.ctx.fillStyle = tokens.canvas;
		surface.ctx.fillRect(0, 0, surface.width, surface.height);
	}

	private drawMinorGrid(surface: SurfaceContext): void {
		const majorX = niceStep(90 / this.state.view.scaleX);
		const majorY = niceStep(90 / this.state.view.scaleY);
		this.drawGridLines(surface, majorX / 5, majorY / 5, 0.4, 1, this.readTokens().gridMinor);
	}

	private drawMajorGrid(surface: SurfaceContext): void {
		const majorX = niceStep(90 / this.state.view.scaleX);
		const majorY = niceStep(90 / this.state.view.scaleY);
		this.drawGridLines(surface, majorX, majorY, 0.8, 1.2, this.readTokens().gridMajor);
	}

	private drawPolarGrid(surface: SurfaceContext): void {
		const tokens = this.readTokens();
		const { ctx, width, height } = surface;
		const maxRadius = Math.max(
			Math.hypot(this.state.view.originX, this.state.view.originY),
			Math.hypot(width - this.state.view.originX, height - this.state.view.originY)
		);
		const maxMathRadius = maxRadius / Math.min(this.state.view.scaleX, this.state.view.scaleY);

		ctx.save();
		ctx.strokeStyle = tokens.gridMinor;
		ctx.lineWidth = 0.5;
		ctx.globalAlpha = 0.8;

		for (let radius = 1; radius <= Math.ceil(maxMathRadius); radius += 1) {
			ctx.beginPath();
			ctx.arc(
				this.state.view.originX,
				this.state.view.originY,
				radius * Math.min(this.state.view.scaleX, this.state.view.scaleY),
				0,
				Math.PI * 2
			);
			ctx.stroke();
		}

		for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
			ctx.beginPath();
			ctx.moveTo(this.state.view.originX, this.state.view.originY);
			ctx.lineTo(
				this.state.view.originX + Math.cos(angle) * maxRadius,
				this.state.view.originY - Math.sin(angle) * maxRadius
			);
			ctx.stroke();
		}

		ctx.fillStyle = tokens.muted;
		ctx.font = `500 11px ${tokens.fontSans}`;
		for (let degree = 0; degree < 360; degree += 30) {
			const angle = (degree * Math.PI) / 180;
			const labelRadius = maxRadius + 14;
			const x = this.state.view.originX + Math.cos(angle) * labelRadius;
			const y = this.state.view.originY - Math.sin(angle) * labelRadius;
			ctx.fillText(`${degree}°`, x - 10, y + 4);
		}

		ctx.restore();
	}

	private drawGridLines(
		surface: SurfaceContext,
		stepX: number,
		stepY: number,
		alpha: number,
		lineWidth: number,
		color: string
	): void {
		const { ctx, width, height } = surface;
		const range = this.visibleMathRange();
		ctx.save();
		ctx.strokeStyle = color;
		ctx.globalAlpha = alpha;
		ctx.lineWidth = lineWidth;

		for (let x = Math.ceil(range.xMin / stepX) * stepX; x <= range.xMax; x += stepX) {
			const [cx] = this.mathToCanvas(x, 0);
			ctx.beginPath();
			ctx.moveTo(cx, 0);
			ctx.lineTo(cx, height);
			ctx.stroke();
		}

		for (let y = Math.ceil(range.yMin / stepY) * stepY; y <= range.yMax; y += stepY) {
			const [, cy] = this.mathToCanvas(0, y);
			ctx.beginPath();
			ctx.moveTo(0, cy);
			ctx.lineTo(width, cy);
			ctx.stroke();
		}

		ctx.restore();
	}

	private drawAxes(surface: SurfaceContext): void {
		const tokens = this.readTokens();
		const range = this.visibleMathRange();
		const { ctx, width, height } = surface;
		ctx.save();
		ctx.strokeStyle = tokens.axis;
		ctx.fillStyle = tokens.axis;
		ctx.lineWidth = 1.7;

		if (range.yMin <= 0 && range.yMax >= 0) {
			const [, axisY] = this.mathToCanvas(0, 0);
			ctx.beginPath();
			ctx.moveTo(0, axisY);
			ctx.lineTo(width, axisY);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(width - 12, axisY - 5);
			ctx.lineTo(width, axisY);
			ctx.lineTo(width - 12, axisY + 5);
			ctx.closePath();
			ctx.fill();
		}

		if (range.xMin <= 0 && range.xMax >= 0) {
			const [axisX] = this.mathToCanvas(0, 0);
			ctx.beginPath();
			ctx.moveTo(axisX, height);
			ctx.lineTo(axisX, 0);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(axisX - 5, 12);
			ctx.lineTo(axisX, 0);
			ctx.lineTo(axisX + 5, 12);
			ctx.closePath();
			ctx.fill();
		}

		ctx.restore();
	}

	private drawAxisLabels(surface: SurfaceContext): void {
		const tokens = this.readTokens();
		const { ctx, width, height } = surface;
		const range = this.visibleMathRange();
		const stepX = niceStep(90 / this.state.view.scaleX);
		const stepY = niceStep(72 / this.state.view.scaleY);
		const baselineY = clamp(
			range.yMin <= 0 && range.yMax >= 0 ? this.mathToCanvas(0, 0)[1] + 18 : height - 10,
			16,
			height - 10
		);
		const baselineX = clamp(
			range.xMin <= 0 && range.xMax >= 0 ? this.mathToCanvas(0, 0)[0] + 10 : 10,
			10,
			width - 44
		);

		ctx.save();
		ctx.fillStyle = tokens.muted;
		ctx.font = `600 11px ${tokens.fontSans}`;

		for (let x = Math.ceil(range.xMin / stepX) * stepX; x <= range.xMax; x += stepX) {
			if (Math.abs(x) < stepX / 2) continue;
			const [cx] = this.mathToCanvas(x, 0);
			this.drawClippedText(ctx, formatAxisLabel(x, stepX), cx, baselineY, tokens.muted);
		}

		for (let y = Math.ceil(range.yMin / stepY) * stepY; y <= range.yMax; y += stepY) {
			if (Math.abs(y) < stepY / 2) continue;
			const [, cy] = this.mathToCanvas(0, y);
			this.drawClippedText(ctx, formatAxisLabel(y, stepY), baselineX, cy - 6, tokens.muted, 'left');
		}

		ctx.restore();
	}

	private drawInequalitySystems(surface: SurfaceContext, viewportKey: string): void {
		const inequalities = this.state.equations.filter(
			(equation) =>
				equation.visible &&
				!equation.errorMessage &&
				equation.kind === 'inequality' &&
				equation.inequality
		);

		if (inequalities.length === 1) {
			this.drawInequalityShading(surface, inequalities[0]!, 0.15, viewportKey);
			return;
		}

		if (inequalities.length < 2) return;
		const { width, height } = surface;
		const cacheKey = [
			'ineq-system',
			inequalities
				.map((equation) => `${equation.id}:${equation.raw}:${equation.lineStyle}`)
				.join('|'),
			viewportKey,
			Object.values(this.state.variableScope()).join(':')
		].join(':');
		let layer = this.inequalitySystemCache.get(cacheKey);

		if (!layer) {
			const created = this.createCacheLayer(width, height, surface.dpr);
			layer = created.layer;
			const ctx = created.ctx;
			if (!ctx) return;
			ctx.clearRect(0, 0, width, height);
			const cols = Math.min(260, Math.max(96, Math.ceil(width / 7)));
			const rows = Math.min(220, Math.max(84, Math.ceil(height / 7)));
			const scope = this.state.variableScope();
			const field = this.sampleScalarField(surface, cols, rows, (x, y) => {
				for (const equation of inequalities) {
					const value = evaluateImplicitAt(
						equation.compiledExpression ?? equation.compiled,
						x,
						y,
						scope
					);

					if (!Number.isFinite(value)) {
						return Number.NaN;
					}

					const finiteValue = value as number;
					const inside =
						equation.inequality?.operator === '>'
							? finiteValue > 0
							: equation.inequality?.operator === '>='
								? finiteValue >= 0
								: equation.inequality?.operator === '<'
									? finiteValue < 0
									: finiteValue <= 0;

					if (!inside) {
						return 1;
					}
				}

				return -1;
			});
			const colors = inequalities.map((equation) => equation.color);
			const fill = colors.reduce((current, color) => blendLinearRgb(current, color));
			ctx.fillStyle = fill;
			ctx.globalAlpha = 0.25;
			this.fillScalarMask(ctx, field, (value) => value <= 0);
			this.setCanvasCacheEntry(this.inequalitySystemCache, cacheKey, layer);
		}

		surface.ctx.drawImage(layer, 0, 0, width, height);

		for (const equation of inequalities) {
			this.drawInequalityBoundary(surface, equation);
		}
	}

	private drawInequalityBoundary(surface: SurfaceContext, equation: PlotEquation): void {
		const inequality = equation.inequality;

		if (!inequality) {
			return;
		}

		const ctx = surface.ctx;
		const scope = this.state.variableScope();
		const strict = inequality.operator === '>' || inequality.operator === '<';

		ctx.save();
		ctx.strokeStyle = equation.color;
		ctx.lineWidth = 1.5;
		ctx.setLineDash(
			strict && equation.lineStyle === 'solid' ? [6, 4] : dashPattern(equation.lineStyle)
		);

		if (inequality.isExplicitYBoundary) {
			const range = this.expandedMathRange();
			const step = (range.xMax - range.xMin) / Math.max(320, this.surface.width);
			let started = false;
			let previousY: number | null = null;
			ctx.beginPath();

			for (let x = range.xMin; x <= range.xMax; x += step) {
				const y = evaluateInequalityBoundaryAt(inequality, x, scope);

				if (y === null || !Number.isFinite(y)) {
					started = false;
					previousY = null;
					continue;
				}

				const [cx, rawCy] = this.mathToCanvas(x, y);
				const cy = clamp(rawCy, -20, this.surface.height + 20);

				if (previousY !== null && Math.abs(cy - previousY) > this.surface.height * 3) {
					started = false;
				}

				if (!started) {
					ctx.moveTo(cx, cy);
					started = true;
				} else {
					ctx.lineTo(cx, cy);
				}

				previousY = cy;
			}

			ctx.stroke();
		} else {
			const cols = Math.min(320, Math.max(120, Math.ceil(surface.width / 6)));
			const rows = Math.min(240, Math.max(96, Math.ceil(surface.height / 6)));
			const field = this.sampleScalarField(surface, cols, rows, (x, y) =>
				evaluateImplicitAt(equation.compiledExpression ?? equation.compiled, x, y, scope)
			);
			ctx.beginPath();
			this.traceScalarContour(ctx, field);
			ctx.stroke();
		}

		ctx.restore();
	}

	private drawInequalityMask(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		equation: PlotEquation,
		alpha: number
	): void {
		const inequality = equation.inequality;
		if (!inequality) return;
		const width = ctx.canvas.width / this.surface.dpr;
		const height = ctx.canvas.height / this.surface.dpr;
		const scope = this.state.variableScope();
		ctx.save();
		ctx.fillStyle = equation.color;
		ctx.globalAlpha = alpha;

		if (inequality.isExplicitYBoundary) {
			const shadesUp =
				inequality.lhsRaw === 'y'
					? inequality.operator === '>' || inequality.operator === '>='
					: inequality.operator === '<' || inequality.operator === '<=';
			const edgeY = shadesUp ? 0 : height;
			const step = 1;
			let polygonOpen = false;
			let firstX = 0;
			let previousY: number | null = null;

			for (let column = 0; column <= width; column += step) {
				const [x] = this.canvasToMath(column, 0);
				const boundary = evaluateInequalityBoundaryAt(inequality, x, scope);
				if (boundary === null || !Number.isFinite(boundary)) {
					if (polygonOpen) {
						ctx.lineTo(column, edgeY);
						ctx.lineTo(firstX, edgeY);
						ctx.closePath();
						ctx.fill();
					}
					polygonOpen = false;
					previousY = null;
					continue;
				}

				const [, rawCanvasY] = this.mathToCanvas(x, boundary);
				const canvasY = clamp(rawCanvasY, -20, height + 20);

				if (previousY !== null && Math.abs(canvasY - previousY) > height * 3) {
					if (polygonOpen) {
						ctx.lineTo(column - step, edgeY);
						ctx.lineTo(firstX, edgeY);
						ctx.closePath();
						ctx.fill();
					}
					polygonOpen = false;
				}

				if (!polygonOpen) {
					ctx.beginPath();
					ctx.moveTo(column, edgeY);
					ctx.lineTo(column, canvasY);
					firstX = column;
					polygonOpen = true;
				} else {
					ctx.lineTo(column, canvasY);
				}

				previousY = canvasY;
			}

			if (polygonOpen) {
				ctx.lineTo(width, edgeY);
				ctx.lineTo(firstX, edgeY);
				ctx.closePath();
				ctx.fill();
			}
		} else {
			const cols = Math.min(320, Math.max(120, Math.ceil(width / 6)));
			const rows = Math.min(240, Math.max(96, Math.ceil(height / 6)));
			const field = this.sampleScalarField(this.surface, cols, rows, (x, y) =>
				evaluateImplicitAt(equation.compiledExpression ?? equation.compiled, x, y, scope)
			);
			const isInside = (value: number): boolean => {
				if (!isFiniteScalar(value)) return false;
				if (inequality.operator === '>') return value > 0;
				if (inequality.operator === '>=') return value >= 0;
				if (inequality.operator === '<') return value < 0;
				return value <= 0;
			};
			this.fillScalarMask(ctx, field, isInside);
		}

		ctx.restore();
	}

	private drawInequalityShading(
		surface: SurfaceContext,
		equation: PlotEquation,
		alpha: number,
		viewportKey: string
	): void {
		const inequality = equation.inequality;
		if (!inequality) return;
		const cacheKey = [
			equation.id,
			equation.raw,
			viewportKey,
			alpha,
			Object.values(this.state.variableScope()).join(':')
		].join(':');
		let layer = this.shadingCache.get(cacheKey);
		if (!layer) {
			const created = this.createCacheLayer(surface.width, surface.height, surface.dpr);
			layer = created.layer;
			const ctx = created.ctx;
			if (!ctx) return;
			this.drawInequalityMask(ctx, equation, alpha);
			this.drawInequalityBoundary(
				{ ...surface, ctx: ctx as CanvasRenderingContext2D, dpr: surface.dpr },
				equation
			);
			this.setCanvasCacheEntry(this.shadingCache, cacheKey, layer);
		}
		surface.ctx.drawImage(layer, 0, 0, surface.width, surface.height);
	}

	private drawEquations(surface: SurfaceContext, viewportKey: string): void {
		const visibleCount = Math.max(
			1,
			this.state.equations.filter(
				(equation) => equation.visible && !equation.errorMessage && equation.kind !== 'inequality'
			).length
		);
		for (const equation of this.state.equations) {
			if (!equation.visible || equation.errorMessage || equation.kind === 'inequality') continue;
			const startedAt = performance.now();
			this.drawCurve(surface, equation, visibleCount, viewportKey);
			this.state.setEquationRenderTime(equation.id, performance.now() - startedAt);
		}
	}

	private drawCurve(
		surface: SurfaceContext,
		equation: PlotEquation,
		visibleCount: number,
		viewportKey: string
	): void {
		if (equation.kind === 'polar') {
			this.drawPolarCurve(surface, equation, viewportKey);
			return;
		}

		if (equation.kind === 'implicit') {
			this.drawImplicitCurve(surface, equation);
			return;
		}

		const { ctx } = surface;
		const range = this.expandedMathRange();
		const budgetKey = `${visibleCount}:${surface.width}`;
		let budget = this.curveBudgetCache.get(budgetKey);

		if (!budget) {
			const frameBudget = Math.max(480, Math.floor(8000 / visibleCount));
			budget = {
				baseSamples: Math.min(frameBudget, Math.max(240, Math.round(surface.width * 0.75))),
				maxSamples: 0
			};
			budget.maxSamples = Math.max(budget.baseSamples * 3, Math.min(2400, frameBudget * 2));
			this.curveBudgetCache.set(budgetKey, budget);
		}

		const segments = sampleEquation(
			equation,
			range.xMin,
			range.xMax,
			budget.baseSamples,
			budget.maxSamples,
			this.state.variableScope()
		);

		ctx.save();
		ctx.beginPath();
		ctx.strokeStyle = equation.color;
		ctx.lineWidth = equation.lineWidth;
		ctx.globalAlpha = equation.opacity;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.setLineDash(dashPattern(equation.lineStyle));

		for (const segment of segments) {
			const points: Array<[number, number]> = [];
			for (let index = 0; index < segment.length; index += 2) {
				points.push(this.mathToCanvas(segment[index]!, segment[index + 1]!));
			}
			this.drawPolyline(ctx, points, surface.width, surface.height);
		}

		ctx.stroke();

		if (segments.length) {
			const lastSegment = segments[segments.length - 1]!;
			const [labelX, labelY] = this.mathToCanvas(
				lastSegment[lastSegment.length - 2]!,
				lastSegment[lastSegment.length - 1]!
			);
			this.drawLabelText(
				ctx,
				equation.label || equation.raw,
				labelX + 10,
				labelY - 10,
				equation.color
			);
		}

		ctx.restore();
	}

	private drawPolarCurve(
		surface: SurfaceContext,
		equation: PlotEquation,
		viewportKey: string
	): void {
		const { ctx } = surface;
		const cacheKey = `${equation.id}:${equation.raw}:${viewportKey}:${Object.values(this.state.variableScope()).join(':')}`;
		let layer = this.polarCache.get(cacheKey);

		if (!layer) {
			const created = this.createCacheLayer(surface.width, surface.height, surface.dpr);
			layer = created.layer;
			const layerCtx = created.ctx;
			if (!layerCtx) return;
			const maxSteps = Math.min(2200, Math.max(720, Math.round(this.state.view.scaleX * 48)));
			const start = 0;
			const maxTheta = Math.PI * 4;
			const step = (maxTheta - start) / maxSteps;
			const points: Array<[number, number]> = [];
			let startPoint: [number, number] | null = null;

			layerCtx.save();
			layerCtx.beginPath();
			layerCtx.strokeStyle = equation.color;
			layerCtx.lineWidth = equation.lineWidth;
			layerCtx.globalAlpha = equation.opacity;
			layerCtx.setLineDash(dashPattern(equation.lineStyle));

			for (let index = 0; index <= maxSteps; index += 1) {
				const theta = start + step * index;
				const r = evaluatePolarAt(
					equation.compiledExpression ?? equation.compiled,
					theta,
					this.state.variableScope()
				);
				if (r === null || Number.isNaN(r) || Math.abs(r) > 1e6) {
					if (points.length > 1) {
						this.drawPolyline(
							layerCtx,
							points.splice(0, points.length),
							surface.width,
							surface.height
						);
					}
					startPoint = null;
					continue;
				}
				const mx = r * Math.cos(theta);
				const my = r * Math.sin(theta);
				const point = this.mathToCanvas(mx, my);
				if (!startPoint) startPoint = point;
				points.push(point);

				if (
					index > maxSteps / 4 &&
					startPoint &&
					Math.hypot(point[0] - startPoint[0], point[1] - startPoint[1]) < 1
				) {
					break;
				}
			}

			if (points.length > 1) this.drawPolyline(layerCtx, points, surface.width, surface.height);
			layerCtx.stroke();
			layerCtx.restore();
			this.setCanvasCacheEntry(this.polarCache, cacheKey, layer);
		}

		ctx.drawImage(layer, 0, 0, surface.width, surface.height);
	}

	private drawImplicitCurve(surface: SurfaceContext, equation: PlotEquation): void {
		const { ctx } = surface;
		const scope = this.state.variableScope();
		const cols = Math.min(360, Math.max(128, Math.ceil(surface.width / 6)));
		const rows = Math.min(300, Math.max(128, Math.ceil(surface.height / 6)));
		const field = this.sampleScalarField(surface, cols, rows, (x, y) =>
			evaluateImplicitAt(equation.compiledExpression ?? equation.compiled, x, y, scope)
		);

		ctx.save();
		ctx.strokeStyle = equation.color;
		ctx.lineWidth = equation.lineWidth;
		ctx.globalAlpha = equation.opacity;
		ctx.setLineDash(dashPattern(equation.lineStyle));
		ctx.beginPath();
		this.traceScalarContour(ctx, field);
		ctx.stroke();
		ctx.restore();
	}

	private drawScatterData(surface: SurfaceContext, viewportKey: string): void {
		for (const series of this.state.dataSeries.filter((entry) => entry.plotted && entry.visible)) {
			this.drawScatterSeries(surface, series, viewportKey);
		}
	}

	private drawScatterSeries(
		surface: SurfaceContext,
		series: DataSeries,
		viewportKey: string
	): void {
		const cacheKey = [
			series.id,
			viewportKey,
			series.style.symbol,
			series.style.size,
			series.style.color,
			series.style.showLine,
			series.rows.length
		].join(':');

		let layer = this.scatterCache.get(cacheKey);
		if (!layer) {
			const created = this.createCacheLayer(surface.width, surface.height, surface.dpr);
			layer = created.layer;
			const ctx = created.ctx;
			if (!ctx) return;

			const points: Array<{ x: number; y: number }> = [];
			for (let index = 0; index < series.rows.length; index += 1) {
				const row = series.rows[index];
				if (!row) continue;
				const x = Number(row[0]);
				const y = Number(row[1]);
				if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
			}

			if (!points.length) return;

			if (series.style.showLine && points.length > 1) {
				ctx.save();
				ctx.beginPath();
				ctx.strokeStyle = series.style.color;
				ctx.globalAlpha = 0.5;
				ctx.lineWidth = 1.5;
				for (let index = 0; index < points.length; index += 1) {
					const point = points[index]!;
					const [cx, cy] = this.mathToCanvas(point.x, point.y);
					if (index === 0) ctx.moveTo(cx, cy);
					else ctx.lineTo(cx, cy);
				}
				ctx.stroke();
				ctx.restore();
			}

			for (let index = 0; index < points.length; index += 1) {
				const point = points[index]!;
				const [cx, cy] = this.mathToCanvas(point.x, point.y);
				this.drawScatterSymbol(
					ctx,
					cx,
					cy,
					series.style.symbol,
					series.style.size,
					series.style.color
				);
			}

			this.setCanvasCacheEntry(this.scatterCache, cacheKey, layer);
		}

		surface.ctx.drawImage(layer, 0, 0, surface.width, surface.height);
	}

	private drawScatterSymbol(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		x: number,
		y: number,
		symbol: DataSeries['style']['symbol'],
		size: number,
		color: string
	): void {
		ctx.save();
		ctx.fillStyle = color;
		ctx.strokeStyle = this.readTokens().surface;
		ctx.globalAlpha = 0.8;
		ctx.lineWidth = 1;
		ctx.beginPath();
		switch (symbol) {
			case 'square':
				ctx.rect(x - size / 2, y - size / 2, size, size);
				break;
			case 'triangle':
				ctx.moveTo(x, y - size / 2);
				ctx.lineTo(x + size / 2, y + size / 2);
				ctx.lineTo(x - size / 2, y + size / 2);
				ctx.closePath();
				break;
			case 'cross':
				ctx.moveTo(x - size / 2, y);
				ctx.lineTo(x + size / 2, y);
				ctx.moveTo(x, y - size / 2);
				ctx.lineTo(x, y + size / 2);
				ctx.stroke();
				ctx.restore();
				return;
			case 'diamond':
				ctx.moveTo(x, y - size / 2);
				ctx.lineTo(x + size / 2, y);
				ctx.lineTo(x, y + size / 2);
				ctx.lineTo(x - size / 2, y);
				ctx.closePath();
				break;
			default:
				ctx.arc(x, y, size / 2, 0, Math.PI * 2);
		}
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	private drawCriticalPointOverlays(surface: SurfaceContext): void {
		if (!this.state.settings.showCriticalPoints) return;
		for (const equation of this.state.equations) {
			if (
				!equation.visible ||
				equation.errorMessage ||
				!equation.showMarkers ||
				equation.kind !== 'cartesian'
			)
				continue;
			this.drawCriticalPoints(surface, this.state.getCriticalPoints(equation.id), equation.color);
		}
	}

	private drawIntersectionOverlays(surface: SurfaceContext): void {
		if (!this.state.settings.showIntersections) return;
		const intersections = this.state.getIntersections();
		for (const point of intersections) {
			const eqA = this.state.equations.find((equation) => equation.id === point.eqAId);
			const eqB = this.state.equations.find((equation) => equation.id === point.eqBId);
			if (!eqA || !eqB) continue;
			this.drawIntersectionMarker(surface, point, blendLinearRgb(eqA.color, eqB.color));
		}
	}

	drawCriticalPoints(surface: SurfaceContext, points: CriticalPoint[], color: string): void {
		const { ctx } = surface;
		const tokens = this.readTokens();
		ctx.save();
		ctx.font = `10px ${tokens.fontSans}`;
		ctx.textAlign = 'center';

		for (const point of points) {
			const [cx, cy] = this.mathToCanvas(point.x, point.y);
			ctx.strokeStyle = color;
			ctx.fillStyle = color;

			if (point.kind === 'root') {
				ctx.beginPath();
				ctx.arc(cx, cy, 5, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.stroke();
				this.drawClippedText(ctx, `x = ${formatSig(point.x)}`, cx, cy + 24, tokens.muted);
			} else if (point.kind === 'localMax') {
				ctx.beginPath();
				ctx.moveTo(cx, cy - 8);
				ctx.lineTo(cx + 5, cy);
				ctx.lineTo(cx - 5, cy);
				ctx.closePath();
				ctx.fillStyle = color;
				ctx.fill();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1;
				ctx.stroke();
				this.drawClippedText(
					ctx,
					`(${formatSig(point.x)}, ${formatSig(point.y)})`,
					cx,
					cy - 14,
					tokens.text
				);
			} else if (point.kind === 'localMin') {
				ctx.beginPath();
				ctx.moveTo(cx, cy + 8);
				ctx.lineTo(cx + 5, cy);
				ctx.lineTo(cx - 5, cy);
				ctx.closePath();
				ctx.fillStyle = color;
				ctx.fill();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1;
				ctx.stroke();
				this.drawClippedText(
					ctx,
					`(${formatSig(point.x)}, ${formatSig(point.y)})`,
					cx,
					cy + 18,
					tokens.text
				);
			} else {
				ctx.save();
				ctx.translate(cx, cy);
				ctx.rotate(Math.PI / 4);
				ctx.globalAlpha = 0.7;
				ctx.fillStyle = color;
				ctx.strokeStyle = color;
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.rect(-4, -4, 8, 8);
				ctx.fill();
				ctx.globalAlpha = 1;
				ctx.stroke();
				ctx.restore();
				this.drawClippedText(
					ctx,
					`x = ${formatSig(point.x)}`,
					cx + 26,
					cy + 4,
					tokens.text,
					'left'
				);
			}
		}

		ctx.restore();
	}

	private drawIntersectionMarker(
		surface: SurfaceContext,
		point: IntersectionPoint,
		color: string
	): void {
		const { ctx } = surface;
		const tokens = this.readTokens();
		const [cx, cy] = this.mathToCanvas(point.x, point.y);
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(cx - 4, cy - 4);
		ctx.lineTo(cx + 4, cy + 4);
		ctx.moveTo(cx + 4, cy - 4);
		ctx.lineTo(cx - 4, cy + 4);
		ctx.stroke();

		ctx.font = `600 10px ${tokens.fontSans}`;
		const textWidth = ctx.measureText(point.label).width;
		const x = clamp(cx - textWidth / 2 - 2, 8, this.surface.width - textWidth - 12);
		let y = clamp(cy - 26, 8, this.surface.height - 24);
		if (x < 120 && y < 40) {
			y = clamp(cy - 6, 8, this.surface.height - 24);
		}
		ctx.fillStyle = tokens.surface;
		ctx.globalAlpha = 0.85;
		ctx.beginPath();
		ctx.roundRect(x, y, textWidth + 8, 16, 6);
		ctx.fill();
		ctx.globalAlpha = 1;
		ctx.fillStyle = tokens.text;
		ctx.fillText(point.label, x + 4, y + 12);
		ctx.restore();
	}

	private drawAsymptoteHighlights(surface: SurfaceContext): void {
		if (!this.ui?.highlightedAsymptotes.length) return;
		const { ctx, height } = surface;
		ctx.save();
		ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
		ctx.lineWidth = 1.5;
		ctx.setLineDash([6, 4]);
		for (const value of this.ui.highlightedAsymptotes) {
			const [cx] = this.mathToCanvas(value, 0);
			ctx.beginPath();
			ctx.moveTo(cx, 0);
			ctx.lineTo(cx, height);
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawPolyline(
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		points: Array<[number, number]>,
		width: number,
		height: number
	): void {
		if (points.length < 2) return;
		const padX = 24;
		const padY = 24;
		const left = -padX;
		const top = -padY;
		const right = width + padX;
		const bottom = height + padY;

		for (let index = 1; index < points.length; index += 1) {
			const previous = points[index - 1]!;
			const current = points[index]!;
			const deltaX = Math.abs(current[0] - previous[0]);
			const deltaY = Math.abs(current[1] - previous[1]);
			const angle = Math.atan2(deltaY, Math.max(deltaX, 1e-6));
			if (deltaX < 12 && deltaY > height * 0.9 && angle > 1.48) continue;
			const clipped = clipLineToRect(
				previous[0],
				previous[1],
				current[0],
				current[1],
				left,
				top,
				right,
				bottom
			);
			if (!clipped) continue;
			ctx.moveTo(clipped[0], clipped[1]);
			ctx.lineTo(clipped[2], clipped[3]);
		}
	}

	private drawTracePoint(surface: SurfaceContext): void {
		if (!this.ui?.tracePoint || this.state.view.isPanning || this.state.view.isAnimating) return;
		const equation = this.state.equations.find(
			(entry) => entry.id === this.ui?.tracePoint?.equationId
		);
		const [cx, cy] = this.mathToCanvas(this.ui.tracePoint.x, this.ui.tracePoint.y);
		const { ctx } = surface;
		ctx.save();
		ctx.fillStyle = equation?.color ?? this.readTokens().accent;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		this.drawChip(
			ctx,
			cx + 14,
			cy - 28,
			`${formatCoordinate(this.ui.tracePoint.x)}, ${formatCoordinate(this.ui.tracePoint.y)}`,
			equation?.color ?? this.readTokens().accent
		);
		ctx.restore();
	}

	private drawCrosshair(surface: SurfaceContext): void {
		if (!this.pointer || this.state.view.isPanning || this.state.view.isAnimating) return;
		const { ctx, width, height } = surface;
		const [mx, my] = this.canvasToMath(this.pointer.x, this.pointer.y);
		ctx.save();
		ctx.strokeStyle = this.readTokens().accent;
		ctx.globalAlpha = 0.32;
		ctx.setLineDash([4, 6]);
		ctx.beginPath();
		ctx.moveTo(this.pointer.x, 0);
		ctx.lineTo(this.pointer.x, height);
		ctx.moveTo(0, this.pointer.y);
		ctx.lineTo(width, this.pointer.y);
		ctx.stroke();
		this.drawChip(
			ctx,
			this.pointer.x + 14,
			this.pointer.y + 14,
			`x ${formatCoordinate(mx)} · y ${formatCoordinate(my)}`
		);
		ctx.restore();
	}

	private drawChip(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		label: string,
		accent = this.readTokens().accent
	): void {
		if (this.state.view.isPanning || this.state.view.isAnimating) return;
		const tokens = this.readTokens();
		ctx.save();
		ctx.font = `600 12px ${tokens.fontSans}`;
		const width = ctx.measureText(label).width + 16;
		const height = 24;
		const clampedX = clamp(x, 8, Math.max(8, this.surface.width - width - 8));
		const clampedY = clamp(y, 8, Math.max(8, this.surface.height - height - 8));
		ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
		ctx.shadowBlur = 14;
		ctx.fillStyle = tokens.surface;
		ctx.globalAlpha = 0.98;
		ctx.beginPath();
		ctx.roundRect(clampedX, clampedY, width, height, 999);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.strokeStyle = accent;
		ctx.globalAlpha = 0.2;
		ctx.stroke();
		ctx.fillStyle = tokens.text;
		ctx.globalAlpha = 1;
		ctx.fillText(label, clampedX + 8, clampedY + 16);
		ctx.restore();
	}

	private drawClippedText(
		ctx: CanvasRenderingContext2D,
		text: string,
		x: number,
		y: number,
		color: string,
		align: CanvasTextAlign = 'center'
	): void {
		ctx.save();
		ctx.textAlign = align;
		ctx.fillStyle = color;
		const metrics = ctx.measureText(text).width;
		const safeX =
			align === 'center'
				? clamp(x, 8 + metrics / 2, this.surface.width - 8 - metrics / 2)
				: clamp(x, 8, this.surface.width - 8 - metrics);
		const safeY = clamp(y, 8, this.surface.height - 8);
		ctx.fillText(text, safeX, safeY);
		ctx.restore();
	}

	private drawLabelText(
		ctx: CanvasRenderingContext2D,
		label: string,
		x: number,
		y: number,
		color: string
	): void {
		ctx.save();
		ctx.font = `600 ${this.state.settings.labelSize}px ${this.readTokens().fontSans}`;
		ctx.globalAlpha = 0.92;
		this.drawClippedText(ctx, label, x, y, color, 'left');
		ctx.restore();
	}

	private drawWatermark(surface: SurfaceContext): void {
		const tokens = this.readTokens();
		const paddingX = 16;
		const paddingY = 14;
		surface.ctx.save();
		surface.ctx.fillStyle = tokens.text;
		surface.ctx.globalAlpha = 0.14;
		surface.ctx.font = `600 12px ${tokens.fontSans}`;
		const width = surface.ctx.measureText('Plotrix').width;
		surface.ctx.fillText('Plotrix', surface.width - width - paddingX, surface.height - paddingY);
		surface.ctx.restore();
	}
}
