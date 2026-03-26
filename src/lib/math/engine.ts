import { all, create, type EvalFunction, type MathNode } from 'mathjs';

const math = create(all!);

math.import(
	{
		sec: (x: number) => 1 / Math.cos(x),
		csc: (x: number) => 1 / Math.sin(x),
		cot: (x: number) => 1 / Math.tan(x),
		arcsec: (x: number) => Math.acos(1 / x),
		arccsc: (x: number) => Math.asin(1 / x),
		arccot: (x: number) => Math.atan(1 / x),
		sinh: (x: number) => Math.sinh(x),
		cosh: (x: number) => Math.cosh(x),
		tanh: (x: number) => Math.tanh(x),
		asinh: (x: number) => Math.asinh(x),
		acosh: (x: number) => Math.acosh(x),
		atanh: (x: number) => Math.atanh(x),
		sign: (x: number) => Math.sign(x),
		heaviside: (x: number) => (x < 0 ? 0 : x > 0 ? 1 : 0.5),
		dirac: (x: number) => (x === 0 ? Number.POSITIVE_INFINITY : 0),
		factorial: (value: number) => math.factorial(value),
		gamma: (value: number) => math.gamma(value),
		Γ: (value: number) => math.gamma(value)
	},
	{ override: true, silent: true }
);

const FUNCTION_TOKENS = [
	'arccsc',
	'arcsec',
	'arccot',
	'heaviside',
	'factorial',
	'gamma',
	'asinh',
	'acosh',
	'atanh',
	'sinh',
	'cosh',
	'tanh',
	'sqrt',
	'sign',
	'sin',
	'cos',
	'tan',
	'sec',
	'csc',
	'cot',
	'abs',
	'log',
	'ln',
	'exp',
	'Γ'
] as const;

const KNOWN_IDENTIFIERS = [...FUNCTION_TOKENS, 'pi', 'e', 'x', 'y', 't'] as const;
const COMPOUND_IDENTIFIERS = [...KNOWN_IDENTIFIERS].sort(
	(left, right) => right.length - left.length
);
const compileCache = new WeakMap<MathNode, EvalFunction>();

export type ExpressionSource = EvalFunction | MathNode | null;

export interface ParametricNodes {
	xNode: MathNode;
	yNode: MathNode;
	xCompiled: EvalFunction;
	yCompiled: EvalFunction;
	xRaw: string;
	yRaw: string;
}

export interface ParsedEquationResult {
	node: MathNode | null;
	error: string | null;
	isParametric: boolean;
	inequality: string | null;
	parametric: ParametricNodes | null;
	normalized: string;
}

export interface EquationSamplerInput {
	compiled: MathNode | null;
	compiledExpression: EvalFunction | null;
	isParametric: boolean;
	paramRange: [number, number];
	parametricNodes: ParametricNodes | null;
}

function isNumberToken(token: string): boolean {
	return /^\d*\.?\d+$/.test(token);
}

function isIdentifierToken(token: string): boolean {
	return /^[A-Za-zΓ_][A-Za-z0-9_]*$/.test(token);
}

function splitCompoundIdentifier(token: string): string[] {
	if (KNOWN_IDENTIFIERS.includes(token as (typeof KNOWN_IDENTIFIERS)[number])) {
		return [token];
	}

	const lower = token.toLowerCase();
	const result: string[] = [];
	let cursor = 0;

	while (cursor < token.length) {
		const match = COMPOUND_IDENTIFIERS.find((candidate) =>
			lower.slice(cursor).startsWith(candidate.toLowerCase())
		);

		if (!match) {
			return [token];
		}

		result.push(match);
		cursor += match.length;
	}

	return result;
}

function tokenize(expression: string): string[] {
	const matches =
		expression.match(
			/(?:\d*\.\d+|\d+\.?\d*|[A-Za-zΓ_][A-Za-z0-9_]*|<=|>=|==|!=|[()+\-*/^,;<>])/g
		) ?? [];

	return matches.flatMap((token) =>
		isIdentifierToken(token) ? splitCompoundIdentifier(token) : [token]
	);
}

function canEndValue(token: string): boolean {
	return isNumberToken(token) || isIdentifierToken(token) || token === ')';
}

function canStartValue(token: string): boolean {
	return isNumberToken(token) || isIdentifierToken(token) || token === '(';
}

function normalizeImplicitMultiplication(expression: string): string {
	const cleaned = expression.replace(/\s+/g, '').replaceAll('π', 'pi');
	const tokens = tokenize(cleaned);

	if (!tokens.length) {
		return '';
	}

	const result: string[] = [];

	for (const token of tokens) {
		const previous = result[result.length - 1];

		if (previous) {
			const previousIsFn = FUNCTION_TOKENS.includes(previous as (typeof FUNCTION_TOKENS)[number]);

			if (canEndValue(previous) && canStartValue(token) && !(previousIsFn && token === '(')) {
				result.push('*');
			}
		}

		result.push(token);
	}

	return result.join('');
}

function stripPrefix(raw: string): string {
	const trimmed = raw.trim();

	if (/^(?:y|[a-z]\(\s*x\s*\))\s*=/.test(trimmed)) {
		return trimmed.replace(/^(?:y|[a-z]\(\s*x\s*\))\s*=\s*/i, '');
	}

	return trimmed;
}

function compileNode(source: ExpressionSource): EvalFunction | null {
	if (!source) {
		return null;
	}

	if (
		typeof (source as EvalFunction).evaluate === 'function' &&
		!('compile' in (source as MathNode))
	) {
		return source as EvalFunction;
	}

	const node = source as MathNode;
	const cached = compileCache.get(node);

	if (cached) {
		return cached;
	}

	const compiled = node.compile();
	compileCache.set(node, compiled);

	return compiled;
}

function safeEvaluateCompiled(
	compiled: EvalFunction,
	scope: Record<string, number>
): number | null {
	try {
		return toFiniteNumber(compiled.evaluate(scope));
	} catch {
		return null;
	}
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value === 'boolean') {
		return Number(value);
	}

	if (value && typeof value === 'object') {
		if ('toNumber' in value && typeof value.toNumber === 'function') {
			const converted = value.toNumber();
			return Number.isFinite(converted) ? converted : null;
		}

		if ('re' in value && 'im' in value) {
			const real = typeof value.re === 'number' ? value.re : Number(value.re);
			const imaginary = typeof value.im === 'number' ? value.im : Number(value.im);

			if (Number.isFinite(real) && Math.abs(imaginary) < 1e-10) {
				return real;
			}
		}
	}

	return null;
}

function evaluate(
	source: ExpressionSource,
	variable: 'x' | 't',
	value: number,
	scope: Record<string, number> = {}
): number | null {
	const compiled = compileNode(source);

	if (!compiled) {
		return null;
	}

	return safeEvaluateCompiled(compiled, { ...scope, [variable]: value });
}

function evaluateParametric(nodes: ParametricNodes, t: number, scope: Record<string, number> = {}) {
	try {
		const x = toFiniteNumber(nodes.xCompiled.evaluate({ ...scope, t }));
		const y = toFiniteNumber(nodes.yCompiled.evaluate({ ...scope, t }));
		return x === null || y === null ? null : { x, y };
	} catch {
		return null;
	}
}

function pushSegment(segments: Float64Array[], points: number[]): void {
	if (points.length >= 4) {
		segments.push(Float64Array.from(points));
	}
}

function isDiscontinuity(previous: number, midpoint: number | null, next: number): boolean {
	if (midpoint === null) {
		return true;
	}

	const endpointMagnitude = Math.max(1, Math.abs(previous), Math.abs(next));
	const midpointMagnitude = Math.abs(midpoint);
	const signsFlip = Math.sign(previous) !== Math.sign(next);

	if (signsFlip && Math.abs(previous) + Math.abs(next) > 14) {
		return true;
	}

	return !signsFlip && midpointMagnitude > endpointMagnitude * 12 && midpointMagnitude > 48;
}

function refineCartesian(
	evaluator: EvalFunction,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	scope: Record<string, number>,
	depth: number,
	budget: { current: number; max: number },
	points: number[]
): void {
	if (depth >= 8 || budget.current >= budget.max) {
		points.push(x1, y1);
		return;
	}

	const midpointX = (x0 + x1) / 2;
	const midpointY = safeEvaluateCompiled(evaluator, { ...scope, x: midpointX });

	if (midpointY === null) {
		points.push(x1, y1);
		return;
	}

	const projected = y0 + ((y1 - y0) * (midpointX - x0)) / (x1 - x0 || 1);
	const normalizedError =
		Math.abs(midpointY - projected) / Math.max(1, Math.abs(y0), Math.abs(y1), Math.abs(midpointY));

	if (normalizedError > 0.025 || Math.abs(y1 - y0) > 1.5) {
		budget.current += 1;
		refineCartesian(evaluator, x0, y0, midpointX, midpointY, scope, depth + 1, budget, points);
		refineCartesian(evaluator, midpointX, midpointY, x1, y1, scope, depth + 1, budget, points);
		return;
	}

	points.push(x1, y1);
}

function refineParametric(
	nodes: ParametricNodes,
	t0: number,
	p0: { x: number; y: number },
	t1: number,
	p1: { x: number; y: number },
	scope: Record<string, number>,
	depth: number,
	budget: { current: number; max: number },
	points: number[]
): void {
	if (depth >= 8 || budget.current >= budget.max) {
		points.push(p1.x, p1.y);
		return;
	}

	const midpointT = (t0 + t1) / 2;
	const midpoint = evaluateParametric(nodes, midpointT, scope);

	if (!midpoint) {
		points.push(p1.x, p1.y);
		return;
	}

	const projectedX = (p0.x + p1.x) / 2;
	const projectedY = (p0.y + p1.y) / 2;
	const error =
		Math.hypot(midpoint.x - projectedX, midpoint.y - projectedY) /
		Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y));

	if (error > 0.02) {
		budget.current += 1;
		refineParametric(nodes, t0, p0, midpointT, midpoint, scope, depth + 1, budget, points);
		refineParametric(nodes, midpointT, midpoint, t1, p1, scope, depth + 1, budget, points);
		return;
	}

	points.push(p1.x, p1.y);
}

export function parseEquation(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();

	if (!trimmed) {
		return {
			node: null,
			error: 'Type an expression to plot.',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: ''
		};
	}

	const parametricMatch =
		trimmed.match(/x\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*y\s*\(\s*t\s*\)\s*=\s*(.+)$/i) ??
		trimmed.match(/y\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*x\s*\(\s*t\s*\)\s*=\s*(.+)$/i);

	if (parametricMatch) {
		const xRaw = normalizeImplicitMultiplication(parametricMatch[1]!);
		const yRaw = normalizeImplicitMultiplication(parametricMatch[2]!);

		try {
			const xNode = math.parse(xRaw);
			const yNode = math.parse(yRaw);
			return {
				node: null,
				error: null,
				isParametric: true,
				inequality: null,
				parametric: {
					xNode,
					yNode,
					xCompiled: xNode.compile(),
					yCompiled: yNode.compile(),
					xRaw,
					yRaw
				},
				normalized: `${xRaw};${yRaw}`
			};
		} catch (error) {
			return {
				node: null,
				error: error instanceof Error ? error.message : 'Unable to parse parametric equation.',
				isParametric: true,
				inequality: null,
				parametric: null,
				normalized: `${xRaw};${yRaw}`
			};
		}
	}

	const inequality = trimmed.match(/<=|>=|<|>/)?.[0] ?? null;

	if (inequality) {
		return {
			node: null,
			error: 'Inequality shading is reserved for a future Plotrix update.',
			isParametric: false,
			inequality,
			parametric: null,
			normalized: trimmed
		};
	}

	const normalized = normalizeImplicitMultiplication(stripPrefix(trimmed));
	const unknownIdentifiers = tokenize(normalized).filter(
		(token) =>
			isIdentifierToken(token) &&
			!KNOWN_IDENTIFIERS.includes(token as (typeof KNOWN_IDENTIFIERS)[number])
	);

	if (unknownIdentifiers.length) {
		const symbol = unknownIdentifiers[0]!;
		return {
			node: null,
			error: `Unknown symbol "${symbol}".`,
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized
		};
	}

	try {
		const node = math.parse(normalized);
		return {
			node,
			error: null,
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized
		};
	} catch (error) {
		return {
			node: null,
			error: error instanceof Error ? error.message : 'Unable to parse equation.',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized
		};
	}
}

export function evaluateSampled(
	source: ExpressionSource,
	xMin: number,
	xMax: number,
	samples: number,
	scope: Record<string, number> = {}
): Float64Array[] {
	const compiled = compileNode(source);

	if (!compiled) {
		return [];
	}

	const step = samples > 1 ? (xMax - xMin) / (samples - 1) : 0;
	const segments: Float64Array[] = [];
	let points: number[] = [];
	let previousX: number | null = null;
	let previousY: number | null = null;

	for (let index = 0; index < samples; index += 1) {
		const x = xMin + step * index;
		const y = safeEvaluateCompiled(compiled, { ...scope, x });

		if (y === null || Math.abs(y) > 1_000_000) {
			pushSegment(segments, points);
			points = [];
			previousX = null;
			previousY = null;
			continue;
		}

		if (previousX !== null && previousY !== null) {
			const midpointX = (previousX + x) / 2;
			const midpointY = safeEvaluateCompiled(compiled, { ...scope, x: midpointX });

			if (isDiscontinuity(previousY, midpointY, y)) {
				pushSegment(segments, points);
				points = [x, y];
				previousX = x;
				previousY = y;
				continue;
			}
		}

		points.push(x, y);
		previousX = x;
		previousY = y;
	}

	pushSegment(segments, points);

	return segments;
}

export function adaptiveSample(
	source: ExpressionSource,
	xMin: number,
	xMax: number,
	baseN: number,
	maxN: number,
	scope: Record<string, number> = {}
): Float64Array[] {
	const compiled = compileNode(source);

	if (!compiled) {
		return [];
	}

	const coarse = evaluateSampled(compiled, xMin, xMax, baseN, scope);

	return coarse.map((segment) => {
		const points = Array.from(segment);

		if (points.length <= 4) {
			return segment;
		}

		const refined: number[] = [points[0]!, points[1]!];
		const budget = { current: points.length / 2, max: maxN };

		for (let index = 0; index < points.length - 2; index += 2) {
			refineCartesian(
				compiled,
				points[index]!,
				points[index + 1]!,
				points[index + 2]!,
				points[index + 3]!,
				scope,
				0,
				budget,
				refined
			);
		}

		return Float64Array.from(refined);
	});
}

export function sampleParametric(
	nodes: ParametricNodes,
	tMin: number,
	tMax: number,
	baseN: number,
	maxN: number,
	scope: Record<string, number> = {}
): Float64Array[] {
	const step = baseN > 1 ? (tMax - tMin) / (baseN - 1) : 0;
	const coarse: Float64Array[] = [];
	let points: number[] = [];

	for (let index = 0; index < baseN; index += 1) {
		const t = tMin + step * index;
		const point = evaluateParametric(nodes, t, scope);

		if (!point) {
			pushSegment(coarse, points);
			points = [];
			continue;
		}

		points.push(point.x, point.y);
	}

	pushSegment(coarse, points);

	return coarse.map((segment) => {
		const values = Array.from(segment);

		if (values.length <= 4) {
			return segment;
		}

		const refined = [values[0]!, values[1]!];
		const budget = { current: values.length / 2, max: maxN };
		let previousT = tMin;

		for (let index = 0; index < values.length - 2; index += 2) {
			const nextT = previousT + step;
			refineParametric(
				nodes,
				previousT,
				{ x: values[index]!, y: values[index + 1]! },
				nextT,
				{ x: values[index + 2]!, y: values[index + 3]! },
				scope,
				0,
				budget,
				refined
			);
			previousT = nextT;
		}

		return Float64Array.from(refined);
	});
}

export function sampleEquation(
	input: EquationSamplerInput,
	xMin: number,
	xMax: number,
	baseN = 96,
	maxN = 640,
	scope: Record<string, number> = {}
): Float64Array[] {
	if (input.isParametric && input.parametricNodes) {
		return sampleParametric(
			input.parametricNodes,
			input.paramRange[0],
			input.paramRange[1],
			baseN,
			maxN,
			scope
		);
	}

	return adaptiveSample(input.compiledExpression ?? input.compiled, xMin, xMax, baseN, maxN, scope);
}

export function evaluateCartesianAt(
	source: ExpressionSource,
	x: number,
	scope: Record<string, number> = {}
): number | null {
	return evaluate(source, 'x', x, scope);
}

export function toLatex(raw: string): string {
	const parsed = parseEquation(raw);

	if (parsed.node) {
		try {
			return parsed.node.toTex({ parenthesis: 'auto' });
		} catch {
			return raw;
		}
	}

	if (parsed.parametric) {
		try {
			return `x(t)=${parsed.parametric.xNode.toTex({ parenthesis: 'auto' })}\\quad y(t)=${parsed.parametric.yNode.toTex({ parenthesis: 'auto' })}`;
		} catch {
			return raw;
		}
	}

	return raw;
}

export type { EvalFunction, MathNode };
