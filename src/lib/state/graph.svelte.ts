import { nanoid } from 'nanoid';

import {
	isSafeExpressionInput,
	parseEquation,
	sampleEquation,
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
	showErrorBars: boolean;
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
	labelFont: string;
	labelSize: number;
	snapToGrid: boolean;
	traceMode: boolean;
	animationSpeed: number;
	showCriticalPoints: boolean;
	showIntersections: boolean;
}

interface GraphSnapshot {
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
}

export interface GraphExporter {
	toPNGBlob(scale: 1 | 2 | 3): Promise<Blob | null>;
	toSVGString(): string;
	requestRender?(): void;
}

const COLOR_PALETTE = [
	'#6366f1',
	'#0ea5e9',
	'#14b8a6',
	'#f97316',
	'#ef4444',
	'#8b5cf6',
	'#84cc16',
	'#ec4899'
];
const DEFAULT_VIEW: ViewState = {
	originX: 0,
	originY: 0,
	scaleX: 72,
	scaleY: 72,
	isPanning: false,
	isAnimating: false
};
const MIN_ZOOM = 1e-30;
const MAX_ZOOM = 1e30;
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
	labelFont: 'Inter Variable',
	labelSize: 12,
	snapToGrid: false,
	traceMode: true,
	animationSpeed: 1,
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

function base64UrlEncode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
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
		theme: ALLOWED_THEMES.has(value.theme as GraphSettings['theme']) ? (value.theme as GraphSettings['theme']) : DEFAULT_SETTINGS.theme,
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
		backgroundColor: typeof value.backgroundColor === 'string' ? value.backgroundColor : DEFAULT_SETTINGS.backgroundColor,
		axisColor: typeof value.axisColor === 'string' ? value.axisColor : DEFAULT_SETTINGS.axisColor,
		equationPanelWidth: asFiniteNumber(value.equationPanelWidth, DEFAULT_SETTINGS.equationPanelWidth, 300, 520),
		labelSize: asFiniteNumber(value.labelSize, DEFAULT_SETTINGS.labelSize, 10, 18),
		snapToGrid: Boolean(value.snapToGrid ?? DEFAULT_SETTINGS.snapToGrid),
		traceMode: Boolean(value.traceMode ?? DEFAULT_SETTINGS.traceMode),
		animationSpeed: asFiniteNumber(value.animationSpeed, DEFAULT_SETTINGS.animationSpeed, 0.25, 2.5),
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
			color: typeof equation.color === 'string' ? equation.color : COLOR_PALETTE[index % COLOR_PALETTE.length]!,
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

	return input.slice(0, 12).map((entry, index) => {
		const value = (entry && typeof entry === 'object' ? entry : {}) as Partial<DataSeries>;
		const base = defaultDataSeries(index);
		const columns = Array.isArray(value.columns) && value.columns.length
			? value.columns.slice(0, 8).map((column, columnIndex) => ({
					id: typeof column?.id === 'string' ? column.id : nanoid(),
					name: typeof column?.name === 'string' ? column.name.slice(0, 32) || `Col ${columnIndex + 1}` : `Col ${columnIndex + 1}`,
					width: asFiniteNumber(column?.width, 120, 72, 240)
				}))
			: base.columns;
		const rows = Array.isArray(value.rows)
			? value.rows.slice(0, 2000).map((row) =>
					Array.from({ length: columns.length }, (_, columnIndex) => {
						const cell = Array.isArray(row) ? row[columnIndex] : '';
						if (typeof cell !== 'string') return '';
						const numeric = Number(cell);
						return Number.isFinite(numeric) ? `${numeric}` : '';
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
				showLine: Boolean(value.style?.showLine ?? base.style.showLine),
				showErrorBars: Boolean(value.style?.showErrorBars ?? base.style.showErrorBars)
			},
			visible: Boolean(value.visible ?? base.visible),
			plotted: Boolean(value.plotted ?? base.plotted)
		};
	});
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
			showLine: false,
			showErrorBars: false
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
		})
	};
}

function deserializeSnapshot(source: string): GraphSnapshot {
	const payload = source.trim().startsWith('{')
		? source
		: source.includes('plotrix=')
			? base64UrlDecode(source.split('plotrix=')[1] ?? '')
			: base64UrlDecode(source.replace(/^#/, ''));

	let parsed: GraphSnapshot | { version: 1; [key: string]: unknown };

	try {
		parsed = JSON.parse(payload) as GraphSnapshot | { version: 1; [key: string]: unknown };
	} catch {
		throw new Error('Invalid Plotrix snapshot JSON.');
	}

	if ((parsed as GraphSnapshot).version === 2 && Array.isArray((parsed as GraphSnapshot).equations)) {
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
			regressionResults: Array.isArray(snapshot.regressionResults) ? snapshot.regressionResults : []
		};
	}

	if ((parsed as { version: 1 }).version === 1 && Array.isArray((parsed as { equations: unknown[] }).equations)) {
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
			regressionResults: []
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
		analysisCache: new Map<string, EquationAnalysis>(),
		regressionResults: [] as RegressionResult[],
		historyIndex: 0,
		historySize: 0
	});

	let exporter: GraphExporter | null = null;
	let history: GraphSnapshot[] = [];
	let lastHistoryJson = '';
	let pendingHistoryTimer: ReturnType<typeof setTimeout> | null = null;
	let lastHistoryMeta: { kind: string; target: string; at: number } | null = null;
	const criticalPointCache = new Map<string, CriticalPoint[]>();
	const intersectionCache = new Map<string, IntersectionPoint[]>();
	const pendingAnalysisRequests = new Set<string>();
	const pendingIntersectionRequests = new Set<string>();
	let analysisWorker: Worker | null = null;
	let memoizedVariableScope: Record<string, number> = {};
	let lastVariableScopeKey = '';

	function ensureAnalysisWorker(): Worker | null {
		if (analysisWorker || typeof window === 'undefined' || typeof Worker === 'undefined') {
			return analysisWorker;
		}

		analysisWorker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
			type: 'module'
		});

		analysisWorker.onmessage = (event: MessageEvent) => {
			const data = event.data as { type?: string; key?: string; result?: unknown };

			if (!data || typeof data.type !== 'string' || typeof data.key !== 'string') {
				return;
			}

			if (data.type === 'criticalPoints') {
				pendingAnalysisRequests.delete(data.key);
				criticalPointCache.set(data.key, Array.isArray(data.result) ? (data.result as CriticalPoint[]) : []);
				exporter?.requestRender?.();
				return;
			}

			if (data.type === 'intersections') {
				pendingIntersectionRequests.delete(data.key);
				intersectionCache.set(data.key, Array.isArray(data.result) ? (data.result as IntersectionPoint[]) : []);
				exporter?.requestRender?.();
				return;
			}

			if (data.type === 'equationAnalysis') {
				pendingAnalysisRequests.delete(data.key);
				if (data.result) {
					graph.analysisCache.set(data.key, data.result as EquationAnalysis);
					exporter?.requestRender?.();
				}
			}
		};

		return analysisWorker;
	}

	function nextColor(offset = graph.equations.length): string {
		return COLOR_PALETTE[offset % COLOR_PALETTE.length]!;
	}

	function variableScope(): Record<string, number> {
		const nextKey = graph.variables.map((variable) => `${variable.name}:${variable.value}`).join('|');

		if (nextKey !== lastVariableScopeKey) {
			lastVariableScopeKey = nextKey;
			memoizedVariableScope = Object.fromEntries(
				graph.variables.map((variable) => [variable.name, variable.value])
			);
		}

		return memoizedVariableScope;
	}

	function viewportHash(): string {
		return [
			graph.view.originX.toFixed(3),
			graph.view.originY.toFixed(3),
			graph.view.scaleX.toFixed(6),
			graph.view.scaleY.toFixed(6),
			graph.viewport.width,
			graph.viewport.height
		].join(':');
	}

	function analysisViewportBucket() {
		const width = Math.max(1, graph.viewport.width);
		const height = Math.max(1, graph.viewport.height);
		const xMin = (0 - graph.view.originX) / graph.view.scaleX;
		const xMax = (width - graph.view.originX) / graph.view.scaleX;
		const yMin = (graph.view.originY - height) / graph.view.scaleY;
		const yMax = graph.view.originY / graph.view.scaleY;
		const xSpan = Math.max(1e-6, xMax - xMin);
		const ySpan = Math.max(1e-6, yMax - yMin);

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
	}

	function clearEquationAnalysisCache(raw?: string): void {
		if (!raw) {
			graph.analysisCache.clear();
			return;
		}

		for (const key of graph.analysisCache.keys()) {
			if (key.includes(`:${raw}:`) || key.endsWith(`:${raw}`)) {
				graph.analysisCache.delete(key);
			}
		}
	}

	function requestRender(): void {
		exporter?.requestRender?.();
	}

	function syncVariables(): void {
		const names = new Set<string>();

		for (const equation of graph.equations) {
			for (const variable of equation.freeVariables) {
				names.add(variable);
			}
		}

		const current = new Map(graph.variables.map((variable) => [variable.name, variable]));
		const next = [...names].sort().map((name) => createDefaultVariable(name, current.get(name)));
		graph.variables.splice(0, graph.variables.length, ...next);
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
		const serialized = JSON.stringify(snapshot);

		if (serialized === lastHistoryJson) {
			return;
		}

		if (replaceCurrent && history.length > 0) {
			history[graph.historyIndex] = snapshot;
		} else {
			history = history.slice(0, graph.historyIndex + 1);
			history.push(snapshot);

			if (history.length > 50) {
				history.shift();
			}

			graph.historyIndex = history.length - 1;
		}

		graph.historySize = history.length;
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

	function restoreSnapshot(snapshot: GraphSnapshot): void {
		const restoredEquations = snapshot.equations.map((equation, index) =>
			createEquation(equation.raw, equation.color || nextColor(index), equation as Partial<PlotEquation>)
		);

		graph.equations.splice(0, graph.equations.length, ...restoredEquations);
		graph.variables.splice(
			0,
			graph.variables.length,
			...(snapshot.variables?.map((variable) => ({ ...createDefaultVariable(variable.name), ...variable })) ?? [])
		);
		graph.dataSeries.splice(
			0,
			graph.dataSeries.length,
			...((snapshot.dataSeries?.length ? snapshot.dataSeries : [defaultDataSeries(0)]).map((series) => ({
				...series,
				columns: series.columns.map((column) => ({ ...column })),
				rows: series.rows.map((row) => [...row]),
				style: { ...series.style }
			})))
		);
		graph.regressionResults.splice(
			0,
			graph.regressionResults.length,
			...(snapshot.regressionResults ?? [])
		);
		clearEquationAnalysisCache();
		Object.assign(graph.view, snapshot.view, { isPanning: false, isAnimating: false });
		Object.assign(graph.settings, { ...DEFAULT_SETTINGS, ...snapshot.settings });
		syncVariables();
		lastVariableScopeKey = '';
		bumpRenderVersion(true);
		lastHistoryJson = JSON.stringify(snapshot);
	}

	function addEquation(raw = '', kind: EquationKind = 'cartesian'): PlotEquation {
		const equation = createEquation(raw, nextColor(), { kind });
		graph.equations.push(equation);
		syncVariables();
		lastVariableScopeKey = '';
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
		lastVariableScopeKey = '';
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
			lastVariableScopeKey = '';
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
		lastVariableScopeKey = '';
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

	function panBy(dx: number, dy: number): void {
		graph.view.originX += dx;
		graph.view.originY += dy;
		bumpRenderVersion(false);
		queueHistory('view', 'pan', 120);
	}

	function panTo(x: number, y: number): void {
		graph.view.originX = graph.viewport.width / 2 - x * graph.view.scaleX;
		graph.view.originY = graph.viewport.height / 2 + y * graph.view.scaleY;
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

		const probeHalfWidth = Math.max(
			12,
			(graph.viewport.width || 1280) / Math.max(graph.view.scaleX, DEFAULT_VIEW.scaleX) / 2
		);
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		const scope = variableScope();

		for (const equation of visibleEquations) {
			const segments = sampleEquation(equation, -probeHalfWidth, probeHalfWidth, 96, 700, scope);

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

		if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
			resetView(recordHistory);
			return;
		}

		const spanX = Math.max(2, maxX - minX);
		const spanY = Math.max(2, maxY - minY);
		const paddingX = spanX * 0.16;
		const paddingY = spanY * 0.18;
		const width = Math.max(320, graph.viewport.width || 1280);
		const height = Math.max(240, graph.viewport.height || 720);
		const scaleX = width / (spanX + paddingX * 2);
		const scaleY = height / (spanY + paddingY * 2);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		graph.view.scaleX = clamp(scaleX, MIN_ZOOM, MAX_ZOOM);
		graph.view.scaleY = clamp(scaleY, MIN_ZOOM, MAX_ZOOM);
		graph.view.originX = width / 2 - centerX * graph.view.scaleX;
		graph.view.originY = height / 2 + centerY * graph.view.scaleY;
		bumpRenderVersion(false);

		if (recordHistory) {
			commitHistory('view', 'fit');
		}
	}

	function updateSettings(patch: Partial<GraphSettings>): void {
		Object.assign(graph.settings, patch);
		graph.settings.equationPanelWidth = clamp(graph.settings.equationPanelWidth, 300, 520);
		graph.settings.labelSize = clamp(graph.settings.labelSize, 10, 18);
		graph.settings.animationSpeed = clamp(graph.settings.animationSpeed, 0.25, 2.5);
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
		lastVariableScopeKey = '';
		bumpRenderVersion(true);
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
		bumpRenderVersion(false);
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
		graph.regressionResults.push(result);
		queueHistory('regression', result.model, 120);
	}

	function clearRegressionResults(): void {
		graph.regressionResults.splice(0, graph.regressionResults.length);
		queueHistory('regression', 'clear', 120);
	}

	function setEquationRenderTime(id: string, renderTimeMs: number): void {
		if (!graph.settings.showRenderTime) {
			return;
		}

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
		const key = `${equation.id}:${analysisViewportBucket()}:${Object.values(scope).join(':')}`;
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
		const key = `${visibleEquations.map((equation) => equation.id).join(',')}:${range}:${Math.round(graph.view.scaleX * 10) / 10}:${Object.values(scope).join(':')}`;
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
		const cacheKey = `${equation.kind}:${equation.raw}:${analysisViewportBucket()}:${Object.values(scope).join(':')}`;
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

	async function exportPNG(scale: 1 | 2 | 3): Promise<Blob | null> {
		return exporter ? exporter.toPNGBlob(scale) : null;
	}

	function exportSVG(): string {
		return exporter ? exporter.toSVGString() : '';
	}

	function exportJSON(): string {
		return JSON.stringify(createSnapshot(graph), null, 2);
	}

	function importJSON(json: string): void {
		let snapshot: GraphSnapshot;
		try {
			snapshot = deserializeSnapshot(json);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : 'Unable to import Plotrix state.');
		}
		if (!snapshot.equations.length && !snapshot.dataSeries.length) {
			throw new Error('Imported Plotrix state is empty or invalid.');
		}
		restoreSnapshot(snapshot);
		commitHistory('import', 'snapshot');
	}

	function shareURL(): string | null {
		if (typeof window === 'undefined') {
			return null;
		}

		const encoded = base64UrlEncode(exportJSON());
		const url = `${window.location.origin}${window.location.pathname}#plotrix=${encoded}`;
		window.history.replaceState(null, '', `#plotrix=${encoded}`);
		return url;
	}

	function undoHistory(): void {
		clearPendingHistory();

		if (graph.historyIndex <= 0) {
			return;
		}

		graph.historyIndex -= 1;
		restoreSnapshot(history[graph.historyIndex]!);
	}

	function redoHistory(): void {
		clearPendingHistory();

		if (graph.historyIndex >= history.length - 1) {
			return;
		}

		graph.historyIndex += 1;
		restoreSnapshot(history[graph.historyIndex]!);
	}

	function attachExporter(next: GraphExporter | null): void {
		exporter = next;
	}

	function seedStarterEquations(): void {
		if (graph.equations.length) {
			return;
		}

		for (const [index, starter] of STARTER_EQUATIONS.entries()) {
			graph.equations.push(createEquation(starter.raw, nextColor(index), { kind: starter.kind }));
		}

		syncVariables();
		lastVariableScopeKey = '';
		resetView(false);
		commitHistory('bootstrap', 'initial');
	}

	syncVariables();
	lastVariableScopeKey = '';
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
		setEquationRenderTime,
		getCriticalPoints,
		getIntersections,
		getEquationAnalysis,
		variableScope,
		attachExporter,
		seedStarterEquations,
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
