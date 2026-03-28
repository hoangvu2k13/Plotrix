import { all, create, type MathNode } from 'mathjs';

import {
	analyzeCriticalPoints,
	type AnalysisViewport,
	type CriticalPoint
} from '$lib/analysis/criticalPoints';
import { formatSig } from '$utils/format';

const math = create(all!, {});

export interface EquationAnalysis {
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

function sampleRange(
	evaluate: (x: number) => number | null,
	xMin: number,
	xMax: number,
	count: number
) {
	const values: Array<{ x: number; y: number | null }> = [];
	const step = count > 1 ? (xMax - xMin) / (count - 1) : 0;

	for (let index = 0; index < count; index += 1) {
		const x = xMin + step * index;
		values.push({ x, y: evaluate(x) });
	}

	return values;
}

function cluster(values: number[], gap = 0.02): number[] {
	if (!values.length) {
		return [];
	}

	const sorted = [...values].sort((left, right) => left - right);
	const buckets: number[][] = [[sorted[0]!]];

	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index]!;
		const lastBucket = buckets[buckets.length - 1]!;
		const last = lastBucket[lastBucket.length - 1]!;

		if (Math.abs(current - last) <= gap) {
			lastBucket.push(current);
		} else {
			buckets.push([current]);
		}
	}

	return buckets.map((bucket) => bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
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
	return { domain: `x ≠ ${clustered.join(', ')}`, bad };
}

function inferRange(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): string {
	const { xMin, xMax } = viewportBounds(viewport);
	const samples = sampleRange(evaluate, xMin, xMax, RANGE_SAMPLE_COUNT)
		.map((entry) => entry.y)
		.filter((value): value is number => value !== null);

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
	const samples = sampleRange(evaluate, xMin, xMax, 360);
	const finite = samples.filter((entry): entry is { x: number; y: number } => entry.y !== null);

	if (finite.length < 40) {
		return null;
	}

	const values = finite.map((entry) => entry.y);
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const centered = values.map((value) => value - mean);
	const variance = centered.reduce((sum, value) => sum + value * value, 0) / centered.length;

	if (variance < 1e-8) {
		return null;
	}

	const crossings: number[] = [];

	for (let index = 1; index < finite.length; index += 1) {
		const left = finite[index - 1]!;
		const right = finite[index]!;

		if (Math.sign(left.y) !== Math.sign(right.y)) {
			crossings.push((left.x + right.x) / 2);
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

		for (const sample of finite) {
			const shifted = evaluate(sample.x + candidate);

			if (shifted === null) {
				continue;
			}

			const error = sample.y - shifted;
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
	const left = evaluate(x - DERIVATIVE_STEP);
	const right = evaluate(x + DERIVATIVE_STEP);

	if (left === null || right === null) {
		return null;
	}

	return (right - left) / (2 * DERIVATIVE_STEP);
}

function secondDerivativeAt(evaluate: (x: number) => number | null, x: number): number | null {
	const left = evaluate(x - DERIVATIVE_STEP);
	const center = evaluate(x);
	const right = evaluate(x + DERIVATIVE_STEP);

	if (left === null || center === null || right === null) {
		return null;
	}

	return (left - 2 * center + right) / (DERIVATIVE_STEP * DERIVATIVE_STEP);
}

function detectVerticalAsymptotes(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): number[] {
	const { xMin, xMax } = viewportBounds(viewport);
	const span = Math.max(1, xMax - xMin);
	const rangeMin = xMin - span;
	const rangeMax = xMax + span;
	const samples = sampleRange(evaluate, rangeMin, rangeMax, 320);
	const candidates: number[] = [];

	for (let index = 1; index < samples.length; index += 1) {
		const left = samples[index - 1]!;
		const right = samples[index]!;

		if (left.y === null || right.y === null) {
			candidates.push((left.x + right.x) / 2);
			continue;
		}

		const slope = Math.abs((right.y - left.y) / Math.max(1e-6, right.x - left.x));
		const diverging = Math.max(Math.abs(left.y), Math.abs(right.y)) > Math.max(200, span * 10);

		if (slope > 300 && diverging) {
			candidates.push((left.x + right.x) / 2);
		}
	}

	return cluster(candidates, Math.max(0.04, span / 500));
}

function detectHorizontalAsymptotes(evaluate: (x: number) => number | null) {
	const probe = (direction: -1 | 1) => {
		const samples = [1e2, 1e3, 1e4, 1e5, 1e6]
			.map((value) => evaluate(direction * value))
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
	steps = 256
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

function integralSummary(input: EquationAnalysisInput): {
	display: string;
	expression: string | null;
} {
	const { xMin, xMax } = viewportBounds(input.viewport);
	const source = input.node?.toString() ?? '';

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

	const area = simpsonIntegral(input.evaluate, xMin, xMax);

	if (area === null) {
		return {
			display: `Numerical integral unavailable on [${formatSig(xMin)}, ${formatSig(xMax)}]`,
			expression: null
		};
	}

	return {
		display: `∫[${formatSig(xMin)}, ${formatSig(xMax)}] f(x) dx ≈ ${formatSig(area, 5)} (Simpson)`,
		expression: null
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
