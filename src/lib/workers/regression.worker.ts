/// <reference lib="webworker" />

import { fitRegression, type RegressionModel } from '$lib/analysis/regression';

interface RegressionRequest {
	type: 'fit';
	model: RegressionModel;
	key: string;
	x: number[] | Float64Array;
	y: number[] | Float64Array;
	degree?: number;
	expression?: string;
}

function isRegressionRequest(value: unknown): value is RegressionRequest {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return (
		entry.type === 'fit' &&
		typeof entry.model === 'string' &&
		typeof entry.key === 'string' &&
		(Array.isArray(entry.x) || entry.x instanceof Float64Array) &&
		(Array.isArray(entry.y) || entry.y instanceof Float64Array)
	);
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isRegressionRequest(event.data)) {
		console.warn('regression.worker rejected invalid message payload');
		return;
	}

	const request = event.data;
	const options: { degree?: number; expression?: string } = {};
	if (request.degree !== undefined) options.degree = request.degree;
	if (request.expression !== undefined) options.expression = request.expression;
	const result = fitRegression(
		request.model,
		{ x: Array.from(request.x), y: Array.from(request.y) },
		options
	);

	self.postMessage({ type: 'fit', key: request.key, result });
};

export {};
