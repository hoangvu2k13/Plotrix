import type { EquationKind, ParametricNodes } from '$lib/math/engine';
import { formatDisplay } from '$utils/format';
import { bisect } from '$utils/math';

export interface IntersectionPoint {
	x: number;
	y: number;
	eqAId: string;
	eqBId: string;
	label: string;
}

export interface IntersectionViewport {
	originX: number;
	originY: number;
	scaleX: number;
	scaleY: number;
	width: number;
	height: number;
}

export interface IntersectionEquation {
	id: string;
	kind: EquationKind;
	color: string;
	evaluate?: (x: number) => number | null;
	evaluatePolar?: (t: number) => number | null;
	evaluateParametric?: (t: number) => { x: number; y: number } | null;
	paramRange?: [number, number];
	parametricNodes?: ParametricNodes | null;
}

interface SampledPoint {
	x: number;
	y: number;
	t: number;
}

const MAX_TOTAL = 20;

function formatIntersectionValue(value: number, span: number): string {
	if (!Number.isFinite(value)) {
		return 'NaN';
	}

	if (Math.abs(value) < 10_000) {
		return formatDisplay(value);
	}

	const decimals = Math.max(0, Math.min(4, 3 - Math.floor(Math.log10(Math.max(span, 1)))));
	return value.toFixed(decimals);
}

function formatIntersectionLabel(x: number, y: number, viewport: IntersectionViewport): string {
	const range = visibleRange(viewport);
	const xSpan = Math.max(1, range.xMax - range.xMin);
	const ySpan = Math.max(1, viewport.height / Math.max(viewport.scaleY, 1e-6));
	return `(${formatIntersectionValue(x, xSpan)}, ${formatIntersectionValue(y, ySpan)})`;
}

function visibleRange(viewport: IntersectionViewport) {
	return {
		xMin: (0 - viewport.originX) / viewport.scaleX,
		xMax: (viewport.width - viewport.originX) / viewport.scaleX
	};
}

function dedupe(points: IntersectionPoint[]): IntersectionPoint[] {
	const result: IntersectionPoint[] = [];

	for (const point of points) {
		if (result.some((entry) => Math.hypot(entry.x - point.x, entry.y - point.y) < 1e-4)) {
			continue;
		}

		result.push(point);
	}

	return result;
}

function sampleParametric(
	evaluate: (t: number) => { x: number; y: number } | null,
	range: [number, number],
	count = 2000
): SampledPoint[] {
	const points: SampledPoint[] = [];
	const step = count > 1 ? (range[1] - range[0]) / (count - 1) : 0;

	for (let index = 0; index < count; index += 1) {
		const t = range[0] + step * index;
		const point = evaluate(t);

		if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
			continue;
		}

		points.push({ ...point, t });
	}

	return points;
}

class KdNode {
	constructor(
		readonly point: SampledPoint,
		readonly axis: 0 | 1,
		readonly left: KdNode | null,
		readonly right: KdNode | null
	) {}
}

function buildKdTree(points: SampledPoint[], depth = 0): KdNode | null {
	if (!points.length) {
		return null;
	}

	const axis = (depth % 2) as 0 | 1;
	const sorted = [...points].sort((left, right) =>
		axis === 0 ? left.x - right.x : left.y - right.y
	);
	const mid = Math.floor(sorted.length / 2);
	return new KdNode(
		sorted[mid]!,
		axis,
		buildKdTree(sorted.slice(0, mid), depth + 1),
		buildKdTree(sorted.slice(mid + 1), depth + 1)
	);
}

function nearestKd(
	node: KdNode | null,
	target: SampledPoint,
	best: { point: SampledPoint | null; distance: number } = {
		point: null,
		distance: Number.POSITIVE_INFINITY
	}
): { point: SampledPoint | null; distance: number } {
	if (!node) {
		return best;
	}

	const distance = Math.hypot(node.point.x - target.x, node.point.y - target.y);

	if (distance < best.distance) {
		best = { point: node.point, distance };
	}

	const axisDistance = node.axis === 0 ? target.x - node.point.x : target.y - node.point.y;
	const primary = axisDistance < 0 ? node.left : node.right;
	const secondary = axisDistance < 0 ? node.right : node.left;
	best = nearestKd(primary, target, best);

	if (Math.abs(axisDistance) < best.distance) {
		best = nearestKd(secondary, target, best);
	}

	return best;
}

function refineParametricIntersection(
	evaluateA: (t: number) => { x: number; y: number } | null,
	evaluateB: (t: number) => { x: number; y: number } | null,
	t1: number,
	t2: number
): { x: number; y: number } | null {
	const step = 1e-5;

	for (let iteration = 0; iteration < 20; iteration += 1) {
		const a = evaluateA(t1);
		const b = evaluateB(t2);
		const aDx = evaluateA(t1 + step);
		const aDy = evaluateA(t1 - step);
		const bDx = evaluateB(t2 + step);
		const bDy = evaluateB(t2 - step);

		if (!a || !b || !aDx || !aDy || !bDx || !bDy) {
			return null;
		}

		const rx = a.x - b.x;
		const ry = a.y - b.y;

		if (Math.hypot(rx, ry) < 1e-8) {
			return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		}

		const dax = (aDx.x - aDy.x) / (2 * step);
		const day = (aDx.y - aDy.y) / (2 * step);
		const dbx = (bDx.x - bDy.x) / (2 * step);
		const dby = (bDx.y - bDy.y) / (2 * step);

		const j11 = dax;
		const j12 = -dbx;
		const j21 = day;
		const j22 = -dby;
		const determinant = j11 * j22 - j12 * j21;

		if (Math.abs(determinant) < 1e-12) {
			break;
		}

		const delta1 = (-rx * j22 + j12 * ry) / determinant;
		const delta2 = (-j11 * ry + j21 * rx) / determinant;

		t1 += delta1;
		t2 += delta2;

		if (Math.hypot(delta1, delta2) < 1e-8) {
			const finalA = evaluateA(t1);
			const finalB = evaluateB(t2);

			if (!finalA || !finalB) {
				return null;
			}

			return {
				x: (finalA.x + finalB.x) / 2,
				y: (finalA.y + finalB.y) / 2
			};
		}
	}

	const finalA = evaluateA(t1);
	const finalB = evaluateB(t2);

	if (!finalA || !finalB) {
		return null;
	}

	if (Math.hypot(finalA.x - finalB.x, finalA.y - finalB.y) > 1e-4) {
		return null;
	}

	return {
		x: (finalA.x + finalB.x) / 2,
		y: (finalA.y + finalB.y) / 2
	};
}

function findCartesianIntersections(
	left: IntersectionEquation,
	right: IntersectionEquation,
	viewport: IntersectionViewport
): IntersectionPoint[] {
	if (!left.evaluate || !right.evaluate) {
		return [];
	}

	const range = visibleRange(viewport);
	const sampleCount = 1000;
	const step = (range.xMax - range.xMin) / (sampleCount - 1);
	const points: IntersectionPoint[] = [];
	let minLeft = Number.POSITIVE_INFINITY;
	let maxLeft = Number.NEGATIVE_INFINITY;
	let minRight = Number.POSITIVE_INFINITY;
	let maxRight = Number.NEGATIVE_INFINITY;

	for (let index = 0; index < sampleCount; index += 1) {
		const x = range.xMin + step * index;
		const leftY = left.evaluate(x);
		const rightY = right.evaluate(x);

		if (leftY !== null) {
			minLeft = Math.min(minLeft, leftY);
			maxLeft = Math.max(maxLeft, leftY);
		}

		if (rightY !== null) {
			minRight = Math.min(minRight, rightY);
			maxRight = Math.max(maxRight, rightY);
		}
	}

	if (
		Number.isFinite(minLeft) &&
		Number.isFinite(maxLeft) &&
		Number.isFinite(minRight) &&
		Number.isFinite(maxRight) &&
		(minLeft > maxRight || maxLeft < minRight)
	) {
		return [];
	}

	for (let index = 1; index < sampleCount && points.length < MAX_TOTAL; index += 1) {
		const x0 = range.xMin + step * (index - 1);
		const x1 = x0 + step;
		const g0 = left.evaluate(x0);
		const g1 = left.evaluate(x1);
		const h0 = right.evaluate(x0);
		const h1 = right.evaluate(x1);

		if (g0 === null || g1 === null || h0 === null || h1 === null) {
			continue;
		}

		const d0 = g0 - h0;
		const d1 = g1 - h1;

		if (Math.sign(d0) === Math.sign(d1)) {
			continue;
		}

		const x = bisect(
			(value) => {
				const leftY = left.evaluate?.(value);
				const rightY = right.evaluate?.(value);
				return leftY == null || rightY == null ? null : leftY - rightY;
			},
			x0,
			x1
		);

		if (x === null) {
			continue;
		}

		const yA = left.evaluate(x);
		const yB = right.evaluate(x);

		if (yA === null || yB === null) {
			continue;
		}

		const y = (yA + yB) / 2;
		points.push({
			x,
			y,
			eqAId: left.id,
			eqBId: right.id,
			label: formatIntersectionLabel(x, y, viewport)
		});
	}

	return dedupe(points);
}

function interpolateParametricYForX(
	evaluate: (t: number) => { x: number; y: number } | null,
	range: [number, number],
	x: number
): number | null {
	const samples = 512;
	const step = (range[1] - range[0]) / (samples - 1);
	let previous = evaluate(range[0]);

	for (let index = 1; index < samples; index += 1) {
		const t = range[0] + step * index;
		const current = evaluate(t);

		if (previous && current) {
			const between =
				(x >= Math.min(previous.x, current.x) && x <= Math.max(previous.x, current.x)) ||
				Math.abs(previous.x - x) < 1e-6 ||
				Math.abs(current.x - x) < 1e-6;

			if (between && Math.abs(current.x - previous.x) > 1e-8) {
				const ratio = (x - previous.x) / (current.x - previous.x);
				return previous.y + (current.y - previous.y) * ratio;
			}
		}

		previous = current;
	}

	return null;
}

function findCartesianVsParametric(
	cartesian: IntersectionEquation,
	parametric: IntersectionEquation,
	viewport: IntersectionViewport
): IntersectionPoint[] {
	if (!cartesian.evaluate || !parametric.evaluateParametric || !parametric.paramRange) {
		return [];
	}

	const projected: IntersectionEquation = {
		id: parametric.id,
		kind: 'cartesian',
		color: parametric.color,
		evaluate: (x) =>
			interpolateParametricYForX(parametric.evaluateParametric!, parametric.paramRange!, x)
	};

	return findCartesianIntersections(cartesian, projected, viewport).map((point) => ({
		...point,
		eqAId: cartesian.id,
		eqBId: parametric.id
	}));
}

function findParametricIntersections(
	left: IntersectionEquation,
	right: IntersectionEquation,
	viewport: IntersectionViewport
): IntersectionPoint[] {
	if (
		!left.evaluateParametric ||
		!right.evaluateParametric ||
		!left.paramRange ||
		!right.paramRange
	) {
		return [];
	}

	const aPoints = sampleParametric(left.evaluateParametric, left.paramRange);
	const bPoints = sampleParametric(right.evaluateParametric, right.paramRange);
	const tree = buildKdTree(bPoints);
	const points: IntersectionPoint[] = [];

	for (const point of aPoints) {
		if (points.length >= MAX_TOTAL) {
			break;
		}

		const nearest = nearestKd(tree, point);

		if (!nearest.point || nearest.distance >= 0.5) {
			continue;
		}

		const refined = refineParametricIntersection(
			left.evaluateParametric,
			right.evaluateParametric,
			point.t,
			nearest.point.t
		);

		if (!refined) {
			continue;
		}

		points.push({
			x: refined.x,
			y: refined.y,
			eqAId: left.id,
			eqBId: right.id,
			label: formatIntersectionLabel(refined.x, refined.y, viewport)
		});
	}

	return dedupe(points);
}

export function findIntersections(
	equations: IntersectionEquation[],
	viewport: IntersectionViewport,
	limit = MAX_TOTAL
): IntersectionPoint[] {
	const points: IntersectionPoint[] = [];

	for (let index = 0; index < equations.length; index += 1) {
		for (let second = index + 1; second < equations.length; second += 1) {
			if (points.length >= limit) {
				return points.slice(0, limit);
			}

			const left = equations[index]!;
			const right = equations[second]!;
			let pairPoints: IntersectionPoint[] = [];

			if (left.kind === 'cartesian' && right.kind === 'cartesian') {
				pairPoints = findCartesianIntersections(left, right, viewport);
			} else if (left.kind === 'parametric' && right.kind === 'parametric') {
				pairPoints = findParametricIntersections(left, right, viewport);
			} else if (left.kind === 'cartesian' && right.kind === 'parametric') {
				pairPoints = findCartesianVsParametric(left, right, viewport);
			} else if (left.kind === 'parametric' && right.kind === 'cartesian') {
				pairPoints = findCartesianVsParametric(right, left, viewport).map((point) => ({
					...point,
					eqAId: left.id,
					eqBId: right.id
				}));
			}

			points.push(...pairPoints);
		}
	}

	return dedupe(points).slice(0, limit);
}
