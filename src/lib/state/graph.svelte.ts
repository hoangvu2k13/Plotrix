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

export interface TangentLine {
	id: string;
	equationId: string;
	x: number;
	color: string;
	visible: boolean;
	lineStyle: PlotEquation['lineStyle'];
	lineWidth: number;
	opacity: number;
}

export interface IntegralShading {
	id: string;
	equationId: string;
	xMin: number;
	xMax: number;
	color: string;
	visible: boolean;
	showValue: boolean;
	label?: string | null;
	percentage?: boolean;
}

export interface ConstrainedPoint {
	id: string;
	equationId: string;
	x: number;
	label: string;
	color: string;
	showCoordinates: boolean;
	visible: boolean;
}

export interface EquationFolder {
	id: string;
	name: string;
	equationIds: string[];
	collapsed: boolean;
	visible: boolean;
	color: string;
}

export interface CalibrationPoint {
	x: number;
	y: number;
}

export interface CalibrationState {
	imagePoint1: CalibrationPoint;
	imagePoint2: CalibrationPoint;
	mathPoint1: CalibrationPoint;
	mathPoint2: CalibrationPoint;
}

export interface BackgroundImage {
	id: string;
	dataUrl: string;
	width: number;
	height: number;
	opacity: number;
	calibration: CalibrationState | null;
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
	condition: string | null;
	conditionCompiled: EvalFunction | null;
	conditionError: string | null;
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
		condition: string | null;
	}>;
	view: Omit<ViewState, 'isPanning' | 'isAnimating'>;
	settings: GraphSettings;
	variables: Variable[];
	dataSeries: DataSeries[];
	regressionResults: RegressionResult[];
	annotations: GraphAnnotation[];
	tangentLines: TangentLine[];
	integralShadings: IntegralShading[];
	constrainedPoints: ConstrainedPoint[];
	folders: EquationFolder[];
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
export const STARTER_EQUATIONS: Array<{ raw: string; kind: EquationKind }> = [
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
	'inequality',
	'slopefield',
	'vectorfield'
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
const MAX_TANGENT_LINES = 48;
const MAX_INTEGRAL_SHADINGS = 48;
const MAX_CONSTRAINED_POINTS = 48;
const MAX_FOLDERS = 24;

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
	const decoded = new TextDecoder().decode(bytes);

	if (decoded.length > MAX_URL_SNAPSHOT_BYTES) {
		throw new Error('Shared Plotrix URL is too large to decode safely.');
	}

	return decoded;
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
				: [-10, 10],
			condition:
				typeof equation.condition === 'string' && isSafeExpressionInput(equation.condition)
					? equation.condition.trim() || null
					: null
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
		const rows: string[][] = [];
		const rawRows = Array.isArray(value.rows) ? value.rows : [];
		const rowCount = Math.min(rawRows.length, MAX_DATA_ROWS);

		for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
			const row: string[] = new Array(columns.length);
			const sourceRow = Array.isArray(rawRows[rowIndex]) ? (rawRows[rowIndex] as unknown[]) : null;

			for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
				totalCells += 1;

				if (totalCells > MAX_IMPORT_CELLS) {
					row[columnIndex] = '';
					continue;
				}

				const cell = sourceRow?.[columnIndex] ?? '';

				if (typeof cell !== 'string') {
					row[columnIndex] = '';
					continue;
				}

				const numeric = Number(cell);
				row[columnIndex] = Number.isFinite(numeric) ? `${numeric}`.slice(0, MAX_CELL_CHARS) : '';
			}

			rows.push(row);
		}

		while (rows.length < base.rows.length) {
			rows.push(new Array(columns.length).fill(''));
		}

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

function validateTangentLines(input: unknown): TangentLine[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, MAX_TANGENT_LINES)
		.map((entry) => {
			if (!entry || typeof entry !== 'object') {
				return null;
			}

			const tangent = entry as Partial<TangentLine>;

			if (typeof tangent.equationId !== 'string' || typeof tangent.color !== 'string') {
				return null;
			}

			return {
				id: typeof tangent.id === 'string' ? tangent.id : nanoid(),
				equationId: tangent.equationId,
				x: asFiniteNumber(tangent.x, 0, -1e7, 1e7),
				color: tangent.color,
				visible: Boolean(tangent.visible ?? true),
				lineStyle:
					tangent.lineStyle && ALLOWED_LINE_STYLES.has(tangent.lineStyle)
						? tangent.lineStyle
						: 'dashed',
				lineWidth: asFiniteNumber(tangent.lineWidth, 2, 1, 6),
				opacity: asFiniteNumber(tangent.opacity, 0.95, 0.1, 1)
			};
		})
		.filter((entry): entry is TangentLine => entry !== null);
}

function validateIntegralShadings(input: unknown): IntegralShading[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const next: IntegralShading[] = [];

	for (const entry of input.slice(0, MAX_INTEGRAL_SHADINGS)) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}

		const shading = entry as Partial<IntegralShading>;

		if (typeof shading.equationId !== 'string' || typeof shading.color !== 'string') {
			continue;
		}

		const xMin = asFiniteNumber(shading.xMin, -1, -1e7, 1e7);
		const xMax = asFiniteNumber(shading.xMax, 1, -1e7, 1e7);

		next.push({
			id: typeof shading.id === 'string' ? shading.id : nanoid(),
			equationId: shading.equationId,
			xMin: Math.min(xMin, xMax),
			xMax: Math.max(xMin, xMax),
			color: shading.color,
			visible: Boolean(shading.visible ?? true),
			showValue: Boolean(shading.showValue ?? true),
			label: typeof shading.label === 'string' ? shading.label.slice(0, 64) : null,
			percentage: Boolean(shading.percentage ?? false)
		});
	}

	return next;
}

function validateConstrainedPoints(input: unknown): ConstrainedPoint[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, MAX_CONSTRAINED_POINTS)
		.map((entry) => {
			if (!entry || typeof entry !== 'object') {
				return null;
			}

			const point = entry as Partial<ConstrainedPoint>;

			if (typeof point.equationId !== 'string' || typeof point.color !== 'string') {
				return null;
			}

			return {
				id: typeof point.id === 'string' ? point.id : nanoid(),
				equationId: point.equationId,
				x: asFiniteNumber(point.x, 0, -1e7, 1e7),
				label: typeof point.label === 'string' ? point.label.slice(0, 64) : '',
				color: point.color,
				showCoordinates: Boolean(point.showCoordinates ?? true),
				visible: Boolean(point.visible ?? true)
			};
		})
		.filter((entry): entry is ConstrainedPoint => entry !== null);
}

function validateFolders(input: unknown): EquationFolder[] {
	if (!Array.isArray(input)) {
		return [];
	}

	return input
		.slice(0, MAX_FOLDERS)
		.map((entry, index) => {
			if (!entry || typeof entry !== 'object') {
				return null;
			}

			const folder = entry as Partial<EquationFolder>;

			return {
				id: typeof folder.id === 'string' ? folder.id : nanoid(),
				name:
					typeof folder.name === 'string' && folder.name.trim().length
						? folder.name.trim().slice(0, 80)
						: `Folder ${index + 1}`,
				equationIds: Array.isArray(folder.equationIds)
					? folder.equationIds.filter((value): value is string => typeof value === 'string')
					: [],
				collapsed: Boolean(folder.collapsed ?? false),
				visible: Boolean(folder.visible ?? true),
				color:
					typeof folder.color === 'string'
						? folder.color
						: COLOR_PALETTE[index % COLOR_PALETTE.length]!
			};
		})
		.filter((entry): entry is EquationFolder => entry !== null);
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

function parseConditionState(condition: string | null | undefined): {
	compiled: EvalFunction | null;
	error: string | null;
	value: string | null;
} {
	const trimmed = typeof condition === 'string' ? condition.trim() : '';

	if (!trimmed.length) {
		return { compiled: null, error: null, value: null };
	}

	if (!isSafeExpressionInput(trimmed)) {
		return {
			compiled: null,
			error: 'Conditional visibility contains unsupported tokens.',
			value: trimmed
		};
	}

	const parsed = parseEquation(trimmed, 'cartesian');
	const reserved = parsed.freeVariables.filter(
		(value) => value === 'x' || value === 'y' || value === 't'
	);

	if (reserved.length) {
		return {
			compiled: null,
			error: 'Conditional visibility may only use slider variables.',
			value: trimmed
		};
	}

	return {
		compiled: parsed.compiledExpression ?? null,
		error: parsed.error,
		value: trimmed
	};
}

function createEquation(
	raw: string,
	color: string,
	overrides: Partial<PlotEquation> = {}
): PlotEquation {
	const kind = overrides.kind ?? 'cartesian';
	const parsed = parseEquationState(raw, kind);
	const conditionState = parseConditionState(overrides.condition);

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
		freeVariables: parsed.freeVariables,
		condition: conditionState.value,
		conditionCompiled: conditionState.compiled ?? null,
		conditionError: conditionState.error
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
	tangentLines: TangentLine[];
	integralShadings: IntegralShading[];
	constrainedPoints: ConstrainedPoint[];
	folders: EquationFolder[];
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
			paramRange: [...equation.paramRange] as [number, number],
			condition: equation.condition
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
		annotations: graph.annotations.map((annotation) => ({ ...annotation })),
		tangentLines: graph.tangentLines.map((tangent) => ({ ...tangent })),
		integralShadings: graph.integralShadings.map((shading) => ({ ...shading })),
		constrainedPoints: graph.constrainedPoints.map((point) => ({ ...point })),
		folders: graph.folders.map((folder) => ({
			...folder,
			equationIds: [...folder.equationIds]
		}))
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
			annotations: validateAnnotations(snapshot.annotations),
			tangentLines: validateTangentLines(snapshot.tangentLines),
			integralShadings: validateIntegralShadings(snapshot.integralShadings),
			constrainedPoints: validateConstrainedPoints(snapshot.constrainedPoints),
			folders: validateFolders(snapshot.folders)
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
			annotations: [],
			tangentLines: [],
			integralShadings: [],
			constrainedPoints: [],
			folders: []
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
		tangentLines: [] as TangentLine[],
		integralShadings: [] as IntegralShading[],
		constrainedPoints: [] as ConstrainedPoint[],
		folders: [] as EquationFolder[],
		backgroundImagesVersion: 0,
		analysisCache: new LruMap<string, EquationAnalysis>(MAX_ANALYSIS_CACHE_ENTRIES),
		regressionResults: [] as RegressionResult[],
		variablesHash: '',
		historyIndex: 0,
		historySize: 0
	});
	const backgroundImages: BackgroundImage[] = [];
	type HistoryEntry = {
		byteSize: number;
		compressed: Uint8Array | null;
		compressPromise: Promise<void> | null;
		serialized: string | null;
		snapshot: GraphSnapshot | null;
	};

	let exporter: GraphExporter | null = null;
	let history: HistoryEntry[] = [];
	let historyBytes = 0;
	let lastHistoryJson = '';
	let pendingHistoryTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingHistoryCompressionTimer: ReturnType<typeof setTimeout> | null = null;
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
	let workerRestartAttempts = 0;
	const MAX_WORKER_RESTARTS = 5;
	let workerRestartReadyAt = 0;
	let workerRestartTimer: ReturnType<typeof setTimeout> | null = null;
	let memoizedVariableScope: Record<string, number> = Object.create(null) as Record<string, number>;
	let lastVariablesKey = '';
	let lastIntersectionPostTime = 0;
	const INTERSECTION_DEBOUNCE_MS = 80;

	function canUseHistoryCompression(): boolean {
		return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
	}

	async function compressHistoryText(value: string): Promise<Uint8Array | null> {
		if (!canUseHistoryCompression()) {
			return null;
		}

		const stream = new Blob([value]).stream().pipeThrough(new CompressionStream('gzip'));
		const buffer = await new Response(stream).arrayBuffer();
		return new Uint8Array(buffer);
	}

	async function decompressHistoryText(value: Uint8Array): Promise<string> {
		const copy = new Uint8Array(value.byteLength);
		copy.set(value);
		const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
		return new Response(stream).text();
	}

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
		workerRestartAttempts += 1;
		if (workerRestartAttempts <= MAX_WORKER_RESTARTS) {
			const delay = Math.min(100 * 2 ** workerRestartAttempts, 3000);
			workerRestartReadyAt = Date.now() + delay;
			if (workerRestartTimer) {
				clearTimeout(workerRestartTimer);
			}
			workerRestartTimer = setTimeout(() => {
				workerRestartTimer = null;
				workerRestartReadyAt = 0;
				ensureAnalysisWorker();
				requestRender();
			}, delay);
		}
		requestRender();
	}

	function ensureAnalysisWorker(): Worker | null {
		if (analysisWorker || typeof window === 'undefined' || typeof Worker === 'undefined') {
			return analysisWorker;
		}

		if (workerRestartReadyAt && Date.now() < workerRestartReadyAt) {
			return null;
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

			workerRestartAttempts = 0;

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
		const variables = graph.variables;
		let key = '';

		for (let index = 0; index < variables.length; index += 1) {
			const variable = variables[index]!;
			key += `${variable.name}:${variable.value}|`;
		}

		if (key === lastVariablesKey) {
			return memoizedVariableScope;
		}

		lastVariablesKey = key;
		graph.variablesHash = key;
		const scope = Object.create(null) as Record<string, number>;

		for (let index = 0; index < variables.length; index += 1) {
			const variable = variables[index]!;
			scope[variable.name] = variable.value;
		}

		memoizedVariableScope = scope;
		return scope;
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

			if (equation.condition) {
				for (const variable of parseEquation(equation.condition, 'cartesian').freeVariables) {
					if (variable !== 'x' && variable !== 'y' && variable !== 't') {
						names.add(variable);
					}
				}
			}
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const current = new Map(graph.variables.map((variable) => [variable.name, variable]));
		const next = [...names].sort().map((name) => createDefaultVariable(name, current.get(name)));
		graph.variables.splice(0, graph.variables.length, ...next);
		lastVariablesKey = '';
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

	function clearPendingHistoryCompression(): void {
		if (pendingHistoryCompressionTimer) {
			clearTimeout(pendingHistoryCompressionTimer);
			pendingHistoryCompressionTimer = null;
		}
	}

	function recalculateHistoryBytes(): void {
		historyBytes = history.reduce((sum, item) => sum + item.byteSize, 0);
	}

	function trimHistoryToBudget(): void {
		while (history.length > MAX_HISTORY_ENTRIES || historyBytes > MAX_HISTORY_BYTES) {
			const removed = history.shift();

			if (!removed) {
				break;
			}

			historyBytes -= removed.byteSize;

			if (graph.historyIndex > 0) {
				graph.historyIndex -= 1;
			}
		}

		if (history.length === 0) {
			graph.historyIndex = 0;
		} else {
			graph.historyIndex = Math.min(graph.historyIndex, history.length - 1);
		}

		graph.historySize = history.length;
	}

	async function compressHistoryEntry(entry: HistoryEntry): Promise<void> {
		if (!entry.serialized || entry.compressPromise || !canUseHistoryCompression()) {
			return;
		}

		const serialized = entry.serialized;
		const originalSize = entry.byteSize;

		entry.compressPromise = compressHistoryText(serialized)
			.then((compressed) => {
				if (!compressed || compressed.byteLength >= originalSize) {
					return;
				}

				entry.compressed = compressed;
				entry.serialized = null;
				entry.snapshot = null;
				entry.byteSize = compressed.byteLength;
				recalculateHistoryBytes();
			})
			.finally(() => {
				entry.compressPromise = null;
			});

		await entry.compressPromise;
	}

	function scheduleHistoryCompression(delay = 260): void {
		if (!canUseHistoryCompression()) {
			return;
		}

		clearPendingHistoryCompression();
		pendingHistoryCompressionTimer = setTimeout(() => {
			pendingHistoryCompressionTimer = null;
			void (async () => {
				for (let index = 0; index < history.length; index += 1) {
					if (index === graph.historyIndex) {
						continue;
					}

					await compressHistoryEntry(history[index]!);
				}

				trimHistoryToBudget();
			})();
		}, delay);
	}

	async function hydrateHistoryEntry(
		entry: HistoryEntry
	): Promise<{ serialized: string; snapshot: GraphSnapshot }> {
		let serialized = entry.serialized;

		if (!serialized) {
			if (!entry.compressed) {
				throw new Error('Plotrix history entry is unavailable.');
			}

			serialized = await decompressHistoryText(entry.compressed);
			entry.serialized = serialized;
		}

		if (!entry.snapshot) {
			entry.snapshot = deserializeSnapshot(serialized);
		}

		return {
			serialized,
			snapshot: entry.snapshot
		};
	}

	function commitHistory(kind = 'state', target = 'global', replaceCurrent = false): void {
		clearPendingHistory();
		const snapshot = createSnapshot(graph);
		const serialized = stringifySnapshot(snapshot);
		const byteSize = serialized.length * 2;
		const entry: HistoryEntry = {
			byteSize,
			compressed: null,
			compressPromise: null,
			serialized,
			snapshot
		};

		if (serialized === lastHistoryJson) {
			return;
		}

		if (replaceCurrent && history.length > 0) {
			historyBytes -= history[graph.historyIndex]?.byteSize ?? 0;
			history[graph.historyIndex] = entry;
			historyBytes += byteSize;
		} else {
			history = history.slice(0, graph.historyIndex + 1);
			recalculateHistoryBytes();
			history.push(entry);
			historyBytes += byteSize;

			graph.historyIndex = history.length - 1;
		}

		trimHistoryToBudget();
		lastHistoryJson = serialized;
		lastHistoryMeta = { kind, target, at: Date.now() };
		scheduleHistoryCompression();
	}

	function replaceHistorySnapshot(
		snapshot: GraphSnapshot,
		kind = 'state',
		target = 'global'
	): void {
		clearPendingHistory();
		const serialized = stringifySnapshot(snapshot);
		const byteSize = serialized.length * 2;
		const entry: HistoryEntry = {
			byteSize,
			compressed: null,
			compressPromise: null,
			serialized,
			snapshot
		};

		history = [entry];
		historyBytes = byteSize;
		graph.historyIndex = 0;
		graph.historySize = 1;
		lastHistoryJson = serialized;
		lastHistoryMeta = { kind, target, at: Date.now() };
		scheduleHistoryCompression();
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

	function commitHistoryNow(kind: string, target: string): void {
		commitHistory(kind, target);
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
		graph.tangentLines.splice(0, graph.tangentLines.length, ...(snapshot.tangentLines ?? []));
		graph.integralShadings.splice(
			0,
			graph.integralShadings.length,
			...(snapshot.integralShadings ?? [])
		);
		graph.constrainedPoints.splice(
			0,
			graph.constrainedPoints.length,
			...(snapshot.constrainedPoints ?? [])
		);
		graph.folders.splice(
			0,
			graph.folders.length,
			...(snapshot.folders ?? []).map((folder) => ({
				...folder,
				equationIds: [...folder.equationIds]
			}))
		);
		clearEquationAnalysisCache();
		Object.assign(graph.view, snapshot.view, { isPanning: false, isAnimating: false });
		Object.assign(graph.settings, { ...DEFAULT_SETTINGS, ...snapshot.settings });
		syncVariables();
		lastVariablesKey = '';
		bumpRenderVersion(true);
	}

	function addEquation(raw = '', kind: EquationKind = 'cartesian'): PlotEquation {
		const equation = createEquation(raw, nextColor(), { kind });
		graph.equations.push(equation);
		syncVariables();
		lastVariablesKey = '';
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
		graph.tangentLines.splice(
			0,
			graph.tangentLines.length,
			...graph.tangentLines.filter((entry) => entry.equationId !== id)
		);
		graph.integralShadings.splice(
			0,
			graph.integralShadings.length,
			...graph.integralShadings.filter((entry) => entry.equationId !== id)
		);
		graph.constrainedPoints.splice(
			0,
			graph.constrainedPoints.length,
			...graph.constrainedPoints.filter((entry) => entry.equationId !== id)
		);
		graph.folders.splice(
			0,
			graph.folders.length,
			...graph.folders.map((folder) => ({
				...folder,
				equationIds: folder.equationIds.filter((equationId) => equationId !== id)
			}))
		);
		syncVariables();
		lastVariablesKey = '';
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
				| 'conditionCompiled'
				| 'conditionError'
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
			lastVariablesKey = '';
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
		for (const folder of graph.folders) {
			const folderIndex = folder.equationIds.indexOf(id);
			if (folderIndex !== -1) {
				folder.equationIds.splice(folderIndex + 1, 0, duplicate.id);
			}
		}
		syncVariables();
		lastVariablesKey = '';
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

	function computeVisibleDataBounds(): {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	} | null {
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const series of graph.dataSeries) {
			if (!series.plotted || !series.visible) {
				continue;
			}

			for (let rowIndex = 0; rowIndex < series.rows.length; rowIndex += 1) {
				const row = series.rows[rowIndex]!;
				const x = Number(row[0]);
				const y = Number(row[1]);

				if (!Number.isFinite(x) || !Number.isFinite(y)) {
					continue;
				}

				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}

		return Number.isFinite(minX) &&
			Number.isFinite(minY) &&
			Number.isFinite(maxX) &&
			Number.isFinite(maxY)
			? { minX, maxX, minY, maxY }
			: null;
	}

	function fitAll(recordHistory = true): void {
		const visibleEquations = graph.equations.filter(
			(equation) =>
				equation.visible &&
				!equation.errorMessage &&
				equation.kind !== 'inequality' &&
				equation.kind !== 'slopefield' &&
				equation.kind !== 'vectorfield'
		);

		if (!visibleEquations.length) {
			resetView(recordHistory);
			return;
		}

		const scope = variableScope();
		const fitKey = `fit:${visibleEquations.map((equation) => equation.id).join(',')}:${graph.variablesHash}:${graph.viewport.width}:${graph.viewport.height}`;
		const worker = ensureAnalysisWorker();
		const dataBounds = computeVisibleDataBounds();

		if (worker && !pendingFitRequests.has(fitKey)) {
			pendingFitRequests.set(fitKey, {
				recordHistory,
				dataBounds
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
			return;
		}

		if (!dataBounds) {
			resetView(recordHistory);
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
		lastVariablesKey = '';
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

	function addTangentLine(equationId: string, x: number): TangentLine | null {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation || equation.kind !== 'cartesian' || !Number.isFinite(x)) {
			return null;
		}

		const tangent: TangentLine = {
			id: nanoid(),
			equationId,
			x: clamp(x, -1e7, 1e7),
			color: equation.color,
			visible: true,
			lineStyle: 'dashed',
			lineWidth: 2,
			opacity: 0.95
		};

		graph.tangentLines.push(tangent);
		bumpRenderVersion(false);
		commitHistory('tangent-line', tangent.id);
		return tangent;
	}

	function updateTangentLine(id: string, patch: Partial<TangentLine>): void {
		const index = graph.tangentLines.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.tangentLines[index]!;
		const next: TangentLine = {
			...current,
			...patch,
			x: asFiniteNumber(patch.x, current.x, -1e7, 1e7),
			lineStyle:
				patch.lineStyle && ALLOWED_LINE_STYLES.has(patch.lineStyle)
					? patch.lineStyle
					: current.lineStyle,
			lineWidth: asFiniteNumber(patch.lineWidth, current.lineWidth, 1, 6),
			opacity: asFiniteNumber(patch.opacity, current.opacity, 0.1, 1)
		};

		graph.tangentLines.splice(index, 1, next);
		bumpRenderVersion(false);
		queueHistory('tangent-line', id, 120);
	}

	function removeTangentLine(id: string): void {
		const index = graph.tangentLines.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		graph.tangentLines.splice(index, 1);
		bumpRenderVersion(false);
		commitHistory('tangent-line', id);
	}

	function addIntegralShading(
		equationId: string,
		xMin: number,
		xMax: number
	): IntegralShading | null {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (
			!equation ||
			equation.kind !== 'cartesian' ||
			!Number.isFinite(xMin) ||
			!Number.isFinite(xMax)
		) {
			return null;
		}

		const shading: IntegralShading = {
			id: nanoid(),
			equationId,
			xMin: clamp(Math.min(xMin, xMax), -1e7, 1e7),
			xMax: clamp(Math.max(xMin, xMax), -1e7, 1e7),
			color: equation.color,
			visible: true,
			showValue: true
		};

		graph.integralShadings.push(shading);
		bumpRenderVersion(false);
		commitHistory('integral-shading', shading.id);
		return shading;
	}

	function updateIntegralShading(id: string, patch: Partial<IntegralShading>): void {
		const index = graph.integralShadings.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.integralShadings[index]!;
		const xMin = asFiniteNumber(patch.xMin, current.xMin, -1e7, 1e7);
		const xMax = asFiniteNumber(patch.xMax, current.xMax, -1e7, 1e7);
		const next: IntegralShading = {
			...current,
			...patch,
			xMin: Math.min(xMin, xMax),
			xMax: Math.max(xMin, xMax)
		};

		graph.integralShadings.splice(index, 1, next);
		bumpRenderVersion(false);
		queueHistory('integral-shading', id, 120);
	}

	function removeIntegralShading(id: string): void {
		const index = graph.integralShadings.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		graph.integralShadings.splice(index, 1);
		bumpRenderVersion(false);
		commitHistory('integral-shading', id);
	}

	function addConstrainedPoint(equationId: string, x = 0): ConstrainedPoint | null {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation || equation.kind !== 'cartesian') {
			return null;
		}

		const point: ConstrainedPoint = {
			id: nanoid(),
			equationId,
			x: asFiniteNumber(x, 0, -1e7, 1e7),
			label: '',
			color: equation.color,
			showCoordinates: true,
			visible: true
		};

		graph.constrainedPoints.push(point);
		graph.constrainedPoints.splice(
			0,
			Math.max(0, graph.constrainedPoints.length - MAX_CONSTRAINED_POINTS)
		);
		bumpRenderVersion(false);
		commitHistory('constrained-point', point.id);
		return point;
	}

	function updateConstrainedPoint(id: string, patch: Partial<ConstrainedPoint>): void {
		const index = graph.constrainedPoints.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.constrainedPoints[index]!;
		const next: ConstrainedPoint = {
			...current,
			...patch,
			x: asFiniteNumber(patch.x, current.x, -1e7, 1e7),
			label: typeof patch.label === 'string' ? patch.label.slice(0, 64) : current.label
		};

		graph.constrainedPoints.splice(index, 1, next);
		bumpRenderVersion(false);
		queueHistory('constrained-point', id, 120);
	}

	function removeConstrainedPoint(id: string): void {
		const index = graph.constrainedPoints.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		graph.constrainedPoints.splice(index, 1);
		bumpRenderVersion(false);
		commitHistory('constrained-point', id);
	}

	function createFolder(name = 'New folder'): EquationFolder {
		const folder: EquationFolder = {
			id: nanoid(),
			name: name.trim() || 'New folder',
			equationIds: [],
			collapsed: false,
			visible: true,
			color: nextColor(graph.folders.length)
		};

		graph.folders.push(folder);
		graph.folders.splice(0, Math.max(0, graph.folders.length - MAX_FOLDERS));
		commitHistory('folders', folder.id);
		return folder;
	}

	function updateFolder(id: string, patch: Partial<EquationFolder>): void {
		const index = graph.folders.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		const current = graph.folders[index]!;
		const next: EquationFolder = {
			...current,
			...patch,
			name:
				typeof patch.name === 'string'
					? patch.name.trim().slice(0, 80) || current.name
					: current.name,
			equationIds: Array.isArray(patch.equationIds)
				? patch.equationIds.filter((value): value is string => typeof value === 'string')
				: current.equationIds
		};

		graph.folders.splice(index, 1, next);
		bumpRenderVersion(false);
		queueHistory('folders', id, 120);
	}

	function deleteFolder(id: string): void {
		const index = graph.folders.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		graph.folders.splice(index, 1);
		bumpRenderVersion(false);
		commitHistory('folders', id);
	}

	function addEquationToFolder(folderId: string, equationId: string): void {
		const folder = graph.folders.find((entry) => entry.id === folderId);

		if (!folder) {
			return;
		}

		for (const entry of graph.folders) {
			entry.equationIds = entry.equationIds.filter((id) => id !== equationId);
		}

		if (!folder.equationIds.includes(equationId)) {
			folder.equationIds.push(equationId);
		}

		bumpRenderVersion(false);
		commitHistory('folders', folderId);
	}

	function removeEquationFromFolder(folderId: string, equationId: string): void {
		const folder = graph.folders.find((entry) => entry.id === folderId);

		if (!folder) {
			return;
		}

		folder.equationIds = folder.equationIds.filter((id) => id !== equationId);
		bumpRenderVersion(false);
		commitHistory('folders', folderId);
	}

	function reorderFolders(from: number, to: number): void {
		if (
			from === to ||
			from < 0 ||
			to < 0 ||
			from >= graph.folders.length ||
			to >= graph.folders.length
		) {
			return;
		}

		const [folder] = graph.folders.splice(from, 1);

		if (!folder) {
			return;
		}

		graph.folders.splice(to, 0, folder);
		bumpRenderVersion(false);
		commitHistory('folders', folder.id);
	}

	function getFolderForEquation(equationId: string): EquationFolder | null {
		return graph.folders.find((folder) => folder.equationIds.includes(equationId)) ?? null;
	}

	function isEquationEffectivelyVisible(equationId: string): boolean {
		const equation = graph.equations.find((entry) => entry.id === equationId);

		if (!equation?.visible) {
			return false;
		}

		const folder = getFolderForEquation(equationId);
		return folder ? folder.visible : true;
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
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (
			worker &&
			!pendingIntersectionRequests.has(key) &&
			now - lastIntersectionPostTime > INTERSECTION_DEBOUNCE_MS
		) {
			lastIntersectionPostTime = now;
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

		if (
			!equation ||
			(!equation.compiled && !equation.compiledExpression) ||
			equation.kind !== 'cartesian'
		) {
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

	function touchBackgroundImages(): void {
		graph.backgroundImagesVersion += 1;
		requestRender();
	}

	function addBackgroundImage(
		dataUrl: string,
		width: number,
		height: number
	): BackgroundImage | null {
		if (
			typeof dataUrl !== 'string' ||
			!dataUrl.startsWith('data:image/') ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width <= 0 ||
			height <= 0
		) {
			return null;
		}

		const image: BackgroundImage = {
			id: nanoid(),
			dataUrl,
			width,
			height,
			opacity: 0.4,
			calibration: null
		};

		backgroundImages.push(image);
		touchBackgroundImages();
		return image;
	}

	function updateBackgroundImage(id: string, patch: Partial<BackgroundImage>): void {
		const image = backgroundImages.find((entry) => entry.id === id);

		if (!image) {
			return;
		}

		if (typeof patch.opacity === 'number' && Number.isFinite(patch.opacity)) {
			image.opacity = clamp(patch.opacity, 0.05, 1);
		}

		if (patch.calibration !== undefined) {
			image.calibration = patch.calibration;
		}

		touchBackgroundImages();
	}

	function removeBackgroundImage(id: string): void {
		const index = backgroundImages.findIndex((entry) => entry.id === id);

		if (index === -1) {
			return;
		}

		backgroundImages.splice(index, 1);
		touchBackgroundImages();
	}

	async function exportPNG(scale: 1 | 2 | 3): Promise<Blob | null> {
		return exporter ? exporter.toPNGBlob(scale) : null;
	}

	function exportSVG(): string {
		return exporter ? exporter.toSVGString() : '';
	}

	async function exportPDF(): Promise<Blob> {
		if (typeof window === 'undefined') {
			throw new Error('PDF export is only available in the browser.');
		}

		const svg = exportSVG();

		if (!svg) {
			throw new Error('PDF export is unavailable until the graph canvas mounts.');
		}

		const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
		const width = Math.max(1, graph.viewport.width || 1280);
		const height = Math.max(1, graph.viewport.height || 720);
		const parser = new DOMParser();
		const document = parser.parseFromString(svg, 'image/svg+xml');

		if (document.querySelector('parsererror')) {
			throw new Error('Plotrix could not parse the SVG export safely.');
		}

		const colorCanvas = window.document.createElement('canvas');
		const colorContext = colorCanvas.getContext('2d');

		const toPdfColor = (value: string | null) => {
			if (!value) {
				return null;
			}

			const trimmed = value.trim();

			if (!trimmed || trimmed === 'none' || trimmed === 'transparent') {
				return null;
			}

			if (!colorContext) {
				return null;
			}

			colorContext.fillStyle = '#000000';

			try {
				colorContext.fillStyle = trimmed;
			} catch {
				return null;
			}

			const normalized = colorContext.fillStyle;

			if (normalized.startsWith('#')) {
				const hex = normalized.slice(1);
				const chunk = hex.length === 3 ? 1 : 2;
				const expand = (entry: string) => (chunk === 1 ? `${entry}${entry}` : entry);
				const red = parseInt(expand(hex.slice(0, chunk)), 16);
				const green = parseInt(expand(hex.slice(chunk, chunk * 2)), 16);
				const blue = parseInt(expand(hex.slice(chunk * 2, chunk * 3)), 16);

				if ([red, green, blue].some((entry) => Number.isNaN(entry))) {
					return null;
				}

				return rgb(red / 255, green / 255, blue / 255);
			}

			const match = normalized.match(/rgba?\(([^)]+)\)/i);

			if (!match) {
				return null;
			}

			const channelSource = match[1];

			if (!channelSource) {
				return null;
			}

			const channels = channelSource
				.split(',')
				.map((entry) => Number.parseFloat(entry.trim()))
				.slice(0, 3);

			if (channels.length !== 3 || channels.some((entry) => !Number.isFinite(entry))) {
				return null;
			}

			return rgb(channels[0]! / 255, channels[1]! / 255, channels[2]! / 255);
		};

		const toPdfBlob = async (pdf: { save: () => Promise<Uint8Array> }) => {
			const bytes = await pdf.save();
			return new Blob([bytes.slice().buffer], { type: 'application/pdf' });
		};

		const numeric = (value: string | null, fallback = 0) => {
			if (!value) {
				return fallback;
			}

			const next = Number.parseFloat(value);
			return Number.isFinite(next) ? next : fallback;
		};

		const opacityOf = (element: Element, fallback = 1) => {
			const opacity = numeric(element.getAttribute('opacity'), fallback);
			const fillOpacity = numeric(element.getAttribute('fill-opacity'), 1);
			return clamp(opacity * fillOpacity, 0, 1);
		};

		const borderOpacityOf = (element: Element, fallback = 1) => {
			const opacity = numeric(element.getAttribute('opacity'), fallback);
			const strokeOpacity = numeric(element.getAttribute('stroke-opacity'), 1);
			return clamp(opacity * strokeOpacity, 0, 1);
		};

		const buildVectorPdf = async () => {
			const pdf = await PDFDocument.create();
			const page = pdf.addPage([width, height]);
			const font = await pdf.embedFont(StandardFonts.Helvetica);

			const drawElement = (element: Element): void => {
				const tag = element.tagName.toLowerCase();

				if (tag === 'svg' || tag === 'g') {
					for (const child of Array.from(element.children)) {
						drawElement(child);
					}
					return;
				}

				if (tag === 'path') {
					const d = element.getAttribute('d');

					if (!d?.trim().length) {
						return;
					}

					const color = toPdfColor(element.getAttribute('fill'));
					const borderColor = toPdfColor(element.getAttribute('stroke'));

					page.drawSvgPath(d, {
						x: 0,
						y: height,
						...(color ? { color, opacity: opacityOf(element) } : {}),
						...(borderColor
							? {
									borderColor,
									borderOpacity: borderOpacityOf(element),
									borderWidth: numeric(element.getAttribute('stroke-width'), 1)
								}
							: {})
					});
					return;
				}

				if (tag === 'circle') {
					const radius = numeric(element.getAttribute('r'));

					if (radius <= 0) {
						return;
					}

					const color = toPdfColor(element.getAttribute('fill'));
					const borderColor = toPdfColor(element.getAttribute('stroke'));

					page.drawEllipse({
						x: numeric(element.getAttribute('cx')),
						y: height - numeric(element.getAttribute('cy')),
						xScale: radius,
						yScale: radius,
						...(color ? { color, opacity: opacityOf(element) } : {}),
						...(borderColor
							? {
									borderColor,
									borderOpacity: borderOpacityOf(element),
									borderWidth: numeric(element.getAttribute('stroke-width'), 1)
								}
							: {})
					});
					return;
				}

				if (tag === 'rect') {
					const rectWidth = numeric(element.getAttribute('width'));
					const rectHeight = numeric(element.getAttribute('height'));

					if (rectWidth <= 0 || rectHeight <= 0) {
						return;
					}

					const color = toPdfColor(element.getAttribute('fill'));
					const borderColor = toPdfColor(element.getAttribute('stroke'));

					page.drawRectangle({
						x: numeric(element.getAttribute('x')),
						y: height - numeric(element.getAttribute('y')) - rectHeight,
						width: rectWidth,
						height: rectHeight,
						...(color ? { color, opacity: opacityOf(element) } : {}),
						...(borderColor
							? {
									borderColor,
									borderOpacity: borderOpacityOf(element),
									borderWidth: numeric(element.getAttribute('stroke-width'), 1)
								}
							: {})
					});
					return;
				}

				if (tag === 'text') {
					const content = element.textContent?.trim() ?? '';

					if (!content.length) {
						return;
					}

					const size = Math.max(6, numeric(element.getAttribute('font-size'), 12));
					const color = toPdfColor(element.getAttribute('fill')) ?? rgb(0, 0, 0);
					const textWidth = font.widthOfTextAtSize(content, size);
					let x = numeric(element.getAttribute('x'));
					const anchor = element.getAttribute('text-anchor');

					if (anchor === 'middle') {
						x -= textWidth / 2;
					} else if (anchor === 'end') {
						x -= textWidth;
					}

					page.drawText(content, {
						x,
						y: height - numeric(element.getAttribute('y')) - size,
						size,
						font,
						color,
						opacity: opacityOf(element)
					});
					return;
				}

				throw new Error(`Unsupported SVG element: ${tag}`);
			};

			for (const child of Array.from(document.documentElement.children)) {
				drawElement(child);
			}

			return pdf;
		};

		try {
			const pdf = await buildVectorPdf();
			return await toPdfBlob(pdf);
		} catch (error) {
			console.warn('PDF: falling back to raster for unsupported SVG elements', error);
			const png = await exportPNG(2);

			if (!png) {
				throw new Error('PNG fallback failed while generating the PDF export.', {
					cause: error
				});
			}

			const pdf = await PDFDocument.create();
			const page = pdf.addPage([width, height]);
			const image = await pdf.embedPng(await png.arrayBuffer());
			page.drawImage(image, { x: 0, y: 0, width, height });
			return await toPdfBlob(pdf);
		}
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
		const entry = history[graph.historyIndex];

		if (!entry) {
			return;
		}

		const hydrated = await hydrateHistoryEntry(entry);
		await restoreSnapshot(hydrated.snapshot);
		lastHistoryJson = hydrated.serialized;
		scheduleHistoryCompression();
	}

	async function redoHistory(): Promise<void> {
		clearPendingHistory();

		if (graph.historyIndex >= history.length - 1) {
			return;
		}

		graph.historyIndex += 1;
		const entry = history[graph.historyIndex];

		if (!entry) {
			return;
		}

		const hydrated = await hydrateHistoryEntry(entry);
		await restoreSnapshot(hydrated.snapshot);
		lastHistoryJson = hydrated.serialized;
		scheduleHistoryCompression();
	}

	function attachExporter(next: GraphExporter | null): void {
		exporter = next;
	}

	function destroy(): void {
		clearPendingHistory();
		clearPendingHistoryCompression();
		clearPendingAnalysisInvalidation();
		if (workerRestartTimer) {
			clearTimeout(workerRestartTimer);
			workerRestartTimer = null;
		}
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
		lastVariablesKey = '';
		resetView(false);
		commitHistory('bootstrap', 'initial');
	}

	syncVariables();
	lastVariablesKey = '';
	resetView(false);
	commitHistory('bootstrap', 'initial');

	return Object.assign(graph, {
		backgroundImages,
		addEquation,
		removeEquation,
		updateEquation,
		duplicateEquation,
		reorderEquations,
		createFolder,
		updateFolder,
		deleteFolder,
		reorderFolders,
		addEquationToFolder,
		removeEquationFromFolder,
		getFolderForEquation,
		isEquationEffectivelyVisible,
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
		addIntegralShading,
		addTangentLine,
		addConstrainedPoint,
		updateConstrainedPoint,
		removeConstrainedPoint,
		addBackgroundImage,
		updateBackgroundImage,
		removeBackgroundImage,
		setEquationRenderTime,
		getCriticalPoints,
		getIntersections,
		getEquationAnalysis,
		hasEquationAnalysisFailure,
		variableScope,
		attachExporter,
		requestRender,
		destroy,
		seedStarterEquations,
		exportSnapshot,
		exportPNG,
		exportSVG,
		exportPDF,
		exportJSON,
		importJSON,
		shareURL,
		commitHistoryNow,
		undoHistory,
		redoHistory,
		removeIntegralShading,
		removeTangentLine,
		updateIntegralShading,
		updateTangentLine
	});
}

export type GraphState = ReturnType<typeof createGraphState>;
