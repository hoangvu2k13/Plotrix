import { evaluateCompiledWithScope, parseEquation } from '$lib/math/engine';

export type RegressionModel =
	| 'linear'
	| 'polynomial'
	| 'exponential'
	| 'logarithmic'
	| 'power'
	| 'sinusoidal'
	| 'custom';

export interface RegressionMetrics {
	r2: number;
	rmse: number;
	mae: number;
}

export interface RegressionResult {
	model: RegressionModel;
	equation: string;
	latex: string;
	metrics: RegressionMetrics;
	coefficients: number[];
	metadata?: Record<string, number | string>;
}

export interface RegressionDataset {
	x: number[];
	y: number[];
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function computeMetrics(actual: number[], predicted: number[]): RegressionMetrics {
	const average = mean(actual);
	let residual = 0;
	let total = 0;
	let absolute = 0;

	for (let index = 0; index < actual.length; index += 1) {
		const diff = actual[index]! - predicted[index]!;
		residual += diff * diff;
		total += (actual[index]! - average) ** 2;
		absolute += Math.abs(diff);
	}

	return {
		r2: total <= 1e-12 ? 1 : 1 - residual / total,
		rmse: Math.sqrt(residual / Math.max(actual.length, 1)),
		mae: absolute / Math.max(actual.length, 1)
	};
}

function gaussianSolve(matrix: number[][], vector: number[]): number[] {
	const size = vector.length;
	const a = matrix.map((row) => [...row]);
	const b = [...vector];

	for (let pivot = 0; pivot < size; pivot += 1) {
		let maxRow = pivot;

		for (let row = pivot + 1; row < size; row += 1) {
			if (Math.abs(a[row]![pivot]!) > Math.abs(a[maxRow]![pivot]!)) {
				maxRow = row;
			}
		}

		if (maxRow !== pivot) {
			[a[pivot], a[maxRow]] = [a[maxRow]!, a[pivot]!];
			[b[pivot], b[maxRow]] = [b[maxRow]!, b[pivot]!];
		}

		const divisor = a[pivot]![pivot]!;

		if (Math.abs(divisor) < 1e-12) {
			continue;
		}

		const pivotRow = a[pivot]!;
		for (let column = pivot; column < size; column += 1) {
			pivotRow[column] = (pivotRow[column] ?? 0) / divisor;
		}
		b[pivot] = (b[pivot] ?? 0) / divisor;

		for (let row = 0; row < size; row += 1) {
			if (row === pivot) {
				continue;
			}

			const factor = a[row]![pivot] ?? 0;

			for (let column = pivot; column < size; column += 1) {
				a[row]![column] = (a[row]![column] ?? 0) - factor * (a[pivot]![column] ?? 0);
			}

			b[row] = (b[row] ?? 0) - factor * (b[pivot] ?? 0);
		}
	}

	return b;
}

function linearRegression(dataset: RegressionDataset): RegressionResult {
	const { x, y } = dataset;
	const xMean = mean(x);
	const yMean = mean(y);
	let numerator = 0;
	let denominator = 0;

	for (let index = 0; index < x.length; index += 1) {
		numerator += (x[index]! - xMean) * (y[index]! - yMean);
		denominator += (x[index]! - xMean) ** 2;
	}

	const slope = denominator === 0 ? 0 : numerator / denominator;
	const intercept = yMean - slope * xMean;
	const predicted = x.map((value) => slope * value + intercept);

	return {
		model: 'linear',
		equation: `y = ${slope.toPrecision(6)} * x + ${intercept.toPrecision(6)}`,
		latex: `y = ${slope.toPrecision(4)}x + ${intercept.toPrecision(4)}`,
		metrics: computeMetrics(y, predicted),
		coefficients: [slope, intercept]
	};
}

function polynomialRegression(dataset: RegressionDataset, degree: number): RegressionResult {
	const { x, y } = dataset;
	const size = degree + 1;
	const xtx = Array.from({ length: size }, () => Array(size).fill(0));
	const xty = Array(size).fill(0);

	for (let row = 0; row < x.length; row += 1) {
		const powers = Array.from({ length: size }, (_, index) => x[row]! ** index);

		for (let i = 0; i < size; i += 1) {
			xty[i] += powers[i]! * y[row]!;

			for (let j = 0; j < size; j += 1) {
				xtx[i]![j] += powers[i]! * powers[j]!;
			}
		}
	}

	const coefficients = gaussianSolve(xtx, xty);
	const predicted = x.map((value) =>
		coefficients.reduce((sum, coefficient, index) => sum + coefficient * value ** index, 0)
	);
	const terms = coefficients
		.map((coefficient, index) => `${coefficient.toPrecision(6)}${index === 0 ? '' : `*x^${index}`}`)
		.join(' + ');
	const latex = coefficients
		.map((coefficient, index) =>
			index === 0 ? coefficient.toPrecision(4) : `${coefficient.toPrecision(4)}x^{${index}}`
		)
		.join(' + ');

	return {
		model: 'polynomial',
		equation: `y = ${terms}`,
		latex: `y = ${latex}`,
		metrics: computeMetrics(y, predicted),
		coefficients,
		metadata: { degree }
	};
}

function transformedLinearRegression(
	x: number[],
	y: number[],
	xTransform: (value: number) => number | null,
	yTransform: (value: number) => number | null
): { slope: number; intercept: number; originalX: number[]; originalY: number[] } {
	const transformedX: number[] = [];
	const transformedY: number[] = [];
	const originalX: number[] = [];
	const originalY: number[] = [];

	for (let index = 0; index < x.length; index += 1) {
		const nextX = xTransform(x[index]!);
		const nextY = yTransform(y[index]!);

		if (nextX === null || nextY === null || !Number.isFinite(nextX) || !Number.isFinite(nextY)) {
			continue;
		}

		transformedX.push(nextX);
		transformedY.push(nextY);
		originalX.push(x[index]!);
		originalY.push(y[index]!);
	}

	const result = linearRegression({ x: transformedX, y: transformedY });
	return {
		slope: result.coefficients[0]!,
		intercept: result.coefficients[1]!,
		originalX,
		originalY
	};
}

function exponentialRegression(dataset: RegressionDataset): RegressionResult {
	const transformed = transformedLinearRegression(
		dataset.x,
		dataset.y,
		(value) => value,
		(value) => (value > 0 ? Math.log(value) : null)
	);
	const a = Math.exp(transformed.intercept);
	const b = transformed.slope;
	const predicted = transformed.originalX.map((value) => a * Math.exp(b * value));

	return {
		model: 'exponential',
		equation: `y = ${a.toPrecision(6)} * exp(${b.toPrecision(6)} * x)`,
		latex: `y = ${a.toPrecision(4)}e^{${b.toPrecision(4)}x}`,
		metrics: computeMetrics(transformed.originalY, predicted),
		coefficients: [a, b]
	};
}

function logarithmicRegression(dataset: RegressionDataset): RegressionResult {
	const transformed = transformedLinearRegression(
		dataset.x,
		dataset.y,
		(value) => (value > 0 ? Math.log(value) : null),
		(value) => value
	);
	const a = transformed.slope;
	const b = transformed.intercept;
	const predicted = transformed.originalX.map((value) => a * Math.log(value) + b);

	return {
		model: 'logarithmic',
		equation: `y = ${a.toPrecision(6)} * ln(x) + ${b.toPrecision(6)}`,
		latex: `y = ${a.toPrecision(4)}\\ln(x) + ${b.toPrecision(4)}`,
		metrics: computeMetrics(transformed.originalY, predicted),
		coefficients: [a, b]
	};
}

function powerRegression(dataset: RegressionDataset): RegressionResult {
	const transformed = transformedLinearRegression(
		dataset.x,
		dataset.y,
		(value) => (value > 0 ? Math.log(value) : null),
		(value) => (value > 0 ? Math.log(value) : null)
	);
	const a = Math.exp(transformed.intercept);
	const b = transformed.slope;
	const predicted = transformed.originalX.map((value) => a * value ** b);

	return {
		model: 'power',
		equation: `y = ${a.toPrecision(6)} * x^${b.toPrecision(6)}`,
		latex: `y = ${a.toPrecision(4)}x^{${b.toPrecision(4)}}`,
		metrics: computeMetrics(transformed.originalY, predicted),
		coefficients: [a, b]
	};
}

function estimateFrequency(x: number[], y: number[]): number {
	let zeroCrossings = 0;

	for (let index = 1; index < y.length; index += 1) {
		if (Math.sign(y[index - 1]!) !== Math.sign(y[index]!)) {
			zeroCrossings += 1;
		}
	}

	const span = Math.max(1e-6, x[x.length - 1]! - x[0]!);
	return Math.max(1e-3, (zeroCrossings / 2) * ((2 * Math.PI) / span));
}

function matrixMultiplyTransposeJ(jacobian: number[][]): number[][] {
	const columns = jacobian[0]?.length ?? 0;
	const matrix = Array.from({ length: columns }, () => Array(columns).fill(0));

	for (let row = 0; row < jacobian.length; row += 1) {
		for (let col = 0; col < columns; col += 1) {
			for (let inner = 0; inner < columns; inner += 1) {
				matrix[col]![inner] += jacobian[row]![col]! * jacobian[row]![inner]!;
			}
		}
	}

	return matrix;
}

function matrixVectorMultiplyTranspose(jacobian: number[][], residuals: number[]): number[] {
	const columns = jacobian[0]?.length ?? 0;
	const vector = Array(columns).fill(0);

	for (let row = 0; row < jacobian.length; row += 1) {
		for (let col = 0; col < columns; col += 1) {
			vector[col] += jacobian[row]![col]! * residuals[row]!;
		}
	}

	return vector;
}

const SAFE_REGRESSION_PARAM = /^[a-wyz]$/;
const BLOCKED_PARAM_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_NONLINEAR_ITERATIONS = 60;

function createSafeScope(params: Record<string, number>, x: number): Record<string, number> {
	const scope = Object.create(null) as Record<string, number>;
	scope.x = x;

	for (const [key, value] of Object.entries(params)) {
		if (
			!SAFE_REGRESSION_PARAM.test(key) ||
			BLOCKED_PARAM_NAMES.has(key) ||
			!Number.isFinite(value)
		) {
			continue;
		}

		scope[key] = value;
	}

	return scope;
}

function fitNonlinearLeastSquares(
	dataset: RegressionDataset,
	names: string[],
	initialValues: Record<string, number>,
	evaluate: (params: Record<string, number>, x: number) => number | null
): { params: Record<string, number>; predicted: number[] } {
	let params = Object.assign(Object.create(null), initialValues) as Record<string, number>;
	let lambda = 0.01;
	let lastError = Number.POSITIVE_INFINITY;

	const rss = (candidate: Record<string, number>): { value: number; predicted: number[] } => {
		let value = 0;
		const predicted: number[] = [];

		for (let index = 0; index < dataset.x.length; index += 1) {
			const output = evaluate(candidate, dataset.x[index]!);

			if (output === null || !Number.isFinite(output)) {
				return { value: Number.POSITIVE_INFINITY, predicted: [] };
			}

			const error = dataset.y[index]! - output;
			value += error * error;
			predicted.push(output);
		}

		return { value, predicted };
	};

	for (let iteration = 0; iteration < MAX_NONLINEAR_ITERATIONS; iteration += 1) {
		const base = rss(params);

		if (!Number.isFinite(base.value)) {
			break;
		}

		const residuals = dataset.y.map((value, index) => value - base.predicted[index]!);
		const jacobian: number[][] = [];

		for (let row = 0; row < dataset.x.length; row += 1) {
			const grads: number[] = [];

			for (const name of names) {
				const step = Math.max(1e-6, Math.abs(params[name] ?? 0) * 1e-4);
				const forward = Object.create(null) as Record<string, number>;
				const backward = Object.create(null) as Record<string, number>;

				for (let index = 0; index < names.length; index += 1) {
					const paramName = names[index]!;
					const value = params[paramName] ?? 0;
					forward[paramName] = value;
					backward[paramName] = value;
				}

				forward[name] = (forward[name] ?? 0) + step;
				backward[name] = (backward[name] ?? 0) - step;
				const y1 = evaluate(forward, dataset.x[row]!);
				const y0 = evaluate(backward, dataset.x[row]!);
				grads.push(
					y1 === null || y0 === null || !Number.isFinite(y1) || !Number.isFinite(y0)
						? 0
						: (y1 - y0) / (2 * step)
				);
			}

			jacobian.push(grads);
		}

		const jtJ = matrixMultiplyTransposeJ(jacobian);

		for (let index = 0; index < jtJ.length; index += 1) {
			jtJ[index]![index] = (jtJ[index]![index] ?? 0) + lambda;
		}

		const jtR = matrixVectorMultiplyTranspose(jacobian, residuals);
		const delta = gaussianSolve(jtJ, jtR);
		const next = Object.create(null) as Record<string, number>;

		for (let index = 0; index < names.length; index += 1) {
			const name = names[index]!;
			next[name] = (params[name] ?? 0) + (delta[index] ?? 0);
		}

		const trial = rss(next);

		if (trial.value < base.value) {
			params = next;
			lambda *= 0.55;

			if (
				Math.abs(lastError - trial.value) < 1e-9 ||
				Math.hypot(...delta) < 1e-9 ||
				trial.value < 1e-12
			) {
				return { params, predicted: trial.predicted };
			}

			lastError = trial.value;
			continue;
		}

		lambda *= 2.2;
	}

	const final = rss(params);
	return { params, predicted: final.predicted };
}

function sinusoidalRegression(dataset: RegressionDataset): RegressionResult {
	const { x, y } = dataset;
	const yMax = Math.max(...y);
	const yMin = Math.min(...y);
	const initialOffset = (yMax + yMin) / 2;
	const initialValues = {
		a: (yMax - yMin) / 2 || 1,
		b: estimateFrequency(
			x,
			y.map((value) => value - initialOffset)
		),
		c: 0,
		d: initialOffset
	};
	const fit = fitNonlinearLeastSquares(
		dataset,
		['a', 'b', 'c', 'd'],
		initialValues,
		(params, sampleX) =>
			(params.a ?? initialValues.a) *
				Math.sin((params.b ?? initialValues.b) * sampleX + (params.c ?? initialValues.c)) +
			(params.d ?? initialValues.d)
	);
	const a = fit.params.a ?? initialValues.a;
	const b = fit.params.b ?? initialValues.b;
	const c = fit.params.c ?? initialValues.c;
	const d = fit.params.d ?? initialValues.d;

	return {
		model: 'sinusoidal',
		equation: `y = ${a.toPrecision(6)} * sin(${b.toPrecision(6)} * x + ${c.toPrecision(6)}) + ${d.toPrecision(6)}`,
		latex: `y = ${a.toPrecision(4)}\\sin(${b.toPrecision(4)}x + ${c.toPrecision(4)}) + ${d.toPrecision(4)}`,
		metrics: computeMetrics(y, fit.predicted),
		coefficients: [a, b, c, d]
	};
}

function customRegression(dataset: RegressionDataset, expression: string): RegressionResult {
	const parsed = parseEquation(expression, 'cartesian');

	if (parsed.error || !parsed.compiledExpression) {
		throw new Error(parsed.error ?? 'Unable to compile the custom regression expression.');
	}

	const names = [...parsed.freeVariables].filter((name) => name !== 'x').sort();

	for (const name of names) {
		if (!SAFE_REGRESSION_PARAM.test(name) || BLOCKED_PARAM_NAMES.has(name)) {
			throw new Error(`Unsupported parameter "${name}". Use single-letter names like a, b, c.`);
		}
	}

	const initialValues = Object.fromEntries(names.map((name, index) => [name, index === 0 ? 1 : 0]));
	const fit = fitNonlinearLeastSquares(dataset, names, initialValues, (params, sampleX) => {
		return evaluateCompiledWithScope(parsed.compiledExpression, createSafeScope(params, sampleX));
	});
	const substituted = names.reduce(
		(source, name) =>
			source.replaceAll(new RegExp(`\\b${name}\\b`, 'g'), `(${fit.params[name]!.toPrecision(6)})`),
		parsed.normalized || expression
	);

	return {
		model: 'custom',
		equation: `y = ${substituted}`,
		latex: `y = ${substituted}`,
		metrics: computeMetrics(dataset.y, fit.predicted),
		coefficients: names.map((name) => fit.params[name]!),
		metadata: Object.fromEntries(names.map((name) => [name, fit.params[name]!]))
	};
}

export function fitRegression(
	model: RegressionModel,
	dataset: RegressionDataset,
	options: { degree?: number; expression?: string } = {}
): RegressionResult {
	switch (model) {
		case 'linear':
			return linearRegression(dataset);
		case 'polynomial':
			return polynomialRegression(dataset, Math.min(6, Math.max(1, options.degree ?? 2)));
		case 'exponential':
			return exponentialRegression(dataset);
		case 'logarithmic':
			return logarithmicRegression(dataset);
		case 'power':
			return powerRegression(dataset);
		case 'sinusoidal':
			return sinusoidalRegression(dataset);
		case 'custom':
			return customRegression(dataset, options.expression ?? 'a*x+b');
	}
}
