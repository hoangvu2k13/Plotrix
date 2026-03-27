import { all, create, type MathNode } from 'mathjs';

import {
	analyzeCriticalPoints,
	type AnalysisViewport,
	type CriticalPoint
} from '$lib/analysis/criticalPoints';

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
	integral: string;
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

function formatSig(value: number): string {
	return Number.isFinite(value) ? value.toPrecision(3) : 'NaN';
}

function sampleRange(evaluate: (x: number) => number | null, xMin: number, xMax: number, count: number) {
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
	const clusters: number[][] = [[sorted[0]!]];

	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index]!;
		const lastCluster = clusters[clusters.length - 1]!;
		const lastValue = lastCluster[lastCluster.length - 1]!;

		if (Math.abs(current - lastValue) <= gap) {
			lastCluster.push(current);
		} else {
			clusters.push([current]);
		}
	}

	return clusters.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
}

function inferDomain(evaluate: (x: number) => number | null): { domain: string; bad: number[] } {
	const bad: number[] = [];
	const samples = sampleRange(evaluate, -1000, 1000, 2000);

	for (const sample of samples) {
		if (sample.y === null) {
			bad.push(sample.x);
		}
	}

	if (!bad.length) {
		return { domain: 'ℝ', bad };
	}

	const negatives = bad.filter((value) => value < 0).length;
	const positives = bad.filter((value) => value > 0).length;

	if (negatives > 950 && positives < 20) {
		return { domain: 'x > 0', bad };
	}

	const clustered = cluster(bad, 2).map((value) => formatSig(value));
	return { domain: `x ≠ ${clustered.join(', ')}`, bad };
}

function inferRange(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
): string {
	const xMin = (0 - viewport.originX) / viewport.scaleX;
	const xMax = (viewport.width - viewport.originX) / viewport.scaleX;
	const samples = sampleRange(evaluate, xMin, xMax, 2000)
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
	const xMin = (0 - viewport.originX) / viewport.scaleX;
	const xMax = (viewport.width - viewport.originX) / viewport.scaleX;
	const span = xMax - xMin;

	for (let divisor = 1; divisor <= 20; divisor += 1) {
		const period = span / divisor;
		let mse = 0;
		let count = 0;

		for (let index = 0; index < 200; index += 1) {
			const x = xMin + (span * index) / 199;
			const y0 = evaluate(x);
			const y1 = evaluate(x + period);

			if (y0 === null || y1 === null) {
				continue;
			}

			mse += (y0 - y1) ** 2;
			count += 1;
		}

		if (count > 0 && mse / count < 1e-6) {
			return period;
		}
	}

	return null;
}

function detectSymmetry(
	evaluate: (x: number) => number | null,
	viewport: EquationAnalysisInput['viewport']
) {
	const xMin = (0 - viewport.originX) / viewport.scaleX;
	const xMax = (viewport.width - viewport.originX) / viewport.scaleX;
	let even = true;
	let odd = true;

	for (let index = 0; index < 100; index += 1) {
		const ratio = (index + 0.5) / 100;
		const x = xMin + (xMax - xMin) * ratio;
		const y0 = evaluate(x);
		const yn = evaluate(-x);

		if (y0 === null || yn === null) {
			continue;
		}

		if (Math.abs(yn - y0) > 1e-8) {
			even = false;
		}

		if (Math.abs(yn + y0) > 1e-8) {
			odd = false;
		}
	}

	return { isEven: even ? true : null, isOdd: odd ? true : null };
}

function detectVerticalAsymptotes(evaluate: (x: number) => number | null): number[] {
	const candidates: number[] = [];
	const step = 0.5;
	let previous = evaluate(-100);

	for (let x = -100 + step; x <= 100; x += step) {
		const current = evaluate(x);

		if (
			previous !== null &&
			current !== null &&
			Math.abs(current - previous) > 100
		) {
			for (let offset = -0.01; offset <= 0.01; offset += 1e-3) {
				const left = evaluate(x + offset - 1e-5);
				const right = evaluate(x + offset + 1e-5);

				if (
					left !== null &&
					right !== null &&
					(Math.abs(left) > 1e4 || Math.abs(right) > 1e4)
				) {
					candidates.push(x + offset);
					break;
				}
			}
		}

		previous = current;
	}

	return cluster(candidates, 0.05);
}

function detectHorizontalAsymptotes(evaluate: (x: number) => number | null) {
	const probe = (direction: -1 | 1) => {
		const samples = [100, 1000, 1e6, 1e9]
			.map((value) => evaluate(direction * value))
			.filter((value): value is number => value !== null);

		if (samples.length < 3) {
			return null;
		}

		const tail = samples.slice(-3);
		const spread = Math.max(...tail) - Math.min(...tail);
		return spread < 1e-4 ? tail[tail.length - 1]! : null;
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

function symbolicDerivative(node: MathNode | null): string {
	if (!node) {
		return 'numerical';
	}

	try {
		return math.derivative(node, 'x').toString();
	} catch {
		return 'numerical';
	}
}

function symbolicIntegral(node: MathNode | null): string {
	if (!node) {
		return "numerical (Simpson's rule)";
	}

	const source = node.toString();

	if (/^sin\(x\)$/.test(source)) {
		return '-cos(x) + C';
	}

	if (/^cos\(x\)$/.test(source)) {
		return 'sin(x) + C';
	}

	if (/^exp\(x\)$/.test(source) || /^e\^x$/.test(source)) {
		return 'e^x + C';
	}

	if (/^x$/.test(source)) {
		return '(x^2) / 2 + C';
	}

	if (/^x\^(-?\d+)$/.test(source)) {
		const power = Number(source.match(/^x\^(-?\d+)$/)?.[1] ?? '0');

		if (power === -1) {
			return 'ln(abs(x)) + C';
		}

		return `x^${power + 1} / ${power + 1} + C`;
	}

	if (/^\d+(\.\d+)?$/.test(source)) {
		return `${source}x + C`;
	}

	return "numerical (Simpson's rule)";
}

function derivativeAt(evaluate: (x: number) => number | null, x: number): number | null {
	const h = 1e-7;
	const left = evaluate(x - h);
	const right = evaluate(x + h);

	if (left === null || right === null) {
		return null;
	}

	return (right - left) / (2 * h);
}

function secondDerivativeAt(evaluate: (x: number) => number | null, x: number): number | null {
	const h = 1e-7;
	const left = evaluate(x - h);
	const center = evaluate(x);
	const right = evaluate(x + h);

	if (left === null || center === null || right === null) {
		return null;
	}

	return (left - 2 * center + right) / (h * h);
}

export function analyzeEquation(input: EquationAnalysisInput): EquationAnalysis {
	const viewport = input.viewport;
	const xMin = (0 - viewport.originX) / viewport.scaleX;
	const xMax = (viewport.width - viewport.originX) / viewport.scaleX;
	const criticalPoints = analyzeCriticalPoints(
		(x) => input.evaluate(x) ?? Number.NaN,
		viewport,
		viewport.width
	);
	const zeros = criticalPoints
		.filter((point) => point.kind === 'root')
		.map((point) => point.x);
	const { domain } = inferDomain(input.evaluate);
	const range = inferRange(input.evaluate, viewport);
	const period = detectPeriod(input.evaluate, viewport);
	const symmetry = detectSymmetry(input.evaluate, viewport);
	const verticalAsymptotes = detectVerticalAsymptotes(input.evaluate);
	const horizontalAsymptotes = detectHorizontalAsymptotes(input.evaluate);
	let positive = 0;
	let negative = 0;
	let monotone = true;
	let hasNaN = false;
	let allPositive = true;
	let allNegative = true;

	for (let index = 0; index < 200; index += 1) {
		const x = xMin + ((xMax - xMin) * index) / 199;
		const y = input.evaluate(x);

		if (y === null) {
			hasNaN = true;
			continue;
		}

		const d1 = derivativeAt(input.evaluate, x);
		const d2 = secondDerivativeAt(input.evaluate, x);

		if (d1 === null || Math.abs(d1) < 1e-8) {
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
		derivative: symbolicDerivative(input.node),
		integral: symbolicIntegral(input.node),
		isMonotone: monotone && (allPositive || allNegative),
		isContinuous: verticalAsymptotes.length === 0 && !hasNaN,
		curvature: positive > negative ? 'concave up' : negative > positive ? 'concave down' : 'mixed'
	};
}

export function equationToLatex(node: MathNode | null): string {
	return latexFromNode(node);
}
