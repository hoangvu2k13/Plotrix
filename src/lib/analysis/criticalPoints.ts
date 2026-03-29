import { formatSig } from '$utils/format';
import { bisect, derivative, finiteValue, secondDerivative } from '$utils/math';

export type CriticalPointKind = 'root' | 'localMin' | 'localMax' | 'inflection';

export interface CriticalPoint {
	x: number;
	y: number;
	kind: CriticalPointKind;
	label: string;
}

export interface AnalysisViewport {
	originX: number;
	originY: number;
	scaleX: number;
	scaleY: number;
	width?: number;
	height?: number;
}

const ROOT_TOLERANCE = 1e-6;
const ROOT_MERGE_TOLERANCE = 1e-4;
const MAX_MARKERS = 50;

function visibleRange(viewport: AnalysisViewport, canvasWidth: number) {
	const width = viewport.width ?? canvasWidth;
	const height = viewport.height ?? canvasWidth;
	return {
		xMin: (0 - viewport.originX) / viewport.scaleX,
		xMax: (width - viewport.originX) / viewport.scaleX,
		yMin: (viewport.originY - height) / viewport.scaleY,
		yMax: viewport.originY / viewport.scaleY
	};
}

function thirdDerivative(f: (x: number) => number, x: number): number | null {
	const step = 1e-7;
	const left = secondDerivative(f, x - step, step);
	const right = secondDerivative(f, x + step, step);

	if (left === null || right === null) {
		return null;
	}

	return (right - left) / (2 * step);
}

function pushPoint(points: CriticalPoint[], x: number, y: number, kind: CriticalPointKind): void {
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return;
	}

	if (points.some((point) => Math.abs(point.x - x) < ROOT_MERGE_TOLERANCE && point.kind === kind)) {
		return;
	}

	let label = `x = ${formatSig(x)}`;

	if (kind === 'localMax') {
		label = `max (${formatSig(x)}, ${formatSig(y)})`;
	} else if (kind === 'localMin') {
		label = `min (${formatSig(x)}, ${formatSig(y)})`;
	} else if (kind === 'inflection') {
		label = `x = ${formatSig(x)}`;
	}

	points.push({ x, y, kind, label });
}

export function analyzeCriticalPoints(
	f: (x: number) => number,
	viewport: AnalysisViewport,
	canvasWidth: number
): CriticalPoint[] {
	const range = visibleRange(viewport, canvasWidth);
	const yRange = Math.max(1e-6, range.yMax - range.yMin);
	const sampleCount = Math.max(800, Math.round(canvasWidth * 2));
	const step = sampleCount > 1 ? (range.xMax - range.xMin) / (sampleCount - 1) : 0;
	const xs = new Float64Array(sampleCount);
	const ys = new Float64Array(sampleCount);
	const d1 = new Float64Array(sampleCount);
	const d2 = new Float64Array(sampleCount);
	const points: CriticalPoint[] = [];

	for (let index = 0; index < sampleCount; index += 1) {
		const x = range.xMin + step * index;
		const y = finiteValue(f(x));
		xs[index] = x;
		ys[index] = y ?? Number.NaN;
		d1[index] = derivative(f, x) ?? Number.NaN;
		d2[index] = secondDerivative(f, x) ?? Number.NaN;
	}

	for (let index = 1; index < sampleCount && points.length < MAX_MARKERS; index += 1) {
		const x0 = xs[index - 1]!;
		const x1 = xs[index]!;
		const y0 = ys[index - 1]!;
		const y1 = ys[index]!;

		if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
			continue;
		}

		if (y0 === 0) {
			pushPoint(points, x0, y0, 'root');
			continue;
		}

		if (Math.sign(y0) === Math.sign(y1)) {
			continue;
		}

		const root = bisect((x) => finiteValue(f(x)), x0, x1);

		if (root === null) {
			continue;
		}

		const value = finiteValue(f(root));

		if (value !== null && Math.abs(value) < ROOT_TOLERANCE) {
			pushPoint(points, root, value, 'root');
		}
	}

	for (let index = 1; index < sampleCount && points.length < MAX_MARKERS; index += 1) {
		const x0 = xs[index - 1]!;
		const x1 = xs[index]!;
		const p0 = d1[index - 1]!;
		const p1 = d1[index]!;

		if (!Number.isFinite(p0) || !Number.isFinite(p1) || Math.sign(p0) === Math.sign(p1)) {
			continue;
		}

		const criticalX = bisect((x) => derivative(f, x), x0, x1);

		if (criticalX === null) {
			continue;
		}

		const criticalY = finiteValue(f(criticalX));
		const second = secondDerivative(f, criticalX);

		if (criticalY === null || second === null) {
			continue;
		}

		if (second > 1e-8) {
			pushPoint(points, criticalX, criticalY, 'localMin');
		} else if (second < -1e-8) {
			pushPoint(points, criticalX, criticalY, 'localMax');
		}
	}

	for (let index = 1; index < sampleCount && points.length < MAX_MARKERS; index += 1) {
		const x0 = xs[index - 1]!;
		const x1 = xs[index]!;
		const c0 = d2[index - 1]!;
		const c1 = d2[index]!;

		if (!Number.isFinite(c0) || !Number.isFinite(c1) || Math.sign(c0) === Math.sign(c1)) {
			continue;
		}

		const inflectionX = bisect((x) => secondDerivative(f, x), x0, x1);

		if (inflectionX === null) {
			continue;
		}

		const inflectionY = finiteValue(f(inflectionX));
		const third = thirdDerivative(f, inflectionX);

		if (inflectionY === null || third === null || Math.abs(third) <= 1e-6) {
			continue;
		}

		pushPoint(points, inflectionX, inflectionY, 'inflection');
	}

	return points
		.filter((point) => Math.abs(point.y) <= yRange * 10)
		.sort((left, right) => left.x - right.x)
		.slice(0, MAX_MARKERS);
}
