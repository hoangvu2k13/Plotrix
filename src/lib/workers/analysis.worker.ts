/// <reference lib="webworker" />

import { analyzeCriticalPoints } from '$lib/analysis/criticalPoints';
import {
	analyzeEquation,
	createPartialEquationAnalysis
} from '$lib/analysis/equationAnalysis';
import { findIntersections } from '$lib/analysis/intersections';
import type { IntersectionEquation } from '$lib/analysis/intersections';
import { LruMap } from '$lib/utils/lru';
import {
	evaluateCartesianAt,
	evaluateParametric,
	parseEquation,
	sampleEquation,
	type EquationKind
} from '$lib/math/engine';

interface WorkerViewport {
	originX: number;
	originY: number;
	scaleX: number;
	scaleY: number;
	width: number;
	height: number;
}

interface BaseRequest {
	type: 'criticalPoints' | 'intersections' | 'equationAnalysis' | 'fitBounds';
	key: string;
}

interface CriticalPointRequest extends BaseRequest {
	type: 'criticalPoints';
	raw: string;
	kind: EquationKind;
	variables: Record<string, number>;
	viewport: WorkerViewport;
	canvasWidth: number;
}

interface IntersectionEquationPayload {
	id: string;
	kind: EquationKind;
	raw: string;
	color: string;
	paramRange: [number, number];
}

interface IntersectionRequest extends BaseRequest {
	type: 'intersections';
	equations: IntersectionEquationPayload[];
	variables: Record<string, number>;
	viewport: WorkerViewport;
}

interface FitBoundsRequest extends BaseRequest {
	type: 'fitBounds';
	equations: IntersectionEquationPayload[];
	variables: Record<string, number>;
	viewport: WorkerViewport;
}

interface EquationAnalysisRequest extends BaseRequest {
	type: 'equationAnalysis';
	raw: string;
	kind: EquationKind;
	variables: Record<string, number>;
	viewport: WorkerViewport;
}

type AnalysisRequest =
	| CriticalPointRequest
	| IntersectionRequest
	| EquationAnalysisRequest
	| FitBoundsRequest;

const parseCache = new LruMap<string, ReturnType<typeof parseEquation>>(50);

function isViewport(value: unknown): value is WorkerViewport {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return ['originX', 'originY', 'scaleX', 'scaleY', 'width', 'height'].every(
		(key) => typeof entry[key] === 'number'
	);
}

function isIntersectionEquation(value: unknown): value is IntersectionEquationPayload {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.id === 'string' &&
		typeof entry.raw === 'string' &&
		typeof entry.color === 'string' &&
		Array.isArray(entry.paramRange) &&
		entry.paramRange.length === 2
	);
}

function isAnalysisRequest(value: unknown): value is AnalysisRequest {
	if (!value || typeof value !== 'object') return false;
	const entry = value as Record<string, unknown>;

	if (typeof entry.type !== 'string' || typeof entry.key !== 'string') {
		return false;
	}

	if (entry.type === 'criticalPoints') {
		return (
			typeof entry.raw === 'string' &&
			typeof entry.canvasWidth === 'number' &&
			isViewport(entry.viewport)
		);
	}

	if (entry.type === 'intersections') {
		return (
			Array.isArray(entry.equations) &&
			entry.equations.every(isIntersectionEquation) &&
			isViewport(entry.viewport)
		);
	}

	if (entry.type === 'fitBounds') {
		return (
			Array.isArray(entry.equations) &&
			entry.equations.every(isIntersectionEquation) &&
			isViewport(entry.viewport)
		);
	}

	if (entry.type === 'equationAnalysis') {
		return typeof entry.raw === 'string' && isViewport(entry.viewport);
	}

	return false;
}

function evaluateCartesian(raw: string, kind: EquationKind, variables: Record<string, number>) {
	const parsed = getParsedEquation(raw, kind);
	return {
		parsed,
		evaluate: (x: number) =>
			evaluateCartesianAt(parsed.compiledExpression ?? parsed.node, x, variables)
	};
}

function getParsedEquation(raw: string, kind: EquationKind) {
	const cacheKey = `${kind}:${raw}`;
	const cached = parseCache.get(cacheKey);

	if (cached) {
		return cached;
	}

	const parsed = parseEquation(raw, kind);
	parseCache.set(cacheKey, parsed);
	return parsed;
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isAnalysisRequest(event.data)) {
		console.warn('analysis.worker rejected invalid message payload');
		return;
	}

	const request = event.data;

	if (request.type === 'criticalPoints') {
		const { parsed, evaluate } = evaluateCartesian(request.raw, request.kind, request.variables);
		const result =
			parsed.node && request.kind === 'cartesian'
				? analyzeCriticalPoints(
						(x) => evaluate(x) ?? Number.NaN,
						request.viewport,
						request.canvasWidth
					)
				: [];
	self.postMessage({ type: request.type, key: request.key, result });
	return;
}

	if (request.type === 'intersections') {
		const equations: IntersectionEquation[] = [];
		for (const equation of request.equations) {
			const parsed = getParsedEquation(equation.raw, equation.kind);
			if (equation.kind === 'cartesian') {
				equations.push({
					id: equation.id,
					kind: equation.kind,
					color: equation.color,
					paramRange: equation.paramRange,
					evaluate: (x: number) => evaluateCartesianAt(parsed.node, x, request.variables)
				});
				continue;
			}

			if (equation.kind === 'parametric' && parsed.parametric) {
				equations.push({
					id: equation.id,
					kind: equation.kind,
					color: equation.color,
					paramRange: equation.paramRange,
					evaluateParametric: (t: number) =>
						evaluateParametric(parsed.parametric!, t, request.variables)
				});
			}
		}
		const result = findIntersections(equations, request.viewport);
		self.postMessage({ type: request.type, key: request.key, result });
		return;
	}

	if (request.type === 'fitBounds') {
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		const probeHalfWidth = Math.max(
			12,
			(request.viewport.width || 1280) / Math.max(request.viewport.scaleX, 72) / 2
		);

		for (const equation of request.equations) {
			const parsed = getParsedEquation(equation.raw, equation.kind);
			const segments = sampleEquation(
				{
					compiled: parsed.node,
					compiledExpression: parsed.compiledExpression,
					kind: parsed.kind,
					paramRange: equation.paramRange,
					parametricNodes: parsed.parametric
				},
				-probeHalfWidth,
				probeHalfWidth,
				96,
				700,
				request.variables
			);

			for (const segment of segments) {
				for (let index = 0; index < segment.length; index += 2) {
					const x = segment[index]!;
					const y = segment[index + 1]!;

					if (!Number.isFinite(x) || !Number.isFinite(y)) {
						continue;
					}

					minX = Math.min(minX, x);
					maxX = Math.max(maxX, x);
					minY = Math.min(minY, y);
					maxY = Math.max(maxY, y);
				}
			}
		}

		const result =
			Number.isFinite(minX) &&
			Number.isFinite(minY) &&
			Number.isFinite(maxX) &&
			Number.isFinite(maxY)
				? { minX, maxX, minY, maxY }
				: null;
		self.postMessage({ type: request.type, key: request.key, result });
		return;
	}

	const { parsed, evaluate } = evaluateCartesian(request.raw, request.kind, request.variables);
	if (!parsed.node || request.kind !== 'cartesian') {
		self.postMessage({ type: request.type, key: request.key, result: null });
		return;
	}

	const criticalPoints = analyzeCriticalPoints(
		(x) => evaluate(x) ?? Number.NaN,
		request.viewport,
		request.viewport.width
	);
	self.postMessage({
		type: request.type,
		key: request.key,
		partial: true,
		result: createPartialEquationAnalysis(request.viewport, criticalPoints)
	});
	self.postMessage({
		type: request.type,
		key: request.key,
		result: analyzeEquation({
			raw: request.raw,
			node: parsed.node,
			evaluate,
			viewport: request.viewport
		})
	});
};

export {};
