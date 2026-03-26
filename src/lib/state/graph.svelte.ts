import { nanoid } from 'nanoid';

import {
	parseEquation,
	sampleEquation,
	type EvalFunction,
	type MathNode,
	type ParametricNodes
} from '$lib/math/engine';
import { clamp } from '$utils/format';

export interface PlotEquation {
	id: string;
	raw: string;
	compiled: MathNode | null;
	compiledExpression: EvalFunction | null;
	color: string;
	lineWidth: number;
	lineStyle: 'solid' | 'dashed' | 'dotted';
	opacity: number;
	visible: boolean;
	label: string;
	isParametric: boolean;
	paramRange: [number, number];
	errorMessage: string | null;
	renderTimeMs: number;
	parametricNodes: ParametricNodes | null;
	inequality: string | null;
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
}

interface GraphSnapshot {
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
	view: Omit<ViewState, 'isPanning' | 'isAnimating'>;
	settings: GraphSettings;
}

export interface GraphExporter {
	toPNGBlob(scale: 1 | 2 | 3): Promise<Blob | null>;
	toSVGString(): string;
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
	animationSpeed: 1
};
const STARTER_EQUATIONS = ['sin(x)', '0.35x*cos(x)', 'x(t)=3cos(t); y(t)=2sin(t)'];

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

function parseEquationState(raw: string) {
	const parsed = parseEquation(raw);
	return {
		compiled: parsed.node,
		compiledExpression: parsed.node ? parsed.node.compile() : null,
		errorMessage: parsed.error,
		isParametric: parsed.isParametric,
		parametricNodes: parsed.parametric,
		inequality: parsed.inequality
	};
}

function createEquation(
	raw: string,
	color: string,
	overrides: Partial<PlotEquation> = {}
): PlotEquation {
	const parsed = parseEquationState(raw);

	return {
		id: overrides.id ?? nanoid(),
		raw,
		compiled: parsed.compiled,
		compiledExpression: parsed.compiledExpression,
		color,
		lineWidth: clamp(overrides.lineWidth ?? 2.5, 1.5, 6),
		lineStyle: overrides.lineStyle ?? 'solid',
		opacity: clamp(overrides.opacity ?? 1, 0.1, 1),
		visible: overrides.visible ?? true,
		label: overrides.label ?? '',
		isParametric: parsed.isParametric,
		paramRange: overrides.paramRange ?? [-10, 10],
		errorMessage: parsed.errorMessage,
		renderTimeMs: overrides.renderTimeMs ?? 0,
		parametricNodes: parsed.parametricNodes,
		inequality: parsed.inequality
	};
}

function createSnapshot(graph: {
	equations: PlotEquation[];
	view: ViewState;
	settings: GraphSettings;
}): GraphSnapshot {
	return {
		version: 1,
		equations: graph.equations.map((equation) => ({
			id: equation.id,
			raw: equation.raw,
			color: equation.color,
			lineWidth: equation.lineWidth,
			lineStyle: equation.lineStyle,
			opacity: equation.opacity,
			visible: equation.visible,
			label: equation.label,
			isParametric: equation.isParametric,
			paramRange: [...equation.paramRange] as [number, number]
		})),
		view: {
			originX: graph.view.originX,
			originY: graph.view.originY,
			scaleX: graph.view.scaleX,
			scaleY: graph.view.scaleY
		},
		settings: cloneSettings(graph.settings)
	};
}

function deserializeSnapshot(source: string): GraphSnapshot {
	const payload = source.trim().startsWith('{')
		? source
		: source.includes('plotrix=')
			? base64UrlDecode(source.split('plotrix=')[1] ?? '')
			: base64UrlDecode(source.replace(/^#/, ''));

	const parsed = JSON.parse(payload) as GraphSnapshot;

	if (parsed.version !== 1 || !Array.isArray(parsed.equations)) {
		throw new Error('Unsupported Plotrix snapshot.');
	}

	return parsed;
}

export function createGraphState() {
	const graph = $state({
		equations: [] as PlotEquation[],
		view: { ...DEFAULT_VIEW },
		settings: { ...DEFAULT_SETTINGS },
		viewport: { width: 0, height: 0 },
		renderVersion: 0,
		historyIndex: 0,
		historySize: 0
	});

	let exporter: GraphExporter | null = null;
	let history: GraphSnapshot[] = [];
	let lastHistoryJson = '';
	let pendingHistoryTimer: ReturnType<typeof setTimeout> | null = null;
	let lastHistoryMeta: { kind: string; target: string; at: number } | null = null;

	function bumpRenderVersion(): void {
		graph.renderVersion += 1;
	}

	function nextColor(offset = graph.equations.length): string {
		return COLOR_PALETTE[offset % COLOR_PALETTE.length]!;
	}

	function replaceEquationAt(index: number, equation: PlotEquation): void {
		graph.equations.splice(index, 1, equation);
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
			createEquation(
				equation.raw,
				equation.color || nextColor(index),
				equation as Partial<PlotEquation>
			)
		);

		graph.equations.splice(0, graph.equations.length, ...restoredEquations);
		Object.assign(graph.view, snapshot.view, { isPanning: false, isAnimating: false });
		Object.assign(graph.settings, snapshot.settings);
		bumpRenderVersion();
		lastHistoryJson = JSON.stringify(snapshot);
	}

	function addEquation(raw = ''): PlotEquation {
		const equation = createEquation(raw, nextColor());
		graph.equations.push(equation);
		bumpRenderVersion();
		commitHistory('equations', equation.id);
		return equation;
	}

	function removeEquation(id: string): void {
		const index = graph.equations.findIndex((equation) => equation.id === id);

		if (index === -1) {
			return;
		}

		graph.equations.splice(index, 1);
		bumpRenderVersion();
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
		bumpRenderVersion();
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
		bumpRenderVersion();
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
		bumpRenderVersion();
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
			bumpRenderVersion();
			return;
		}

		const centerX = (graph.viewport.width / 2 - graph.view.originX) / graph.view.scaleX;
		const centerY = (graph.view.originY - graph.viewport.height / 2) / graph.view.scaleY;
		graph.viewport.width = width;
		graph.viewport.height = height;
		graph.view.originX = width / 2 - centerX * graph.view.scaleX;
		graph.view.originY = height / 2 + centerY * graph.view.scaleY;
		bumpRenderVersion();
	}

	function resetView(recordHistory = true): void {
		graph.view.scaleX = DEFAULT_VIEW.scaleX;
		graph.view.scaleY = DEFAULT_VIEW.scaleY;
		graph.view.originX = graph.viewport.width / 2;
		graph.view.originY = graph.viewport.height / 2;
		graph.view.isAnimating = false;
		graph.view.isPanning = false;
		bumpRenderVersion();

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
		bumpRenderVersion();
		queueHistory('view', 'zoom', 120);
	}

	function panBy(dx: number, dy: number): void {
		graph.view.originX += dx;
		graph.view.originY += dy;
		bumpRenderVersion();
		queueHistory('view', 'pan', 120);
	}

	function fitAll(recordHistory = true): void {
		const visibleEquations = graph.equations.filter(
			(equation) => equation.visible && !equation.errorMessage
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

		for (const equation of visibleEquations) {
			const segments = sampleEquation(equation, -probeHalfWidth, probeHalfWidth, 96, 700);

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

		if (
			!Number.isFinite(minX) ||
			!Number.isFinite(minY) ||
			!Number.isFinite(maxX) ||
			!Number.isFinite(maxY)
		) {
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
		bumpRenderVersion();

		if (recordHistory) {
			commitHistory('view', 'fit');
		}
	}

	function updateSettings(patch: Partial<GraphSettings>): void {
		Object.assign(graph.settings, patch);
		graph.settings.equationPanelWidth = clamp(graph.settings.equationPanelWidth, 300, 520);
		graph.settings.labelSize = clamp(graph.settings.labelSize, 10, 18);
		graph.settings.animationSpeed = clamp(graph.settings.animationSpeed, 0.25, 2.5);
		bumpRenderVersion();
		queueHistory('settings', 'settings', 180);
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
		const snapshot = deserializeSnapshot(json);
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

	for (const [index, raw] of STARTER_EQUATIONS.entries()) {
		graph.equations.push(createEquation(raw, nextColor(index)));
	}

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
		fitAll,
		updateSettings,
		setEquationRenderTime,
		attachExporter,
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
