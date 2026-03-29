import { nanoid } from 'nanoid';

import { COLOR_PALETTE } from '$lib/constants/palette';
import {
	isSafeExpressionInput,
	parseEquation,
	type EquationKind,
	type EvalFunction,
	type InequalityNodes,
	type MathNode,
	type ParametricNodes
} from '$lib/math/engine';
import type { CriticalPoint } from '$lib/analysis/criticalPoints';
import type { EquationAnalysis } from '$lib/analysis/equationAnalysis';
import type { IntersectionPoint } from '$lib/analysis/intersections';
import type { RegressionResult } from '$lib/analysis/regression';
import { LruMap } from '$lib/utils/lru';
import { clamp } from '$utils/format';

export interface Variable {
	name: string;
	value: number;
	min: number;
	max: number;
	step: number;
}

export interface DataSeriesStyle {
	symbol: 'circle' | 'square' | 'triangle' | 'cross' | 'diamond';
	size: number;
	color: string;
	showLine: boolean;
}

export interface DataSeriesColumn {
	id: string;
	name: string;
	width: number;
}

export interface DataSeries {
	id: string;
	name: string;
	columns: DataSeriesColumn[];
	rows: string[][];
	style: DataSeriesStyle;
	visible: boolean;
	plotted: boolean;
}

export interface GraphAnnotation {
	id: string;
	x: number;
	y: number;
	text: string;
	color: string;
}

export interface PlotEquation {
	id: string;
	raw: string;
	kind: EquationKind;
	compiled: MathNode | null;
	compiledExpression: EvalFunction | null;
	color: string;
	lineWidth: number;
	lineStyle: 'solid' | 'dashed' | 'dotted';
	opacity: number;
	visible: boolean;
	label: string;
	isParametric: boolean;
	showMarkers: boolean;
	paramRange: [number, number];
	errorMessage: string | null;
	renderTimeMs: number;
	parametricNodes: ParametricNodes | null;
	inequality: InequalityNodes | null;
	freeVariables: string[];
}

export interface ViewState {
	originX: number;
	originY: number;
	scaleX: number;
	scaleY: number;
	isPanning: boolean;
	isAnimating: boolean;
}

export interface GraphSettings {
	theme: 'light' | 'dark' | 'system';
	gridVisible: boolean;
	minorGridVisible: boolean;
	axisLabelsVisible: boolean;
	crosshairVisible: boolean;
	antialiasing: boolean;
	highDPI: boolean;
	showRenderTime: boolean;
	equationPanelWidth: number;
	gridStyle: 'cartesian' | 'polar';
	backgroundColor: string | null;
	axisColor: string | null;
	labelSize: number;
	traceMode: boolean;
	showCriticalPoints: boolean;
	showIntersections: boolean;
}

export interface GraphSnapshot {
	version: 2;
	equations: Array<{
		id: string;
		raw: string;
		kind: EquationKind;
		color: string;
		lineWidth: number;
		lineStyle: PlotEquation['lineStyle'];
		opacity: number;
		visible: boolean;
		label: string;
		showMarkers: boolean;
		paramRange: [number, number];
	}>;
	view: Omit<ViewState, 'isPanning' | 'isAnimating'>;
	settings: GraphSettings;
	variables: Variable[];
	dataSeries: DataSeries[];
	regressionResults: RegressionResult[];
	annotations: GraphAnnotation[];
}

interface ImportGraphOptions {
	commitHistory?: boolean;
	resetHistory?: boolean;
}

export interface GraphExporter {
	toPNGBlob(scale: 1 | 2 | 3): Promise<Blob | null>;
	toSVGString(): string;
	requestRender?(): void;
}

const DEFAULT_VIEW: ViewState = {
	originX: 0,
	originY: 0,
	scaleX: 72,
	scaleY: 72,
	isPanning: false,
	isAnimating: false
};
const MIN_ZOOM = 1e-6;
const MAX_ZOOM = 1e6;
const DEFAULT_SETTINGS: GraphSettings = {
	theme: 'system',
	gridVisible: true,
	minorGridVisible: true,
	axisLabelsVisible: true,
	crosshairVisible: true,
	antialiasing: true,
	highDPI: true,
	showRenderTime: false,
	equationPanelWidth: 380,
	gridStyle: 'cartesian',
	backgroundColor: null,
	axisColor: null,
	labelSize: 12,
	traceMode: true,
	showCriticalPoints: true,
	showIntersections: true
};
const STARTER_EQUATIONS: Array<{ raw: string; kind: EquationKind }> = [
	{ raw: 'sin(x)', kind: 'cartesian' },
	{ raw: '0.35x*cos(x)', kind: 'cartesian' },
	{ raw: 'x(t)=3cos(t); y(t)=2sin(t)', kind: 'parametric' }
];
const ALLOWED_LINE_STYLES = new Set<PlotEquation['lineStyle']>(['solid', 'dashed', 'dotted']);
const ALLOWED_KINDS = new Set<EquationKind>([
	'cartesian',
	'polar',
	'parametric',
	'implicit',
	'inequality'
]);
const ALLOWED_THEMES = new Set<GraphSettings['theme']>(['system', 'light', 'dark']);
const ALLOWED_GRID_STYLES = new Set<GraphSettings['gridStyle']>(['cartesian', 'polar']);
const MAX_URL_SNAPSHOT_BYTES = 128_000;
const MAX_DATA_SERIES = 12;
const MAX_DATA_COLUMNS = 8;
const MAX_DATA_ROWS = 1200;
const MAX_CELL_CHARS = 32;
const MAX_IMPORT_CELLS = MAX_DATA_SERIES * MAX_DATA_COLUMNS * MAX_DATA_ROWS;
const MAX_REGRESSION_RESULTS = 24;
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_BYTES = 10 * 1024 * 1024;
const MAX_ANALYSIS_CACHE_ENTRIES = 200;
const MAX_ANNOTATIONS = 48;

function base64UrlEncode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	const chunkSize = 0x8000;

	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

	if (Math.floor((padded.length * 3) / 4) > MAX_URL_SNAPSHOT_BYTES) {
		throw new Error('Shared Plotrix URL is too large to decode safely.');
	}

	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function clampRegressionResults(input: unknown): RegressionResult[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, MAX_REGRESSION_RESULTS)
		.filter((entry): entry is RegressionResult => {
			if (!entry || typeof entry !== 'object') {
				return false;
			}

			const result = entry as Partial<RegressionResult>;
			return (
				typeof result.model === 'string' &&
				typeof result.equation === 'string' &&
				typeof result.latex === 'string' &&
				Array.isArray(result.coefficients) &&
				result.coefficients.every((value) => typeof value === 'number' && Number.isFinite(value))
			);
		})
		.map((result) => ({
			...result,
			coefficients: result.coefficients.slice(0, 12),
			metrics: {
				r2: asFiniteNumber(result.metrics?.r2, 0, -1, 1),
				rmse: asFiniteNumber(result.metrics?.rmse, 0, 0, 1e12),
				mae: asFiniteNumber(result.metrics?.mae, 0, 0, 1e12)
			}
		}));
}

function cloneSettings(settings: GraphSettings): GraphSettings {
	return { ...settings };
}

function asFiniteNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}

	return clamp(value, min, max);
}

function validateSettings(input: unknown): GraphSettings {
	const value = (input && typeof input === 'object' ? input : {}) as Partial<GraphSettings>;

	return {
		...DEFAULT_SETTINGS,
		theme: ALLOWED_THEMES.has(value.theme as GraphSettings['theme'])
			? (value.theme as GraphSettings['theme'])
			: DEFAULT_SETTINGS.theme,
		gridStyle: ALLOWED_GRID_STYLES.has(value.gridStyle as GraphSettings['gridStyle'])
			? (value.gridStyle as GraphSettings['gridStyle'])
			: DEFAULT_SETTINGS.gridStyle,
		gridVisible: Boolean(value.gridVisible ?? DEFAULT_SETTINGS.gridVisible),
		minorGridVisible: Boolean(value.minorGridVisible ?? DEFAULT_SETTINGS.minorGridVisible),
		axisLabelsVisible: Boolean(value.axisLabelsVisible ?? DEFAULT_SETTINGS.axisLabelsVisible),
		crosshairVisible: Boolean(value.crosshairVisible ?? DEFAULT_SETTINGS.crosshairVisible),
		showRenderTime: Boolean(value.showRenderTime ?? DEFAULT_SETTINGS.showRenderTime),
		highDPI: Boolean(value.highDPI ?? DEFAULT_SETTINGS.highDPI),
		antialiasing: Boolean(value.antialiasing ?? DEFAULT_SETTINGS.antialiasing),
		backgroundColor:
			typeof value.backgroundColor === 'string'
				? value.backgroundColor
				: DEFAULT_SETTINGS.backgroundColor,
		axisColor: typeof value.axisColor === 'string' ? value.axisColor : DEFAULT_SETTINGS.axisColor,
		equationPanelWidth: asFiniteNumber(
			value.equationPanelWidth,
			DEFAULT_SETTINGS.equationPanelWidth,
			300,
			520
		),
		labelSize: asFiniteNumber(value.labelSize, DEFAULT_SETTINGS.labelSize, 10, 18),
		traceMode: Boolean(value.traceMode ?? DEFAULT_SETTINGS.traceMode),
		showCriticalPoints: Boolean(value.showCriticalPoints ?? DEFAULT_SETTINGS.showCriticalPoints),
		showIntersections: Boolean(value.showIntersections ?? DEFAULT_SETTINGS.showIntersections)
	};
}

function validateEquations(input: unknown): GraphSnapshot['equations'] {
	if (!Array.isArray(input)) {
		return [];
	}

	const next: GraphSnapshot['equations'] = [];

	for (let index = 0; index < Math.min(input.length, 50); index += 1) {
		const value = input[index];
		if (!value || typeof value !== 'object') continue;
		const equation = value as GraphSnapshot['equations'][number];
		if (typeof equation.raw !== 'string' || !isSafeExpressionInput(equation.raw)) continue;
		const kind = ALLOWED_KINDS.has(equation.kind) ? equation.kind : 'cartesian';

		next.push({
			id: typeof equation.id === 'string' ? equation.id : nanoid(),
			raw: equation.raw,
			kind,
			color:
				typeof equation.color === 'string'
					? equation.color
					: COLOR_PALETTE[index % COLOR_PALETTE.length]!,
			lineWidth: asFiniteNumber(equation.lineWidth, 2.4, 1.5, 6),
			lineStyle: ALLOWED_LINE_STYLES.has(equation.lineStyle) ? equation.lineStyle : 'solid',
			opacity: asFiniteNumber(equation.opacity, 1, 0.1, 1),
			visible: Boolean(equation.visible ?? true),
			label: typeof equation.label === 'string' ? equation.label : '',
			showMarkers: Boolean(equation.showMarkers ?? true),
			paramRange: Array.isArray(equation.paramRange)
				? [
						asFiniteNumber(equation.paramRange[0], -10, -1e6, 1e6),
						asFiniteNumber(equation.paramRange[1], 10, -1e6, 1e6)
					]
				: [-10, 10]
		});
	}

	return next;
}

function validateVariables(input: unknown): Variable[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const variable = entry as Partial<Variable>;
			if (typeof variable.name !== 'string' || !/^[a-z]$/i.test(variable.name)) return null;
			return createDefaultVariable(variable.name.toLowerCase(), {
				value: asFiniteNumber(variable.value, 1, -1e6, 1e6),
				min: asFiniteNumber(variable.min, -10, -1e6, 1e6),
				max: asFiniteNumber(variable.max, 10, -1e6, 1e6),
				step: asFiniteNumber(variable.step, 0.01, 1e-6, 1e6)
			});
		})
		.filter((entry): entry is Variable => entry !== null);
}

function validateDataSeries(input: unknown): DataSeries[] {
	if (!Array.isArray(input) || !input.length) {
		return [defaultDataSeries(0)];
	}

	let totalCells = 0;

	return input.slice(0, MAX_DATA_SERIES).map((entry, index) => {
		const value = (entry && typeof entry === 'object' ? entry : {}) as Partial<DataSeries>;
		const base = defaultDataSeries(index);
		const columns =
			Array.isArray(value.columns) && value.columns.length
				? value.columns.slice(0, MAX_DATA_COLUMNS).map((column, columnIndex) => ({
						id: typeof column?.id === 'string' ? column.id : nanoid(),
						name:
							typeof column?.name === 'string'
								? column.name.slice(0, 32) || `Col ${columnIndex + 1}`
								: `Col ${columnIndex + 1}`,
						width: asFiniteNumber(column?.width, 120, 72, 240)
					}))
				: base.columns;
		const rows = Array.isArray(value.rows)
			? value.rows.slice(0, MAX_DATA_ROWS).map((row) =>
					Array.from({ length: columns.length }, (_, columnIndex) => {
						totalCells += 1;
						if (totalCells > MAX_IMPORT_CELLS) return '';
						const cell = Array.isArray(row) ? row[columnIndex] : '';
						if (typeof cell !== 'string') return '';
						const numeric = Number(cell);
						return Number.isFinite(numeric) ? `${numeric}`.slice(0, MAX_CELL_CHARS) : '';
					})
				)
			: base.rows;

		return {
			...base,
			id: typeof value.id === 'string' ? value.id : base.id,
			name: typeof value.name === 'string' ? value.name.slice(0, 32) || base.name : base.name,
			columns,
			rows,
			style: {
				symbol: value.style?.symbol ?? base.style.symbol,
				size: asFiniteNumber(value.style?.size, base.style.size, 4, 12),
				color: typeof value.style?.color === 'string' ? value.style.color : base.style.color,
				showLine: Boolean(value.style?.showLine ?? base.style.showLine)
			},
			visible: Boolean(value.visible ?? base.visible),
			plotted: Boolean(value.plotted ?? base.plotted)
		};
	});
}

function validateAnnotations(input: unknown): GraphAnnotation[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, MAX_ANNOTATIONS)
		.map((entry) => {
			if (!entry || typeof entry !== 'object') {
				return null;
			}

			const annotation = entry as Partial<GraphAnnotation>;

			if (
				typeof annotation.text !== 'string' ||
				typeof annotation.color !== 'string' ||
				typeof annotation.x !== 'number' ||
				typeof annotation.y !== 'number' ||
				!Number.isFinite(annotation.x) ||
				!Number.isFinite(annotation.y)
			) {
				return null;
			}

			return {
				id: typeof annotation.id === 'string' ? annotation.id : nanoid(),
				x: clamp(annotation.x, -1e7, 1e7),
				y: clamp(annotation.y, -1e7, 1e7),
				text: annotation.text.slice(0, 120),
				color: annotation.color
			};
		})
		.filter((entry): entry is GraphAnnotation => entry !== null);
}

function createDefaultVariable(name: string, current?: Partial<Variable>): Variable {
	return {
		name,
		value: current?.value ?? 1,
		min: current?.min ?? -10,
		max: current?.max ?? 10,
		step: current?.step ?? 0.01
	};
}

function defaultDataSeries(index: number): DataSeries {
	return {
		id: nanoid(),
		name: `Sheet ${index + 1}`,
		columns: [
			{ id: nanoid(), name: 'X', width: 120 },
			{ id: nanoid(), name: 'Y', width: 120 }
		],
		rows: Array.from({ length: 20 }, () => ['', '']),
		style: {
			symbol: 'circle',
			size: 6,
			color: COLOR_PALETTE[index % COLOR_PALETTE.length]!,
			showLine: false
		},
		visible: true,
		plotted: false
	};
}

function parseEquationState(raw: string, kind: EquationKind) {
	const parsed = parseEquation(raw, kind);
	return {
		compiled: parsed.node,
		compiledExpression: parsed.compiledExpression,
		errorMessage: parsed.error,
		kind: parsed.kind,
		isParametric: parsed.isParametric,
		parametricNodes: parsed.parametric,
		inequality: parsed.inequality,
		freeVariables: parsed.freeVariables
	};
}

function createEquation(
	raw: string,
	color: string,
	overrides: Partial<PlotEquation> = {}
): PlotEquation {
	const kind = overrides.kind ?? 'cartesian';
	const parsed = parseEquationState(raw, kind);

	return {
		id: overrides.id ?? nanoid(),
		raw,
		kind: parsed.kind,
		compiled: parsed.compiled,
		compiledExpression: parsed.compiledExpression,
		color,
		lineWidth: clamp(overrides.lineWidth ?? 2.5, 1.5, 6),
		lineStyle: overrides.lineStyle ?? 'solid',
		opacity: clamp(overrides.opacity ?? 1, 0.1, 1),
		visible: overrides.visible ?? true,
		label: overrides.label ?? '',
		isParametric: parsed.isParametric,
		showMarkers: overrides.showMarkers ?? true,
		paramRange: overrides.paramRange ?? [-10, 10],
		errorMessage: parsed.errorMessage,
		renderTimeMs: overrides.renderTimeMs ?? 0,
		parametricNodes: parsed.parametricNodes,
		inequality: parsed.inequality,
		freeVariables: parsed.freeVariables
	};
}

function createSnapshot(graph: {
	equations: PlotEquation[];
	view: ViewState;
	settings: GraphSettings;
	variables: Variable[];
	dataSeries: DataSeries[];
	regressionResults: RegressionResult[];
	annotations: GraphAnnotation[];
}): GraphSnapshot {
	return {
		version: 2,
		equations: graph.equations.map((equation) => ({
			id: equation.id,
			raw: equation.raw,
			kind: equation.kind,
			color: equation.color,
			lineWidth: equation.lineWidth,
			lineStyle: equation.lineStyle,
			opacity: equation.opacity,
			visible: equation.visible,
			label: equation.label,
			showMarkers: equation.showMarkers,
			paramRange: [...equation.paramRange] as [number, number]
		})),
		view: {
			originX: graph.view.originX,
			originY: graph.view.originY,
			scaleX: graph.view.scaleX,
			scaleY: graph.view.scaleY
		},
		settings: cloneSettings(graph.settings),
		variables: graph.variables.map((variable) => ({ ...variable })),
		dataSeries: graph.dataSeries.map((series) => ({
			...series,
			columns: series.columns.map((column) => ({ ...column })),
			rows: series.rows.map((row) => [...row]),
			style: { ...series.style }
		})),
		regressionResults: graph.regressionResults.map((result) => {
			const next = {
				...result,
				coefficients: [...result.coefficients],
				metrics: { ...result.metrics }
			} as RegressionResult;

			if (result.metadata) {
				next.metadata = { ...result.metadata };
			}

			return next;
		}),
		annotations: graph.annotations.map((annotation) => ({ ...annotation }))
	};
}

function stringifySnapshot(snapshot: GraphSnapshot, pretty = false): string {
	return pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot);
}

function deserializeSnapshot(source: string): GraphSnapshot {
	const trimmed = source.trim();
	let payload = trimmed;

	try {
		JSON.parse(trimmed);
	} catch {
		payload = trimmed.includes('plotrix=')
			? base64UrlDecode(trimmed.split('plotrix=')[1] ?? '')
			: base64UrlDecode(trimmed.replace(/^#/, ''));
	}

	let parsed: GraphSnapshot | { version: 1; [key: string]: unknown };

	try {
		parsed = JSON.parse(payload) as GraphSnapshot | { version: 1; [key: string]: unknown };
	} catch {
		throw new Error('Invalid Plotrix snapshot JSON.');
	}

	if (
		(parsed as GraphSnapshot).version === 2 &&
		Array.isArray((parsed as GraphSnapshot).equations)
	) {
		const snapshot = parsed as GraphSnapshot;
		return {
			version: 2,
			equations: validateEquations(snapshot.equations),
			view: {
				originX: asFiniteNumber(snapshot.view?.originX, DEFAULT_VIEW.originX, -1e7, 1e7),
				originY: asFiniteNumber(snapshot.view?.originY, DEFAULT_VIEW.originY, -1e7, 1e7),
				scaleX: asFiniteNumber(snapshot.view?.scaleX, DEFAULT_VIEW.scaleX, MIN_ZOOM, MAX_ZOOM),
				scaleY: asFiniteNumber(snapshot.view?.scaleY, DEFAULT_VIEW.scaleY, MIN_ZOOM, MAX_ZOOM)
			},
			settings: validateSettings(snapshot.settings),
			variables: validateVariables(snapshot.variables),
			dataSeries: validateDataSeries(snapshot.dataSeries),
			regressionResults: clampRegressionResults(snapshot.regressionResults),
			annotations: validateAnnotations(snapshot.annotations)
		};
	}

	if (
		(parsed as { version: 1 }).version === 1 &&
		Array.isArray((parsed as { equations: unknown[] }).equations)
	) {
		const legacy = parsed as {
			version: 1;
			equations: Array<{
				id: string;
				raw: string;
				color: string;
				lineWidth: number;
				lineStyle: PlotEquation['lineStyle'];
				opacity: number;
				visible: boolean;
				label: string;
				isParametric: boolean;
				paramRange: [number, number];
			}>;
			view: GraphSnapshot['view'];
			settings: Partial<GraphSettings>;
		};

		return {
			version: 2,
			equations: validateEquations(
				legacy.equations.map((equation) => ({
					...equation,
					kind: equation.isParametric ? 'parametric' : 'cartesian',
					showMarkers: true
				}))
			),
			view: legacy.view,
			settings: validateSettings({
				...legacy.settings,
				showCriticalPoints: legacy.settings.showCriticalPoints ?? true,
				showIntersections: legacy.settings.showIntersections ?? true
			}),
			variables: [],
			dataSeries: validateDataSeries([]),
			regressionResults: [],
			annotations: []
		};
	}

	throw new Error('Unsupported Plotrix snapshot.');
}

export function createGraphState() {
	const graph = $state({
		equations: [] as PlotEquation[],
		view: { ...DEFAULT_VIEW },
		settings: { ...DEFAULT_SETTINGS },
		viewport: { width: 0, height: 0 },
		variables: [] as Variable[],
		dataSeries: [defaultDataSeries(0)] as DataSeries[],
		annotations: [] as GraphAnnotation[],
		analysisCache: new LruMap<string, EquationAnalysis>(MAX_ANALYSIS_CACHE_ENTRIES),
		regressionResults: [] as RegressionResult[],
		variablesHash: '',
		historyIndex: 0,
		historySize: 0
	});

	let exporter: GraphExporter | null = null;
	let history: GraphSnapshot[] = [];
	let historyByteSizes: number[] = [];
	let historyBytes = 0;
	let lastHistoryJson = '';
	let pendingHistoryTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingAnalysisInvalidationTimer: ReturnType<typeof setTimeout> | null = null;
	let lastHistoryMeta: { kind: string; target: string; at: number } | null = null;
	const criticalPointCache = new LruMap<string, CriticalPoint[]>(MAX_ANALYSIS_CACHE_ENTRIES);
	const intersectionCache = new LruMap<string, IntersectionPoint[]>(MAX_ANALYSIS_CACHE_ENTRIES);
	// These caches are intentionally non-reactive worker bookkeeping.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pendingAnalysisRequests = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pendingIntersectionRequests = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pendingFitRequests = new Map<
		string,
		{
			recordHistory: boolean;
			dataBounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
		}
	>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const analysisFailures = new Set<string>();
	let analysisWorker: Worker | null = null;
	let memoizedVariableScope: Record<string, number> = {};
	let lastVariableSnapshot = [] as Array<{ name: string; value: number }>;

	function rememberAnalysisFailure(key: string): void {
		analysisFailures.delete(key);
		analysisFailures.add(key);

		while (analysisFailures.size > MAX_ANALYSIS_CACHE_ENTRIES) {
			const oldest = analysisFailures.values().next().value;

			if (!oldest) {
				break;
			}

			analysisFailures.delete(oldest);
		}
	}

	function resetAnalysisWorker(): void {
		pendingAnalysisRequests.clear();
		pendingIntersectionRequests.clear();
		pendingFitRequests.clear();
		analysisWorker?.terminate();
		analysisWorker = null;
		requestRender();
	}

	function ensureAnalysisWorker(): Worker | null {
		if (analysisWorker || typeof window === 'undefined' || typeof Worker === 'undefined') {
			return analysisWorker;
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		analysisWorker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
			type: 'module'
		});

		analysisWorker.onmessage = (event: MessageEvent) => {
			const data = event.data as {
				error?: string;
				type?: string;
				key?: string;
				result?: unknown;
				partial?: boolean;
			};

			if (!data || typeof data.type !== 'string' || typeof data.key !== 'string') {
				return;
			}

			if (data.error) {
				if (data.type === 'criticalPoints') {
					pendingAnalysisRequests.delete(data.key);
					criticalPointCache.set(data.key, []);
					return;
				}

				if (data.type === 'intersections') {
					pendingIntersectionRequests.delete(data.key);
					intersectionCache.set(data.key, []);
					return;
				}

				if (data.type === 'equationAnalysis') {
					pendingAnalysisRequests.delete(data.key);
					rememberAnalysisFailure(data.key);
					return;
				}

				if (data.type === 'fitBounds') {
					pendingFitRequests.delete(data.key);
				}

				return;
			}

			if (data.type === 'criticalPoints') {
				pendingAnalysisRequests.delete(data.key);
				criticalPointCache.set(
					data.key,
					Array.isArray(data.result) ? (data.result as CriticalPoint[]) : []
				);
				exporter?.requestRender?.();
				return;
			}

			if (data.type === 'intersections') {
				pendingIntersectionRequests.delete(data.key);
				intersectionCache.set(
					data.key,
					Array.isArray(data.result) ? (data.result as IntersectionPoint[]) : []
				);
				exporter?.requestRender?.();
				return;
			}

			if (data.type === 'equationAnalysis') {
				if (data.result) {
					analysisFailures.delete(data.key);
					graph.analysisCache.set(data.key, data.result as EquationAnalysis);
					exporter?.requestRender?.();
					if (!data.partial) {
						pendingAnalysisRequests.delete(data.key);
					}
				} else {
					pendingAnalysisRequests.delete(data.key);
					rememberAnalysisFailure(data.key);
				}
				return;
			}

			if (data.type === 'fitBounds') {
				const pendingFit = pendingFitRequests.get(data.key) ?? null;
				pendingFitRequests.delete(data.key);
				const bounds = data.result as
					| { minX: number; maxX: number; minY: number; maxY: number }
					| null
					| undefined;

				if (!bounds && !pendingFit?.dataBounds) {
					return;
				}

				const combined =
					bounds && pendingFit?.dataBounds
						? {
								minX: Math.min(bounds.minX, pendingFit.dataBounds.minX),
								maxX: Math.max(bounds.maxX, pendingFit.dataBounds.maxX),
								minY: Math.min(bounds.minY, pendingFit.dataBounds.minY),
								maxY: Math.max(bounds.maxY, pendingFit.dataBounds.maxY)
							}
						: (bounds ?? pendingFit?.dataBounds);

				if (!combined) {
					return;
				}

				applyFitBounds(combined);
				if (pendingFit?.recordHistory) {
					commitHistory('view', 'fit');
				}
			}
		};

		analysisWorker.onerror = () => {
			resetAnalysisWorker();
		};
		analysisWorker.onmessageerror = () => {
			resetAnalysisWorker();
		};

		return analysisWorker;
	}

	function nextColor(offset = graph.equations.length): string {
		return COLOR_PALETTE[offset % COLOR_PALETTE.length]!;
	}

	function variableScope(): Record<string, number> {
		const nextSnapshot = graph.variables.map((variable) => ({
			name: variable.name,
			value: variable.value
		}));
		const changed =
			nextSnapshot.length !== lastVariableSnapshot.length ||
			nextSnapshot.some((entry, index) => {
				const previous = lastVariableSnapshot[index];
				return previous?.name !== entry.name || previous.value !== entry.value;
			});

		if (changed) {
			lastVariableSnapshot = nextSnapshot;
			memoizedVariableScope = Object.fromEntries(
				nextSnapshot.map((variable) => [variable.name, variable.value])
			);
			graph.variablesHash = nextSnapshot
				.map((variable) => `${variable.name}:${variable.value}`)
				.join('|');
		}

		return memoizedVariableScope;
	}

	function applyFitBounds(bounds: {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	}): void {
		if (
			!Number.isFinite(bounds.minX) ||
			!Number.isFinite(bounds.maxX) ||
			!Number.isFinite(bounds.minY) ||
			!Number.isFinite(bounds.maxY)
		) {
			resetView(false);
			return;
		}

		const spanX = Math.max(2, bounds.maxX - bounds.minX);
		const spanY = Math.max(2, bounds.maxY - bounds.minY);
		const paddingX = spanX * 0.16;
		const paddingY = spanY * 0.18;
		const width = Math.max(320, graph.viewport.width || 1280);
		const height = Math.max(240, graph.viewport.height || 720);
		const scaleX = width / (spanX + paddingX * 2);
		const scaleY = height / (spanY + paddingY * 2);
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;

		graph.view.scaleX = clamp(scaleX, MIN_ZOOM, MAX_ZOOM);
		graph.view.scaleY = clamp(scaleY, MIN_ZOOM, MAX_ZOOM);
		graph.view.originX = width / 2 - centerX * graph.view.scaleX;
		graph.view.originY = height / 2 + centerY * graph.view.scaleY;
		bumpRenderVersion(false);
	}

	function analysisViewportBucket() {
		const width = Math.max(1, graph.viewport.width);
		const xMin = (0 - graph.view.originX) / graph.view.scaleX;
		const xMax = (width - graph.view.originX) / graph.view.scaleX;
		const xSpan = Math.max(1e-6, xMax - xMin);
		return [
			Math.round((xMin / xSpan) * 5) / 5,
			Math.round((xMax / xSpan) * 5) / 5,
			Math.round(graph.view.scaleX * 10) / 10,
			Math.round(graph.view.scaleY * 10) / 10
		].join(':');
	}

	function clearAnalysisCaches(): void {
		criticalPointCache.clear();
		intersectionCache.clear();
		pendingAnalysisRequests.clear();
		pendingIntersectionRequests.clear();
		analysisFailures.clear();
	}

	function clearPendingAnalysisInvalidation(): void {
		if (pendingAnalysisInvalidationTimer) {
			clearTimeout(pendingAnalysisInvalidationTimer);
			pendingAnalysisInvalidationTimer = null;
		}
	}

	function clearEquationAnalysisCache(raw?: string): void {
		if (!raw) {
			graph.analysisCache.clear();
			analysisFailures.clear();
			return;
		}

		for (const key of graph.analysisCache.keys()) {
			if (key.includes(`:${raw}:`) || key.endsWith(`:${raw}`)) {
				graph.analysisCache.delete(key);
			}
		}

		for (const key of [...analysisFailures]) {
			if (key.includes(`:${raw}:`) || key.endsWith(`:${raw}`)) {
				analysisFailures.delete(key);
			}
		}
	}

	function requestRender(): void {
		exporter?.requestRender?.();
	}

	function scheduleAnalysisInvalidation(delay = 100): void {
		clearPendingAnalysisInvalidation();
		pendingAnalysisInvalidationTimer = setTimeout(() => {
			clearAnalysisCaches();
			clearEquationAnalysisCache();
			pendingAnalysisInvalidationTimer = null;
			requestRender();
		}, delay);
	}

	function syncVariables(): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const names = new Set<string>();

		for (const equation of graph.equations) {
			for (const variable of equation.freeVariables) {
				names.add(variable);
			}
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const current = new Map(graph.variables.map((variable) => [variable.name, variable]));
		const next = [...names].sort().map((name) => createDefaultVariable(name, current.get(name)));
		graph.variables.splice(0, graph.variables.length, ...next);
		lastVariableSnapshot = [];
		variableScope();
	}

	function bumpRenderVersion(invalidateAnalysis = false): void {
		if (invalidateAnalysis) {
			clearAnalysisCaches();
			clearEquationAnalysisCache();
		}
		requestRender();
	}

	function replaceEquationAt(index: number, equation: PlotEquation): void {
		graph.equations.splice(index, 1, equation);
		syncVariables();
	}

	function clearPendingHistory(): void {
		if (pendingHistoryTimer) {
			clearTimeout(pendingHistoryTimer);
			pendingHistoryTimer = null;
		}
	}

	function commitHistory(kind = 'state', target = 'global', replaceCurrent = false): void {
		clearPendingHistory();
		const snapshot = createSnapshot(graph);
		const serialized = stringifySnapshot(snapshot);
		const byteSize = serialized.length * 2;

		if (serialized === lastHistoryJson) {
			return;
		}

		if (replaceCurrent && history.length > 0) {
			historyBytes -= historyByteSizes[graph.historyIndex] ?? 0;
			history[graph.historyIndex] = snapshot;
			historyByteSizes[graph.historyIndex] = byteSize;
			historyBytes += byteSize;
		} else {
			history = history.slice(0, graph.historyIndex + 1);
			historyByteSizes = historyByteSizes.slice(0, graph.historyIndex + 1);
			historyBytes = historyByteSizes.reduce((sum, value) => sum + value, 0);
			history.push(snapshot);
			historyByteSizes.push(byteSize);
			historyBytes += byteSize;

			while (history.length > MAX_HISTORY_ENTRIES || historyBytes > MAX_HISTORY_BYTES) {
				historyBytes -= historyByteSizes.shift() ?? 0;
				history.shift();
			}

			graph.historyIndex = history.length - 1;
		}

		graph.historySize = history.length;
		lastHistoryJson = serialized;
		lastHistoryMeta = { kind, target, at: Date.now() };
	}

	function replaceHistorySnapshot(
		snapshot: GraphSnapshot,
		kind = 'state',
		target = 'global'
	): void {
		clearPendingHistory();
		const serialized = stringifySnapshot(snapshot);
		const byteSize = serialized.length * 2;

		history = [snapshot];
		historyByteSizes = [byteSize];
		historyBytes = byteSize;
		graph.historyIndex = 0;
		graph.historySize = 1;
		lastHistoryJson = serialized;
		lastHistoryMeta = { kind, target, at: Date.now() };
	}

	function queueHistory(kind: string, target: string, delay = 180): void {
		clearPendingHistory();
		const replaceCurrent =
			lastHistoryMeta !== null &&
			lastHistoryMeta.kind === kind &&
			lastHistoryMeta.target === target &&
			Date.now() - lastHistoryMeta.at < 500;

		pendingHistoryTimer = setTimeout(() => {
			commitHistory(kind, target, replaceCurrent);
		}, delay);
	}

	async function restoreSnapshot(snapshot: GraphSnapshot): Promise<void> {
		const restoredEquations: PlotEquation[] = [];

		for (const [index, equation] of snapshot.equations.entries()) {
			restoredEquations.push(
				createEquation(
					equation.raw,
					equation.color || nextColor(index),
					equation as Partial<PlotEquation>
				)
			);

			if (snapshot.equations.length > 10 && (index + 1) % 5 === 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		}

		graph.equations.splice(0, graph.equations.length, ...restoredEquations);
		graph.variables.splice(
			0,
			graph.variables.length,
			...(snapshot.variables?.map((variable) => ({
				...createDefaultVariable(variable.name),
				...variable
			})) ?? [])
		);
		graph.dataSeries.splice(
			0,
			graph.dataSeries.length,
			...(snapshot.dataSeries?.length ? snapshot.dataSeries : [defaultDataSeries(0)]).map(
				(series) => ({
					...series,
					columns: series.columns.map((column) => ({ ...column })),
					rows: series.rows.map((row) => [...row]),
					style: { ...series.style }
				})
			)
		);
		graph.regressionResults.splice(
			0,
			graph.regressionResults.length,
			...(snapshot.regressionResults ?? [])
		);
		graph.annotations.splice(0, graph.annotations.length, ...(snapshot.annotations ?? []));
		clearEquationAnalysisCache();
		Object.assign(graph.view, snapshot.view, { isPanning: false, isAnimating: false });
		Object.assign(graph.settings, { ...DEFAULT_SETTINGS, ...snapshot.settings });
		syncVariables();
		lastVariableSnapshot = [];
		bumpRenderVersion(true);
	}

	function addEquation(raw = '', kind: EquationKind = 'cartesian'): PlotEquation {
		const equation = createEquation(raw, nextColor(), { kind });
		graph.equations.push(equation);
		syncVariables();
		lastVariableSnapshot = [];
		bumpRenderVersion(true);
		commitHistory('equations', equation.id);
		return equation;
	}

	function removeEquation(id: string): void {
		const index = graph.equations.findIndex((equation) => equation.id === id);

		if (index === -1) {
			return;
		}

		graph.equations.splice(index, 1);
		syncVariables();
		lastVariableSnapshot = [];
		bumpRenderVersion(true);
		commitHistory('equations', id);
	}

	function updateEquation(
		id: string,
		patch: Partial<
			Omit<
				PlotEquation,
				| 'id'
				| 'compiled'
				| 'compiledExpression'
				| 'parametricNodes'
				| 'inequality'
				| 'errorMessage'
				| 'renderTimeMs'
				| 'freeVariables'
			>
		>
	): void {
		const index = graph.equations.findIndex((equation) => equation.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.equations[index]!;
		const next = createEquation(patch.raw ?? current.raw, patch.color ?? current.color, {
			...current,
			...patch,
			paramRange: patch.paramRange ?? current.paramRange
		});

		next.lineWidth = clamp(next.lineWidth, 1.5, 6);
		next.opacity = clamp(next.opacity, 0.1, 1);
		next.paramRange = [
			Math.min(next.paramRange[0], next.paramRange[1]),
			Math.max(next.paramRange[0], next.paramRange[1])
		];

		replaceEquationAt(index, next);
		const mathChanged =
			patch.raw !== undefined ||
			patch.kind !== undefined ||
			patch.paramRange !== undefined ||
			current.kind !== next.kind ||
			current.raw !== next.raw ||
			current.paramRange[0] !== next.paramRange[0] ||
			current.paramRange[1] !== next.paramRange[1];
		if (mathChanged) {
			clearEquationAnalysisCache(current.raw);
			clearEquationAnalysisCache(next.raw);
			lastVariableSnapshot = [];
		}
		bumpRenderVersion(mathChanged);
		queueHistory('equation-edit', id, patch.raw !== undefined ? 280 : 180);
	}

	function duplicateEquation(id: string): void {
		const index = graph.equations.findIndex((equation) => equation.id === id);

		if (index === -1) {
			return;
		}

		const source = graph.equations[index]!;
		const duplicate = createEquation(source.raw, nextColor(index + 1), {
			...source,
			id: nanoid(),
			label: source.label ? `${source.label} copy` : ''
		});

		graph.equations.splice(index + 1, 0, duplicate);
		syncVariables();
		lastVariableSnapshot = [];
		bumpRenderVersion(true);
		commitHistory('equations', duplicate.id);
	}

	function reorderEquations(from: number, to: number): void {
		if (
			from === to ||
			from < 0 ||
			to < 0 ||
			from >= graph.equations.length ||
			to >= graph.equations.length
		) {
			return;
		}

		const [equation] = graph.equations.splice(from, 1);

		if (!equation) {
			return;
		}

		graph.equations.splice(to, 0, equation);
		bumpRenderVersion(false);
		commitHistory('equations', equation.id);
	}

	function setViewportSize(width: number, height: number): void {
		if (width <= 0 || height <= 0) {
			return;
		}

		if (graph.viewport.width === 0 || graph.viewport.height === 0) {
			graph.viewport.width = width;
			graph.viewport.height = height;
			graph.view.originX = width / 2;
			graph.view.originY = height / 2;
			bumpRenderVersion(false);
			return;
		}

		const centerX = (graph.viewport.width / 2 - graph.view.originX) / graph.view.scaleX;
		const centerY = (graph.view.originY - graph.viewport.height / 2) / graph.view.scaleY;
		graph.viewport.width = width;
		graph.viewport.height = height;
		graph.view.originX = width / 2 - centerX * graph.view.scaleX;
		graph.view.originY = height / 2 + centerY * graph.view.scaleY;
		bumpRenderVersion(false);
	}

	function resetView(recordHistory = true): void {
		graph.view.scaleX = DEFAULT_VIEW.scaleX;
		graph.view.scaleY = DEFAULT_VIEW.scaleY;
		graph.view.originX = graph.viewport.width / 2;
		graph.view.originY = graph.viewport.height / 2;
		graph.view.isAnimating = false;
		graph.view.isPanning = false;
		bumpRenderVersion(false);

		if (recordHistory) {
			commitHistory('view', 'reset');
		}
	}

	function zoomTo(
		factor: number,
		cx = graph.viewport.width / 2,
		cy = graph.viewport.height / 2
	): void {
		const safeFactor = clamp(factor, 0.1, 4);
		const mathX = (cx - graph.view.originX) / graph.view.scaleX;
		const mathY = (graph.view.originY - cy) / graph.view.scaleY;

		graph.view.scaleX = clamp(graph.view.scaleX * safeFactor, MIN_ZOOM, MAX_ZOOM);
		graph.view.scaleY = clamp(graph.view.scaleY * safeFactor, MIN_ZOOM, MAX_ZOOM);
		graph.view.originX = cx - mathX * graph.view.scaleX;
		graph.view.originY = cy + mathY * graph.view.scaleY;
		bumpRenderVersion(false);
		queueHistory('view', 'zoom', 120);
	}

	function setViewBounds(
		xMin: number,
		xMax: number,
		yMin: number,
		yMax: number,
		recordHistory = true
	): void {
		if (
			!Number.isFinite(xMin) ||
			!Number.isFinite(xMax) ||
			!Number.isFinite(yMin) ||
			!Number.isFinite(yMax) ||
			xMin === xMax ||
			yMin === yMax
		) {
			return;
		}

		const width = Math.max(1, graph.viewport.width);
		const height = Math.max(1, graph.viewport.height);
		graph.view.scaleX = clamp(width / Math.abs(xMax - xMin), MIN_ZOOM, MAX_ZOOM);
		graph.view.scaleY = clamp(height / Math.abs(yMax - yMin), MIN_ZOOM, MAX_ZOOM);
		graph.view.originX = -Math.min(xMin, xMax) * graph.view.scaleX;
		graph.view.originY = Math.max(yMin, yMax) * graph.view.scaleY;
		bumpRenderVersion(false);

		if (recordHistory) {
			queueHistory('view', 'bounds', 120);
		}
	}

	function panBy(dx: number, dy: number): void {
		graph.view.originX += dx;
		graph.view.originY += dy;
		bumpRenderVersion(false);
		queueHistory('view', 'pan', 120);
	}

	function panTo(
		x: number,
		y: number,
		insets: { left?: number; right?: number; top?: number; bottom?: number } = {}
	): void {
		const width = graph.viewport.width;
		const height = graph.viewport.height;
		const leftInset = insets.left ?? 0;
		const rightInset = insets.right ?? 0;
		const topInset = insets.top ?? 0;
		const bottomInset = insets.bottom ?? 0;
		const visibleWidth = Math.max(1, width - leftInset - rightInset);
		const visibleHeight = Math.max(1, height - topInset - bottomInset);

		graph.view.originX = leftInset + visibleWidth / 2 - x * graph.view.scaleX;
		graph.view.originY = topInset + visibleHeight / 2 + y * graph.view.scaleY;
		bumpRenderVersion(false);
		queueHistory('view', 'pan-to', 120);
	}

	function fitAll(recordHistory = true): void {
		const visibleEquations = graph.equations.filter(
			(equation) => equation.visible && !equation.errorMessage && equation.kind !== 'inequality'
		);

		if (!visibleEquations.length) {
			resetView(recordHistory);
			return;
		}
		const scope = variableScope();
		const fitKey = `fit:${visibleEquations.map((equation) => equation.id).join(',')}:${graph.variablesHash}:${graph.viewport.width}:${graph.viewport.height}`;
		const worker = ensureAnalysisWorker();

		if (worker && !pendingFitRequests.has(fitKey)) {
			pendingFitRequests.set(fitKey, {
				recordHistory,
				dataBounds: null
			});
			worker.postMessage({
				type: 'fitBounds',
				key: fitKey,
				equations: visibleEquations.map((equation) => ({
					id: equation.id,
					kind: equation.kind,
					raw: equation.raw,
					color: equation.color,
					paramRange: [...equation.paramRange] as [number, number]
				})),
				variables: scope,
				viewport: {
					originX: graph.view.originX,
					originY: graph.view.originY,
					scaleX: graph.view.scaleX,
					scaleY: graph.view.scaleY,
					width: graph.viewport.width,
					height: graph.viewport.height
				}
			});
		}

		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const series of graph.dataSeries.filter((entry) => entry.plotted && entry.visible)) {
			for (const row of series.rows) {
				const x = Number(row[0]);
				const y = Number(row[1]);

				if (!Number.isFinite(x) || !Number.isFinite(y)) {
					continue;
				}

				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
			}
		}

		if (
			!Number.isFinite(minX) ||
			!Number.isFinite(minY) ||
			!Number.isFinite(maxX) ||
			!Number.isFinite(maxY)
		) {
			if (!worker) {
				resetView(recordHistory);
			}
			return;
		}

		const dataBounds = { minX, maxX, minY, maxY };

		if (worker) {
			pendingFitRequests.set(fitKey, {
				recordHistory,
				dataBounds
			});
			return;
		}

		applyFitBounds(dataBounds);

		if (recordHistory) {
			commitHistory('view', 'fit');
		}
	}

	function updateSettings(patch: Partial<GraphSettings>): void {
		Object.assign(graph.settings, patch);
		graph.settings.equationPanelWidth = clamp(graph.settings.equationPanelWidth, 300, 520);
		graph.settings.labelSize = clamp(graph.settings.labelSize, 10, 18);
		bumpRenderVersion(false);
		queueHistory('settings', 'settings', 180);
	}

	function updateVariable(name: string, patch: Partial<Omit<Variable, 'name'>>): void {
		const variable = graph.variables.find((entry) => entry.name === name);

		if (!variable) {
			return;
		}

		Object.assign(variable, patch);
		variable.min = Math.min(variable.min, variable.max);
		variable.max = Math.max(variable.min, variable.max);
		variable.step = Math.max(1e-6, Math.abs(variable.step));
		variable.value = clamp(variable.value, variable.min, variable.max);
		lastVariableSnapshot = [];
		requestRender();
		scheduleAnalysisInvalidation();
		queueHistory('variables', name, 120);
	}

	function addDataSeries(): DataSeries {
		const series = defaultDataSeries(graph.dataSeries.length);
		graph.dataSeries.push(series);
		bumpRenderVersion(false);
		commitHistory('data-series', series.id);
		return series;
	}

	function updateDataSeries(id: string, patch: Partial<DataSeries>): void {
		const index = graph.dataSeries.findIndex((series) => series.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.dataSeries[index]!;
		graph.dataSeries.splice(index, 1, {
			...current,
			...patch,
			columns: patch.columns ?? current.columns,
			rows: patch.rows ?? current.rows,
			style: patch.style ? { ...current.style, ...patch.style } : current.style
		});
		if (current.plotted || patch.plotted) {
			bumpRenderVersion(false);
		}
		queueHistory('data-series', id, 150);
	}

	function removeDataSeries(id: string): void {
		const index = graph.dataSeries.findIndex((series) => series.id === id);

		if (index === -1) {
			return;
		}

		graph.dataSeries.splice(index, 1);

		if (!graph.dataSeries.length) {
			graph.dataSeries.push(defaultDataSeries(0));
		}

		bumpRenderVersion(false);
		commitHistory('data-series', id);
	}

	function upsertRegressionResult(result: RegressionResult): void {
		graph.regressionResults.unshift(result);
		graph.regressionResults.splice(MAX_REGRESSION_RESULTS);
		queueHistory('regression', result.model, 120);
	}

	function clearRegressionResults(): void {
		graph.regressionResults.splice(0, graph.regressionResults.length);
		queueHistory('regression', 'clear', 120);
	}

	function addAnnotation(
		x: number,
		y: number,
		text: string,
		color = nextColor()
	): GraphAnnotation | null {
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			typeof text !== 'string' ||
			!text.trim().length
		) {
			return null;
		}

		const annotation: GraphAnnotation = {
			id: nanoid(),
			x,
			y,
			text: text.trim().slice(0, 120),
			color
		};

		graph.annotations.unshift(annotation);
		graph.annotations.splice(MAX_ANNOTATIONS);
		bumpRenderVersion(false);
		commitHistory('annotations', annotation.id);
		return annotation;
	}

	function setEquationRenderTime(id: string, renderTimeMs: number): void {
		const equation = graph.equations.find((entry) => entry.id === id);

		if (!equation) {
			return;
		}

		const nextValue = Number(renderTimeMs.toFixed(2));

		if (Math.abs(equation.renderTimeMs - nextValue) < 0.05) {
			return;
		}

		equation.renderTimeMs = nextValue;
	}

	function getCriticalPoints(equationId: string): CriticalPoint[] {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation || !equation.compiledExpression || equation.kind !== 'cartesian') {
			return [];
		}

		const scope = variableScope();
		const key = `${equation.id}:${analysisViewportBucket()}:${graph.variablesHash}`;
		const cached = criticalPointCache.get(key);

		if (cached) {
			return cached;
		}

		const worker = ensureAnalysisWorker();
		if (worker && !pendingAnalysisRequests.has(key)) {
			pendingAnalysisRequests.add(key);
			worker.postMessage({
				type: 'criticalPoints',
				key,
				raw: equation.raw,
				kind: equation.kind,
				variables: scope,
				viewport: {
					originX: graph.view.originX,
					originY: graph.view.originY,
					scaleX: graph.view.scaleX,
					scaleY: graph.view.scaleY,
					width: graph.viewport.width,
					height: graph.viewport.height
				},
				canvasWidth: graph.viewport.width || 800
			});
		}

		return [];
	}

	function getIntersections(): IntersectionPoint[] {
		const visibleEquations = graph.equations.filter(
			(equation) =>
				equation.visible &&
				!equation.errorMessage &&
				(equation.kind === 'cartesian' || equation.kind === 'parametric')
		);

		if (visibleEquations.length < 2) {
			return [];
		}

		const scope = variableScope();
		const range = (() => {
			const width = Math.max(1, graph.viewport.width);
			const xMin = (0 - graph.view.originX) / graph.view.scaleX;
			const xMax = (width - graph.view.originX) / graph.view.scaleX;
			return `${Math.round(xMin * 2) / 2}:${Math.round(xMax * 2) / 2}`;
		})();
		const key = `${visibleEquations.map((equation) => equation.id).join(',')}:${range}:${Math.round(graph.view.scaleX * 10) / 10}:${graph.variablesHash}`;
		const cached = intersectionCache.get(key);

		if (cached) {
			return cached;
		}

		const worker = ensureAnalysisWorker();
		if (worker && !pendingIntersectionRequests.has(key)) {
			pendingIntersectionRequests.add(key);
			worker.postMessage({
				type: 'intersections',
				key,
				equations: visibleEquations.map((equation) => ({
					id: equation.id,
					kind: equation.kind,
					raw: equation.raw,
					color: equation.color,
					paramRange: [...equation.paramRange] as [number, number]
				})),
				variables: scope,
				viewport: {
					originX: graph.view.originX,
					originY: graph.view.originY,
					scaleX: graph.view.scaleX,
					scaleY: graph.view.scaleY,
					width: graph.viewport.width,
					height: graph.viewport.height
				}
			});
		}

		return [];
	}

	function getEquationAnalysis(equationId: string): EquationAnalysis | null {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation || !equation.compiled || equation.kind !== 'cartesian') {
			return null;
		}

		const scope = variableScope();
		const cacheKey = `${equation.kind}:${equation.raw}:${analysisViewportBucket()}:${graph.variablesHash}`;
		const cached = graph.analysisCache.get(cacheKey);

		if (cached) {
			return cached;
		}

		const worker = ensureAnalysisWorker();
		if (worker && !pendingAnalysisRequests.has(cacheKey)) {
			pendingAnalysisRequests.add(cacheKey);
			worker.postMessage({
				type: 'equationAnalysis',
				key: cacheKey,
				raw: equation.raw,
				kind: equation.kind,
				variables: scope,
				viewport: {
					originX: graph.view.originX,
					originY: graph.view.originY,
					scaleX: graph.view.scaleX,
					scaleY: graph.view.scaleY,
					width: graph.viewport.width,
					height: graph.viewport.height
				}
			});
		}

		return null;
	}

	function hasEquationAnalysisFailure(equationId: string): boolean {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation || equation.kind !== 'cartesian') {
			return true;
		}

		const cacheKey = `${equation.kind}:${equation.raw}:${analysisViewportBucket()}:${graph.variablesHash}`;
		return analysisFailures.has(cacheKey);
	}

	async function exportPNG(scale: 1 | 2 | 3): Promise<Blob | null> {
		return exporter ? exporter.toPNGBlob(scale) : null;
	}

	function exportSVG(): string {
		return exporter ? exporter.toSVGString() : '';
	}

	function exportSnapshot(): GraphSnapshot {
		return createSnapshot(graph);
	}

	function exportJSON(pretty = true): string {
		return stringifySnapshot(createSnapshot(graph), pretty);
	}

	async function importJSON(json: string, options: ImportGraphOptions = {}): Promise<void> {
		if (json.length > MAX_URL_SNAPSHOT_BYTES * 8) {
			throw new Error('Imported Plotrix snapshot exceeds the supported size limit.');
		}

		let snapshot: GraphSnapshot;
		try {
			snapshot = deserializeSnapshot(json);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : 'Unable to import Plotrix state.', {
				cause: error
			});
		}
		if (!snapshot.equations.length && !snapshot.dataSeries.length) {
			throw new Error('Imported Plotrix state is empty or invalid.');
		}
		await restoreSnapshot(snapshot);

		if (options.resetHistory) {
			replaceHistorySnapshot(snapshot, 'import', 'snapshot');
			return;
		}

		if (options.commitHistory ?? true) {
			commitHistory('import', 'snapshot');
		}
	}

	function shareURL(): string | null {
		if (typeof window === 'undefined') {
			return null;
		}

		const encoded = base64UrlEncode(exportJSON(false));
		const url = `${window.location.origin}${window.location.pathname}#plotrix=${encoded}`;

		if (encoded.length > MAX_URL_SNAPSHOT_BYTES * 2 || url.length > MAX_URL_SNAPSHOT_BYTES * 2) {
			throw new Error('Plotrix snapshot is too large to share as a URL. Export JSON instead.');
		}

		window.history.replaceState(null, '', `#plotrix=${encoded}`);
		return url;
	}

	async function undoHistory(): Promise<void> {
		clearPendingHistory();

		if (graph.historyIndex <= 0) {
			return;
		}

		graph.historyIndex -= 1;
		await restoreSnapshot(history[graph.historyIndex]!);
		lastHistoryJson = stringifySnapshot(history[graph.historyIndex]!);
	}

	async function redoHistory(): Promise<void> {
		clearPendingHistory();

		if (graph.historyIndex >= history.length - 1) {
			return;
		}

		graph.historyIndex += 1;
		await restoreSnapshot(history[graph.historyIndex]!);
		lastHistoryJson = stringifySnapshot(history[graph.historyIndex]!);
	}

	function attachExporter(next: GraphExporter | null): void {
		exporter = next;
	}

	function destroy(): void {
		clearPendingHistory();
		clearPendingAnalysisInvalidation();
		pendingAnalysisRequests.clear();
		pendingIntersectionRequests.clear();
		pendingFitRequests.clear();
		analysisWorker?.terminate();
		analysisWorker = null;
	}

	function seedStarterEquations(): void {
		if (graph.equations.length) {
			return;
		}

		for (const [index, starter] of STARTER_EQUATIONS.entries()) {
			graph.equations.push(createEquation(starter.raw, nextColor(index), { kind: starter.kind }));
		}

		syncVariables();
		lastVariableSnapshot = [];
		resetView(false);
		commitHistory('bootstrap', 'initial');
	}

	syncVariables();
	lastVariableSnapshot = [];
	resetView(false);
	commitHistory('bootstrap', 'initial');

	return Object.assign(graph, {
		addEquation,
		removeEquation,
		updateEquation,
		duplicateEquation,
		reorderEquations,
		setViewportSize,
		resetView,
		zoomTo,
		setViewBounds,
		panBy,
		panTo,
		fitAll,
		updateSettings,
		updateVariable,
		addDataSeries,
		updateDataSeries,
		removeDataSeries,
		upsertRegressionResult,
		clearRegressionResults,
		addAnnotation,
		setEquationRenderTime,
		getCriticalPoints,
		getIntersections,
		getEquationAnalysis,
		hasEquationAnalysisFailure,
		variableScope,
		attachExporter,
		destroy,
		seedStarterEquations,
		exportSnapshot,
		exportPNG,
		exportSVG,
		exportJSON,
		importJSON,
		shareURL,
		undoHistory,
		redoHistory
	});
}

export type GraphState = ReturnType<typeof createGraphState>;
