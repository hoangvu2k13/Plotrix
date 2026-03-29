/// <reference lib="webworker" />

import { fitRegression, type RegressionModel } from '$lib/analysis/regression';
import { isSafeExpressionInput } from '$lib/math/engine';

interface RegressionRequest {
	type: 'fit';
	model: RegressionModel;
	key: string;
	x: number[] | Float64Array;
	y: number[] | Float64Array;
	degree?: number;
	expression?: string;
}

const ALLOWED_MODELS = new Set<RegressionModel>([
	'linear',
	'polynomial',
	'exponential',
	'logarithmic',
	'power',
	'sinusoidal',
	'custom'
]);
const MAX_POINTS = 1500;
const MAX_EXPRESSION_LENGTH = 256;

function isFiniteNumberArray(value: unknown): value is number[] | Float64Array {
	if (!(Array.isArray(value) || value instanceof Float64Array) || value.length > MAX_POINTS) {
		return false;
	}

	return Array.from(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isRegressionRequest(value: unknown): value is RegressionRequest {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return (
		entry.type === 'fit' &&
		typeof entry.model === 'string' &&
		ALLOWED_MODELS.has(entry.model as RegressionModel) &&
		typeof entry.key === 'string' &&
		isFiniteNumberArray(entry.x) &&
		isFiniteNumberArray(entry.y) &&
		entry.x.length === entry.y.length &&
		entry.x.length >= 2 &&
		(entry.degree === undefined ||
			(typeof entry.degree === 'number' &&
				Number.isInteger(entry.degree) &&
				entry.degree >= 1 &&
				entry.degree <= 6)) &&
		(entry.expression === undefined ||
			(typeof entry.expression === 'string' &&
				entry.expression.length > 0 &&
				entry.expression.length <= MAX_EXPRESSION_LENGTH &&
				isSafeExpressionInput(entry.expression)))
	);
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isRegressionRequest(event.data)) {
		console.warn('regression.worker rejected invalid message payload');
		return;
	}

	const request = event.data;

	try {
		const options: { degree?: number; expression?: string } = {};
		if (request.degree !== undefined) options.degree = request.degree;
		if (request.expression !== undefined) options.expression = request.expression;
		const result = fitRegression(
			request.model,
			{ x: Array.from(request.x), y: Array.from(request.y) },
			options
		);
		const coefficients = new Float64Array(result.coefficients);

		self.postMessage(
			{
				type: 'fit',
				key: request.key,
				result: {
					...result,
					coefficients
				}
			},
			[coefficients.buffer]
		);
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.message : 'Regression fitting failed.',
			key: request.key,
			type: 'fit'
		});
	}
};

export {};
