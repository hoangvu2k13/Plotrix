import { sampleEquation } from '$lib/math/engine';
import type { GraphState, PlotEquation } from '$stores/graph.svelte';
import type { UiState } from '$stores/ui.svelte';
import { clamp, formatCoordinate } from '$utils/format';

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

function niceStep(units: number): number {
	const exponent = Math.floor(Math.log10(units));
	const fraction = units / 10 ** exponent;

	if (fraction <= 1) return 10 ** exponent;
	if (fraction <= 2) return 2 * 10 ** exponent;
	if (fraction <= 5) return 5 * 10 ** exponent;
	return 10 * 10 ** exponent;
}

function dashPattern(style: PlotEquation['lineStyle']): number[] {
	if (style === 'dashed') {
		return [8, 4];
	}

	if (style === 'dotted') {
		return [2, 4];
	}

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

export class CanvasRenderer {
	ctx: CanvasRenderingContext2D;
	dpr = 1;
	animFrame = 0;
	renderQueue = false;

	private pointer: { x: number; y: number } | null = null;
	private surface: SurfaceContext;

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
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) {
			return;
		}

		this.dpr =
			this.state.settings.highDPI && typeof window !== 'undefined'
				? window.devicePixelRatio || 1
				: 1;
		this.canvas.width = Math.floor(width * this.dpr);
		this.canvas.height = Math.floor(height * this.dpr);
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.surface = { ctx: this.ctx, width, height, dpr: this.dpr };
		this.state.setViewportSize(width, height);
		this.render(true);
	}

	destroy(): void {
		if (this.animFrame) {
			cancelAnimationFrame(this.animFrame);
		}
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
		if (!this.surface.width || !this.surface.height) {
			return;
		}

		if (immediate) {
			if (this.animFrame) {
				cancelAnimationFrame(this.animFrame);
			}

			this.renderQueue = false;
			this.paint(this.surface);
			return;
		}

		if (this.renderQueue) {
			return;
		}

		this.renderQueue = true;
		this.animFrame = requestAnimationFrame(() => {
			this.renderQueue = false;
			this.paint(this.surface);
		});
	}

	async toPNGBlob(scale: 1 | 2 | 3): Promise<Blob | null> {
		if (!this.surface.width || !this.surface.height) {
			return null;
		}

		const exportCanvas = document.createElement('canvas');
		const exportRatio = (this.state.settings.highDPI ? window.devicePixelRatio || 1 : 1) * scale;
		const width = this.surface.width;
		const height = this.surface.height;
		exportCanvas.width = Math.floor(width * exportRatio);
		exportCanvas.height = Math.floor(height * exportRatio);
		const ctx = exportCanvas.getContext('2d');

		if (!ctx) {
			return null;
		}

		ctx.setTransform(exportRatio, 0, 0, exportRatio, 0, 0);
		this.paint({ ctx, width, height, dpr: exportRatio });

		return await new Promise((resolve) => {
			exportCanvas.toBlob((blob) => resolve(blob), 'image/png');
		});
	}

	toSVGString(): string {
		const { width, height } = this.surface;
		const range = this.visibleMathRange();
		const tokens = this.readTokens();
		const lines: string[] = [];
		const majorX = niceStep(90 / this.state.view.scaleX);
		const majorY = niceStep(90 / this.state.view.scaleY);
		const minorX = majorX / 5;
		const minorY = majorY / 5;

		if (this.state.settings.gridVisible && this.state.settings.gridStyle === 'cartesian') {
			if (this.state.settings.minorGridVisible) {
				for (let x = Math.ceil(range.xMin / minorX) * minorX; x <= range.xMax; x += minorX) {
					const [cx] = this.mathToCanvas(x, 0);
					lines.push(
						`<line x1="${cx.toFixed(2)}" y1="0" x2="${cx.toFixed(2)}" y2="${height}" stroke="${tokens.gridMinor}" stroke-opacity="0.4" stroke-width="1" />`
					);
				}

				for (let y = Math.ceil(range.yMin / minorY) * minorY; y <= range.yMax; y += minorY) {
					const [, cy] = this.mathToCanvas(0, y);
					lines.push(
						`<line x1="0" y1="${cy.toFixed(2)}" x2="${width}" y2="${cy.toFixed(2)}" stroke="${tokens.gridMinor}" stroke-opacity="0.4" stroke-width="1" />`
					);
				}
			}

			for (let x = Math.ceil(range.xMin / majorX) * majorX; x <= range.xMax; x += majorX) {
				const [cx] = this.mathToCanvas(x, 0);
				lines.push(
					`<line x1="${cx.toFixed(2)}" y1="0" x2="${cx.toFixed(2)}" y2="${height}" stroke="${tokens.gridMajor}" stroke-opacity="0.8" stroke-width="1.2" />`
				);
			}

			for (let y = Math.ceil(range.yMin / majorY) * majorY; y <= range.yMax; y += majorY) {
				const [, cy] = this.mathToCanvas(0, y);
				lines.push(
					`<line x1="0" y1="${cy.toFixed(2)}" x2="${width}" y2="${cy.toFixed(2)}" stroke="${tokens.gridMajor}" stroke-opacity="0.8" stroke-width="1.2" />`
				);
			}
		}

		if (range.xMin <= 0 && range.xMax >= 0) {
			const [axisX] = this.mathToCanvas(0, 0);
			lines.push(
				`<line x1="${axisX.toFixed(2)}" y1="0" x2="${axisX.toFixed(2)}" y2="${height}" stroke="${tokens.axis}" stroke-width="1.6" />`
			);
		}

		if (range.yMin <= 0 && range.yMax >= 0) {
			const [, axisY] = this.mathToCanvas(0, 0);
			lines.push(
				`<line x1="0" y1="${axisY.toFixed(2)}" x2="${width}" y2="${axisY.toFixed(2)}" stroke="${tokens.axis}" stroke-width="1.6" />`
			);
		}

		const curves = this.state.equations
			.filter((equation) => equation.visible && !equation.errorMessage)
			.flatMap((equation) =>
				sampleEquation(
					equation,
					range.xMin,
					range.xMax,
					Math.max(96, Math.round(width / 8)),
					780
				).map((segment) => {
					let path = '';

					for (let index = 0; index < segment.length; index += 2) {
						const [cx, cy] = this.mathToCanvas(segment[index]!, segment[index + 1]!);
						path += `${index === 0 ? 'M' : 'L'}${cx.toFixed(2)} ${cy.toFixed(2)} `;
					}

					const dash = dashPattern(equation.lineStyle);
					return `<path d="${path.trim()}" fill="none" stroke="${equation.color}" stroke-opacity="${equation.opacity}" stroke-width="${equation.lineWidth}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.join(' ')}"` : ''} />`;
				})
			)
			.join('');

		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
			`<rect width="${width}" height="${height}" fill="${this.state.settings.backgroundColor ?? tokens.canvas}" />`,
			lines.join(''),
			curves,
			`<text x="${width - 20}" y="${height - 18}" font-family="${tokens.fontSans}" font-size="12" fill="${tokens.text}" fill-opacity="0.15" text-anchor="end">Plotrix</text>`,
			'</svg>'
		].join('');
	}

	private paint(surface: SurfaceContext): void {
		surface.ctx.setTransform(surface.dpr, 0, 0, surface.dpr, 0, 0);
		surface.ctx.clearRect(0, 0, surface.width, surface.height);
		surface.ctx.imageSmoothingEnabled = this.state.settings.antialiasing;
		this.drawBackground(surface);

		if (this.state.settings.gridVisible) {
			if (this.state.settings.gridStyle === 'polar') {
				this.drawPolarGrid(surface);
			} else {
				if (this.state.settings.minorGridVisible) {
					this.drawMinorGrid(surface);
				}

				this.drawMajorGrid(surface);
			}
		}

		this.drawAxes(surface);

		if (this.state.settings.axisLabelsVisible) {
			this.drawAxisLabels(surface);
		}

		this.drawEquations(surface);

		if (this.state.settings.traceMode) {
			this.drawTracePoint(surface);
		}

		if (this.state.settings.crosshairVisible) {
			this.drawCrosshair(surface);
		}

		this.drawWatermark(surface);
	}

	private readTokens(): ThemeTokens {
		const styles = getComputedStyle(document.documentElement);
		return {
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
		const maxRadius = Math.hypot(width, height);
		const radialStep = niceStep(80 / Math.min(this.state.view.scaleX, this.state.view.scaleY));
		const pixelStep = radialStep * Math.min(this.state.view.scaleX, this.state.view.scaleY);

		ctx.save();
		ctx.strokeStyle = tokens.gridMajor;
		ctx.globalAlpha = 0.45;
		ctx.lineWidth = 1;

		for (let radius = pixelStep; radius <= maxRadius; radius += pixelStep) {
			ctx.beginPath();
			ctx.arc(this.state.view.originX, this.state.view.originY, radius, 0, Math.PI * 2);
			ctx.stroke();
		}

		for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
			ctx.beginPath();
			ctx.moveTo(this.state.view.originX, this.state.view.originY);
			ctx.lineTo(
				this.state.view.originX + Math.cos(angle) * maxRadius,
				this.state.view.originY + Math.sin(angle) * maxRadius
			);
			ctx.stroke();
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
			ctx.fillText(formatCoordinate(x), cx - 8, baselineY);
		}

		for (let y = Math.ceil(range.yMin / stepY) * stepY; y <= range.yMax; y += stepY) {
			if (Math.abs(y) < stepY / 2) continue;
			const [, cy] = this.mathToCanvas(0, y);
			ctx.fillText(formatCoordinate(y), baselineX, cy - 6);
		}

		ctx.restore();
	}

	private drawEquations(surface: SurfaceContext): void {
		for (const equation of this.state.equations) {
			if (!equation.visible || equation.errorMessage) {
				continue;
			}

			const startedAt = performance.now();
			this.drawCurve(surface, equation);
			this.state.setEquationRenderTime(equation.id, performance.now() - startedAt);
		}
	}

	private drawCurve(surface: SurfaceContext, equation: PlotEquation): void {
		const { ctx } = surface;
		const range = this.expandedMathRange();
		const baseSamples = Math.max(320, Math.round(surface.width * 0.9));
		const maxSamples = Math.max(2400, baseSamples * 6);
		const segments = sampleEquation(
			equation,
			range.xMin,
			range.xMax,
			baseSamples,
			maxSamples
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
			const points = [];

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
			ctx.font = `600 ${this.state.settings.labelSize}px ${this.readTokens().fontSans}`;
			ctx.fillStyle = equation.color;
			ctx.globalAlpha = 0.92;
			ctx.fillText(equation.label || equation.raw, labelX + 10, labelY - 10);
		}

		ctx.restore();
	}

	private drawPolyline(
		ctx: CanvasRenderingContext2D,
		points: Array<[number, number]>,
		width: number,
		height: number
	): void {
		if (points.length < 2) {
			return;
		}

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

			if (deltaX < 10 && deltaY > height * 1.35) {
				continue;
			}

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

			if (!clipped) {
				continue;
			}

			ctx.moveTo(clipped[0], clipped[1]);
			ctx.lineTo(clipped[2], clipped[3]);
		}
	}

	private drawTracePoint(surface: SurfaceContext): void {
		if (!this.ui?.tracePoint || this.state.view.isPanning || this.state.view.isAnimating) {
			return;
		}

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
		if (!this.pointer || this.state.view.isPanning || this.state.view.isAnimating) {
			return;
		}

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
		if (this.state.view.isPanning || this.state.view.isAnimating) {
			return;
		}

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
		ctx.globalAlpha = 0.72;
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.beginPath();
		ctx.fillStyle = accent;
		ctx.globalAlpha = 0.95;
		ctx.arc(clampedX + 10, clampedY + height / 2, 3, 0, Math.PI * 2);
		ctx.fill();

		ctx.fillStyle = tokens.text;
		ctx.globalAlpha = 1;
		ctx.fillText(label, clampedX + 18, clampedY + 16);
		ctx.restore();
	}

	private drawWatermark(surface: SurfaceContext): void {
		const { ctx, width, height } = surface;
		ctx.save();
		ctx.font = `700 12px ${this.readTokens().fontSans}`;
		ctx.fillStyle = this.readTokens().text;
		ctx.globalAlpha = 0.15;
		ctx.textAlign = 'right';
		ctx.fillText('Plotrix', width - 18, height - 18);
		ctx.restore();
	}
}
