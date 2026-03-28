import { all, create, type MathNode } from 'mathjs';

import {
	analyzeCriticalPoints,
	type AnalysisViewport,
	type CriticalPoint
} from '$lib/analysis/criticalPoints';
import { formatSig } from '$utils/format';
import { cluster, derivative, finiteValue, secondDerivative } from '$utils/math';

const math = create(all!, {});

export interface EquationAnalysis {
	partial?: boolean;
	domain: string;
	range: string;
	zeros: number[];
	period: number | null;
	isEven: boolean | null;
	isOdd: boolean | null;
	verticalAsymptotes: number[];
	horizontalAsymptotes: { left: number | null; right: number | null };
	criticalPoints: CriticalPoint[];
	derivative: string;
	derivativeExpression: string | null;
	integral: string;
	integralExpression: string | null;
	isMonotone: boolean;
	isContinuous: boolean;
	curvature: string;
}

export interface EquationAnalysisInput {
	raw: string;
	node: MathNode | null;
	evaluate: (x: number) => number | null;
	viewport: AnalysisViewport & { width: number; height: number };
}

const DERIVATIVE_STEP = 1e-5;
const DOMAIN_SAMPLE_COUNT = 240;
const RANGE_SAMPLE_COUNT = 512;

function sampleRangeBuffers(
	evaluate: (x: number) => number | null,
	xMin: number,
	xMax: number,
	count: number
) {
	const step = count > 1 ? (xMax - xMin) / (count - 1) : 0;
	const xBuf = new Float64Array(count);
	const yBuf = new Float64Array(count);

	for (let index = 0; index < count; index += 1) {
		const x = xMin + step * index;
		xBuf[index] = x;
		yBuf[index] = evaluate(x) ?? Number.NaN;
	}

	return { xBuf, yBuf };
}

function viewportBounds(viewport: EquationAnalysisInput['viewport']) {
	return {
		xMin: (0 - viewport.originX) / viewport.scaleX,
		xMax: (viewport.width - viewport.originX) / viewport.scaleX
	};
}

function finiteSamplePoints(limit = 1e6): number[] {
	const points = [0];

	for (let index = 0; index < DOMAIN_SAMPLE_COUNT / 2; index += 1) {
		const ratio = index / Math.max(1, DOMAIN_SAMPLE_COUNT / 2 - 1);
		const magnitude = 10 ** (ratio * Math.log10(limit));
		points.push(magnitude, -magnitude);
	}

	return points.sort((left, right) => left - right);
}

function inferDomain(evaluate: (x: number) => number | null): { domain: string; bad: number[] } {
	const bad = finiteSamplePoints().filter((x) => evaluate(x) === null);

	if (!bad.length) {
		return { domain: 'ℝ', bad };
	}

	const negatives = bad.filter((value) => value < 0).length;
	const positives = bad.filter((value) => value > 0).length;

	if (negatives > bad.length * 0.8 && positives < Math.max(4, bad.length * 0.1)) {
		return { domain: 'x > 0', bad };
	}

	const clustered = cluster(bad, 0.5).map((value) => formatSig(value));
	const preview = clustered.slice(0, 20);
	const suffix =
		clustered.length > preview.length ? `, ... ${clustered.length - preview.length} more` : '';
	return { domain: `x ≠ ${preview.join(', ')}${suffix}`, bad };
}

function inferRange(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): string {
	const { xMin, xMax } = viewportBounds(viewport);
	const { yBuf } = sampleRangeBuffers(evaluate, xMin, xMax, RANGE_SAMPLE_COUNT);
	const samples: number[] = [];

	for (let index = 0; index < yBuf.length; index += 1) {
		const value = yBuf[index]!;

		if (Number.isFinite(value)) {
			samples.push(value);
		}
	}

	if (!samples.length) {
		return 'undefined';
	}

	const min = Math.min(...samples);
	const max = Math.max(...samples);

	if (Math.abs(max) > 1e6 || Math.abs(min) > 1e6) {
		return 'ℝ';
	}

	return `[${formatSig(min)}, ${formatSig(max)}]`;
}

function detectPeriod(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): number | null {
	const { xMin, xMax } = viewportBounds(viewport);
	const span = Math.max(1e-6, xMax - xMin);
	const { xBuf, yBuf } = sampleRangeBuffers(evaluate, xMin, xMax, 360);
	const finiteIndices: number[] = [];

	for (let index = 0; index < yBuf.length; index += 1) {
		if (Number.isFinite(yBuf[index]!)) {
			finiteIndices.push(index);
		}
	}

	if (finiteIndices.length < 40) {
		return null;
	}

	const values = finiteIndices.map((index) => yBuf[index]!);
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const centered = values.map((value) => value - mean);
	const variance = centered.reduce((sum, value) => sum + value * value, 0) / centered.length;

	if (variance < 1e-8) {
		return null;
	}

	const crossings: number[] = [];

	for (let offset = 1; offset < finiteIndices.length; offset += 1) {
		const leftIndex = finiteIndices[offset - 1]!;
		const rightIndex = finiteIndices[offset]!;
		const leftY = yBuf[leftIndex]!;
		const rightY = yBuf[rightIndex]!;

		if (Math.sign(leftY) !== Math.sign(rightY)) {
			crossings.push((xBuf[leftIndex]! + xBuf[rightIndex]!) / 2);
		}
	}

	const candidateSet = new Set<number>();
	const minPeriod = span / 80;
	const maxPeriod = span * 3;

	for (let factor = 2; factor <= 48; factor += 1) {
		candidateSet.add(span / factor);
	}

	for (let index = 1; index < crossings.length; index += 1) {
		const delta = Math.abs(crossings[index]! - crossings[index - 1]!);

		if (delta > minPeriod / 2 && delta < maxPeriod) {
			candidateSet.add(delta * 2);
		}
	}

	let bestPeriod: number | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const candidate of candidateSet) {
		if (candidate < minPeriod || candidate > maxPeriod) {
			continue;
		}

		let mse = 0;
		let count = 0;

		for (const index of finiteIndices) {
			const shifted = evaluate(xBuf[index]! + candidate);

			if (shifted === null) {
				continue;
			}

			const error = yBuf[index]! - shifted;
			mse += error * error;
			count += 1;
		}

		if (!count) {
			continue;
		}

		const normalized = mse / count / variance;

		if (normalized < bestScore) {
			bestScore = normalized;
			bestPeriod = candidate;
		}
	}

	return bestScore < 0.02 ? bestPeriod : null;
}

function detectSymmetry(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
) {
	const { xMin, xMax } = viewportBounds(viewport);
	let even = true;
	let odd = true;

	for (let index = 0; index < 120; index += 1) {
		const x = xMin + ((xMax - xMin) * (index + 0.5)) / 120;
		const y = evaluate(x);
		const mirrored = evaluate(-x);

		if (y === null || mirrored === null) {
			continue;
		}

		if (Math.abs(y - mirrored) > 1e-6) {
			even = false;
		}

		if (Math.abs(y + mirrored) > 1e-6) {
			odd = false;
		}
	}

	return { isEven: even ? true : null, isOdd: odd ? true : null };
}

function derivativeAt(evaluate: (x: number) => number | null, x: number): number | null {
	return derivative((value) => evaluate(value) ?? Number.NaN, x, DERIVATIVE_STEP);
}

function secondDerivativeAt(evaluate: (x: number) => number | null, x: number): number | null {
	return secondDerivative((value) => evaluate(value) ?? Number.NaN, x, DERIVATIVE_STEP);
}

function detectVerticalAsymptotes(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): number[] {
	const { xMin, xMax } = viewportBounds(viewport);
	const span = Math.max(1, xMax - xMin);
	const rangeMin = xMin - span;
	const rangeMax = xMax + span;
	const { xBuf, yBuf } = sampleRangeBuffers(evaluate, rangeMin, rangeMax, 320);
	const candidates: number[] = [];

	for (let index = 1; index < xBuf.length; index += 1) {
		const leftX = xBuf[index - 1]!;
		const rightX = xBuf[index]!;
		const leftY = yBuf[index - 1]!;
		const rightY = yBuf[index]!;

		if (!Number.isFinite(leftY) || !Number.isFinite(rightY)) {
			candidates.push((leftX + rightX) / 2);
			continue;
		}

		const slope = Math.abs((rightY - leftY) / Math.max(1e-6, rightX - leftX));
		const diverging = Math.max(Math.abs(leftY), Math.abs(rightY)) > Math.max(200, span * 10);

		if (slope > 300 && diverging) {
			candidates.push((leftX + rightX) / 2);
		}
	}

	return cluster(candidates, Math.max(0.04, span / 500));
}

function detectHorizontalAsymptotes(evaluate: (x: number) => number | null) {
	const probe = (direction: -1 | 1) => {
		const samples = [1e2, 1e3, 1e4, 1e5, 1e6]
			.map((value) => finiteValue(evaluate(direction * value) ?? Number.NaN))
			.filter((value): value is number => value !== null);

		if (samples.length < 3) {
			return null;
		}

		const tail = samples.slice(-3);
		const spread = Math.max(...tail) - Math.min(...tail);
		return spread < 1e-3 ? tail[tail.length - 1]! : null;
	};

	return { left: probe(-1), right: probe(1) };
}

function latexFromNode(node: MathNode | null): string {
	if (!node) {
		return 'numerical';
	}

	try {
		return node.toTex({ parenthesis: 'auto' });
	} catch {
		return 'numerical';
	}
}

function derivativeExpression(node: MathNode | null): {
	display: string;
	expression: string | null;
} {
	if (!node) {
		return { display: 'numerical derivative', expression: null };
	}

	try {
		const expression = math.derivative(node, 'x').toString();
		return { display: expression, expression };
	} catch {
		return { display: 'numerical derivative', expression: null };
	}
}

function simpsonIntegral(
	evaluate: (x: number) => number | null,
	xMin: number,
	xMax: number,
	steps = 64
): number | null {
	const evenSteps = Math.max(2, steps + (steps % 2));
	const h = (xMax - xMin) / evenSteps;
	let sum = 0;

	for (let index = 0; index <= evenSteps; index += 1) {
		const x = xMin + index * h;
		const y = evaluate(x);

		if (y === null || !Number.isFinite(y)) {
			return null;
		}

		if (index === 0 || index === evenSteps) {
			sum += y;
		} else if (index % 2 === 0) {
			sum += 2 * y;
		} else {
			sum += 4 * y;
		}
	}

	return (h / 3) * sum;
}

function simpsonEstimate(a: number, b: number, fa: number, fm: number, fb: number): number {
	return ((b - a) / 6) * (fa + 4 * fm + fb);
}

function adaptiveSimpsonRecursive(
	evaluate: (x: number) => number | null,
	a: number,
	b: number,
	fa: number,
	fm: number,
	fb: number,
	whole: number,
	depth: number
): number | null {
	const midpoint = (a + b) / 2;
	const leftMidpoint = (a + midpoint) / 2;
	const rightMidpoint = (midpoint + b) / 2;
	const fLeftMidpoint = evaluate(leftMidpoint);
	const fRightMidpoint = evaluate(rightMidpoint);

	if (
		fLeftMidpoint === null ||
		fRightMidpoint === null ||
		!Number.isFinite(fLeftMidpoint) ||
		!Number.isFinite(fRightMidpoint)
	) {
		return null;
	}

	const left = simpsonEstimate(a, midpoint, fa, fLeftMidpoint, fm);
	const right = simpsonEstimate(midpoint, b, fm, fRightMidpoint, fb);
	const refined = left + right;

	if (depth <= 0 || Math.abs(refined - whole) < 1e-6 * Math.max(1, Math.abs(refined))) {
		return refined + (refined - whole) / 15;
	}

	const leftIntegral = adaptiveSimpsonRecursive(
		evaluate,
		a,
		midpoint,
		fa,
		fLeftMidpoint,
		fm,
		left,
		depth - 1
	);
	const rightIntegral = adaptiveSimpsonRecursive(
		evaluate,
		midpoint,
		b,
		fm,
		fRightMidpoint,
		fb,
		right,
		depth - 1
	);

	if (leftIntegral === null || rightIntegral === null) {
		return null;
	}

	return leftIntegral + rightIntegral;
}

function adaptiveSimpsonIntegral(
	evaluate: (x: number) => number | null,
	a: number,
	b: number,
	depth = 10
): number | null {
	const fa = evaluate(a);
	const fb = evaluate(b);
	const midpoint = (a + b) / 2;
	const fm = evaluate(midpoint);

	if (
		fa === null ||
		fb === null ||
		fm === null ||
		!Number.isFinite(fa) ||
		!Number.isFinite(fb) ||
		!Number.isFinite(fm)
	) {
		return null;
	}

	return adaptiveSimpsonRecursive(
		evaluate,
		a,
		b,
		fa,
		fm,
		fb,
		simpsonEstimate(a, b, fa, fm, fb),
		depth
	);
}

function integrateVisibleFiniteIntervals(
	evaluate: (x: number) => number | null,
	xMin: number,
	xMax: number
): { value: number; coverage: number } | null {
	const probes = 96;
	const step = (xMax - xMin) / probes;
	let total = 0;
	let coveredWidth = 0;

	for (let index = 0; index < probes; index += 1) {
		const a = xMin + step * index;
		const b = a + step;
		const midpoint = (a + b) / 2;
		const fa = evaluate(a);
		const fb = evaluate(b);
		const fm = evaluate(midpoint);

		if (
			fa === null ||
			fb === null ||
			fm === null ||
			!Number.isFinite(fa) ||
			!Number.isFinite(fb) ||
			!Number.isFinite(fm)
		) {
			continue;
		}

		const integral =
			adaptiveSimpsonIntegral(evaluate, a, b, 8) ?? simpsonIntegral(evaluate, a, b, 12);

		if (integral === null || !Number.isFinite(integral)) {
			continue;
		}

		total += integral;
		coveredWidth += b - a;
	}

	if (coveredWidth <= 0) {
		return null;
	}

	return {
		value: total,
		coverage: coveredWidth / Math.max(1e-6, xMax - xMin)
	};
}

function symbolicPrimitive(
	node: MathNode | null
): { display: string; expression: string | null } | null {
	const source = node?.toString() ?? '';

	if (/^sin\(x\)$/.test(source)) {
		return { display: '-cos(x) + C', expression: '-cos(x)' };
	}

	if (/^cos\(x\)$/.test(source)) {
		return { display: 'sin(x) + C', expression: 'sin(x)' };
	}

	if (/^exp\(x\)$/.test(source) || /^e\^x$/.test(source)) {
		return { display: 'exp(x) + C', expression: 'exp(x)' };
	}

	if (/^x$/.test(source)) {
		return { display: '(x^2) / 2 + C', expression: '(x^2) / 2' };
	}

	return null;
}

function integralSummary(input: EquationAnalysisInput): {
	display: string;
	expression: string | null;
} {
	const { xMin, xMax } = viewportBounds(input.viewport);
	const symbolic = symbolicPrimitive(input.node);

	if (symbolic) {
		return symbolic;
	}

	const area = integrateVisibleFiniteIntervals(input.evaluate, xMin, xMax);

	if (!area) {
		return {
			display: `Numerical integral unavailable on [${formatSig(xMin)}, ${formatSig(xMax)}]`,
			expression: null
		};
	}

	return {
		display:
			area.coverage >= 0.98
				? `∫[${formatSig(xMin)}, ${formatSig(xMax)}] f(x) dx ≈ ${formatSig(area.value, 5)}`
				: `∫ over finite visible intervals ≈ ${formatSig(area.value, 5)} (${Math.round(area.coverage * 100)}% coverage)`,
		expression: null
	};
}

export function createPartialEquationAnalysis(
	viewport: EquationAnalysisInput['viewport'],
	criticalPoints: CriticalPoint[]
): EquationAnalysis {
	const { xMin, xMax } = viewportBounds(viewport);

	return {
		partial: true,
		domain: 'Computing…',
		range: 'Computing…',
		zeros: criticalPoints.filter((point) => point.kind === 'root').map((point) => point.x),
		period: null,
		isEven: null,
		isOdd: null,
		verticalAsymptotes: [],
		horizontalAsymptotes: { left: null, right: null },
		criticalPoints,
		derivative: `Computing derivative over [${formatSig(xMin)}, ${formatSig(xMax)}]…`,
		derivativeExpression: null,
		integral: `Computing integral over [${formatSig(xMin)}, ${formatSig(xMax)}]…`,
		integralExpression: null,
		isMonotone: false,
		isContinuous: false,
		curvature: 'Computing…'
	};
}

export function analyzeEquation(input: EquationAnalysisInput): EquationAnalysis {
	const viewport = input.viewport;
	const { xMin, xMax } = viewportBounds(viewport);
	const criticalPoints = analyzeCriticalPoints(
		(x) => input.evaluate(x) ?? Number.NaN,
		viewport,
		viewport.width
	);
	const zeros = criticalPoints.filter((point) => point.kind === 'root').map((point) => point.x);
	const { domain } = inferDomain(input.evaluate);
	const range = inferRange(input.evaluate, viewport);
	const period = detectPeriod(input.evaluate, viewport);
	const symmetry = detectSymmetry(input.evaluate, viewport);
	const verticalAsymptotes = detectVerticalAsymptotes(input.evaluate, viewport);
	const horizontalAsymptotes = detectHorizontalAsymptotes(input.evaluate);
	const derivative = derivativeExpression(input.node);
	const integral = integralSummary(input);
	let positive = 0;
	let negative = 0;
	let monotone = true;
	let hasNaN = false;
	let allPositive = true;
	let allNegative = true;

	for (let index = 0; index < 240; index += 1) {
		const x = xMin + ((xMax - xMin) * index) / 239;
		const y = input.evaluate(x);

		if (y === null) {
			hasNaN = true;
			continue;
		}

		const d1 = derivativeAt(input.evaluate, x);
		const d2 = secondDerivativeAt(input.evaluate, x);

		if (d1 === null || Math.abs(d1) < 1e-6) {
			monotone = false;
		} else {
			allPositive = allPositive && d1 > 0;
			allNegative = allNegative && d1 < 0;
		}

		if (d2 !== null) {
			if (d2 > 0) positive += 1;
			if (d2 < 0) negative += 1;
		}
	}

	return {
		partial: false,
		domain,
		range,
		zeros,
		period,
		isEven: symmetry.isEven,
		isOdd: symmetry.isOdd,
		verticalAsymptotes,
		horizontalAsymptotes,
		criticalPoints,
		derivative: derivative.display,
		derivativeExpression: derivative.expression,
		integral: integral.display,
		integralExpression: integral.expression,
		isMonotone: monotone && (allPositive || allNegative),
		isContinuous: verticalAsymptotes.length === 0 && !hasNaN,
		curvature: positive > negative ? 'concave up' : negative > positive ? 'concave down' : 'mixed'
	};
}

export function equationToLatex(node: MathNode | null): string {
	return latexFromNode(node);
}
