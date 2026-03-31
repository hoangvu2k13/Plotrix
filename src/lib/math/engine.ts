import { all, create, type MathNode } from 'mathjs';

import { LruMap } from '$lib/utils/lru';

const math = create(all!, {});

const LANCZOS_COEFFICIENTS = [
	0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
	12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7
];
const HALF_LOG_TWO_PI = 0.9189385332046727;

function logGamma(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return Number.NaN;
	}

	if (value < 0.5) {
		return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
	}

	const adjusted = value - 1;
	let series = LANCZOS_COEFFICIENTS[0]!;

	for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
		series += LANCZOS_COEFFICIENTS[index]! / (adjusted + index);
	}

	const t = adjusted + LANCZOS_COEFFICIENTS.length - 1.5;
	return HALF_LOG_TWO_PI + (adjusted + 0.5) * Math.log(t) - t + Math.log(series);
}

function erfApproximation(value: number): number {
	const sign = Math.sign(value) || 1;
	const x = Math.abs(value);
	const t = 1 / (1 + 0.3275911 * x);
	const polynomial =
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
	return sign * (1 - polynomial * Math.exp(-(x * x)));
}

function normalPdf(x: number, mu = 0, sigma = 1): number {
	if (!Number.isFinite(x) || !Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) {
		return Number.NaN;
	}

	const z = (x - mu) / sigma;
	return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function normalCdf(x: number, mu = 0, sigma = 1): number {
	if (!Number.isFinite(x) || !Number.isFinite(mu) || !Number.isFinite(sigma) || sigma <= 0) {
		return Number.NaN;
	}

	return 0.5 * (1 + erfApproximation((x - mu) / (sigma * Math.SQRT2)));
}

function binomialPdf(k: number, n: number, p: number): number {
	if (
		!Number.isInteger(k) ||
		!Number.isInteger(n) ||
		n < 0 ||
		k < 0 ||
		k > n ||
		!Number.isFinite(p) ||
		p <= 0 ||
		p >= 1
	) {
		return Number.NaN;
	}

	const logProbability =
		logGamma(n + 1) -
		logGamma(k + 1) -
		logGamma(n - k + 1) +
		k * Math.log(p) +
		(n - k) * Math.log(1 - p);
	return Math.exp(logProbability);
}

function poissonPdf(k: number, lambda: number): number {
	if (!Number.isInteger(k) || k < 0 || !Number.isFinite(lambda) || lambda <= 0) {
		return Number.NaN;
	}

	return Math.exp(k * Math.log(lambda) - lambda - logGamma(k + 1));
}

function tPdf(x: number, df: number): number {
	if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) {
		return Number.NaN;
	}

	const numerator = Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2));
	const denominator = Math.sqrt(df * Math.PI);
	return (numerator / denominator) * (1 + (x * x) / df) ** (-(df + 1) / 2);
}

function chiSquaredPdf(x: number, df: number): number {
	if (!Number.isFinite(x) || x < 0 || !Number.isFinite(df) || df <= 0) {
		return Number.NaN;
	}

	if (x === 0) {
		if (df === 2) {
			return 0.5;
		}

		return df < 2 ? Number.POSITIVE_INFINITY : 0;
	}

	return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - logGamma(df / 2));
}

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
		Γ: (value: number) => math.gamma(value),
		normalPDF: normalPdf,
		normalCDF: normalCdf,
		binomialPDF: binomialPdf,
		poissonPDF: poissonPdf,
		tPDF: tPdf,
		chiSquaredPDF: chiSquaredPdf
	},
	{ override: true, silent: true }
);

const FUNCTION_TOKENS = [
	'arccsc',
	'arcsec',
	'arccot',
	'heaviside',
	'factorial',
	'normalPDF',
	'normalCDF',
	'binomialPDF',
	'poissonPDF',
	'tPDF',
	'chiSquaredPDF',
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
	'min',
	'max',
	'pow',
	'Γ'
] as const;

const KNOWN_IDENTIFIERS = [...FUNCTION_TOKENS, 'pi', 'e', 'i', 'x', 'y', 't', 'r'] as const;
const RESERVED_VARIABLES = new Set(['x', 'y', 't', 'e', 'i', 'r']);
const COMPOUND_IDENTIFIERS = [...KNOWN_IDENTIFIERS].sort(
	(left, right) => right.length - left.length
);
export interface EvalFunction {
	evaluate(scope: Record<string, number> | Map<string, number>): unknown;
}

const nativeCompileCache = new LruMap<string, EvalFunction>(1000);
const SAFE_EXPRESSION_CHARS = /^[0-9a-zA-Z\s+\-*/^().,_=<>!;:{}πθΓ|]+$/;
const BLOCKED_EXPRESSION_KEYWORDS =
	/\b(?:import|require|fetch|document|window|eval|Function|prototype|__proto__|constructor|globalThis)\b/i;
const DISALLOWED_NODE_TYPES = new Set([
	'AccessorNode',
	'ArrayNode',
	'AssignmentNode',
	'BlockNode',
	'ConditionalNode',
	'FunctionAssignmentNode',
	'IndexNode',
	'ObjectNode',
	'RangeNode'
]);
const SAFE_SCOPE_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const BLOCKED_SCOPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_SCOPE_MAP = new Map<string, number>();

export type EquationKind =
	| 'cartesian'
	| 'polar'
	| 'parametric'
	| 'implicit'
	| 'inequality'
	| 'slopefield'
	| 'vectorfield';
export type ExpressionSource = EvalFunction | MathNode | null;

export interface ParametricNodes {
	xNode: MathNode;
	yNode: MathNode;
	xCompiled: EvalFunction;
	yCompiled: EvalFunction;
	xRaw: string;
	yRaw: string;
}

export interface InequalityNodes {
	operator: '>' | '<' | '>=' | '<=';
	lhsNode: MathNode;
	rhsNode: MathNode;
	lhsCompiled: EvalFunction;
	rhsCompiled: EvalFunction;
	lhsRaw: string;
	rhsRaw: string;
	isExplicitYBoundary: boolean;
}

export interface ParsedEquationResult {
	node: MathNode | null;
	compiledExpression: EvalFunction | null;
	error: string | null;
	kind: EquationKind;
	isParametric: boolean;
	inequality: InequalityNodes | null;
	parametric: ParametricNodes | null;
	normalized: string;
	freeVariables: string[];
}

export interface EquationSamplerInput {
	compiled: MathNode | null;
	compiledExpression: EvalFunction | null;
	kind: EquationKind;
	paramRange: [number, number];
	parametricNodes: ParametricNodes | null;
}

interface PiecewiseConditionClause {
	inequality: InequalityNodes;
	normalized: string;
}

interface PiecewiseBranch {
	conditions: PiecewiseConditionClause[];
	conditionSource: string;
	expressionNode: MathNode;
	expressionCompiled: EvalFunction;
	expressionRaw: string;
}

function isNumberToken(token: string): boolean {
	return /^\d*\.?\d+$/.test(token);
}

function isIdentifierToken(token: string): boolean {
	return /^[A-Za-zΓ_θ][A-Za-z0-9_]*$/.test(token);
}

function splitCompoundIdentifier(token: string): string[] {
	if (KNOWN_IDENTIFIERS.includes(token as (typeof KNOWN_IDENTIFIERS)[number])) {
		return [token];
	}

	if (token.length === 1 || token === 'θ') {
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
			/(?:\d*\.\d+|\d+\.?\d*|[A-Za-zΓ_θ][A-Za-z0-9_]*|<=|>=|==|!=|[()+\-*/^,;=<>])/g
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
	const cleaned = expression.replace(/\s+/g, '').replaceAll('π', 'pi').replaceAll('θ', 't');
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

export function isSafeExpressionInput(raw: string): boolean {
	const trimmed = raw.trim();

	if (!trimmed) {
		return true;
	}

	if (!SAFE_EXPRESSION_CHARS.test(trimmed)) {
		return false;
	}

	return !BLOCKED_EXPRESSION_KEYWORDS.test(trimmed);
}

function stripPrefix(raw: string, kind: EquationKind): string {
	const trimmed = raw.trim();

	if (kind === 'cartesian' && /^(?:y|[a-z]\(\s*x\s*\))\s*=/.test(trimmed)) {
		return trimmed.replace(/^(?:y|[a-z]\(\s*x\s*\))\s*=\s*/i, '');
	}

	if (kind === 'polar' && /^(?:r|θ)\s*=/.test(trimmed)) {
		return trimmed.replace(/^(?:r|θ)\s*=\s*/i, '');
	}

	if (kind === 'slopefield' && /^dy\/dx\s*=/.test(trimmed)) {
		return trimmed.replace(/^dy\/dx\s*=\s*/i, '');
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
	const cacheKey = node.toString();
	const cached = nativeCompileCache.get(cacheKey);

	if (cached) {
		return cached;
	}

	if (!isSafeMathNode(node)) {
		throw new Error('Expression contains unsupported syntax.');
	}

	const compiled = node.compile() as EvalFunction;
	nativeCompileCache.set(cacheKey, compiled);
	return compiled;
}

function compileNativeExpression(source: string): EvalFunction {
	const normalized = source.trim();
	const cacheKey = normalized;
	const cached = nativeCompileCache.get(cacheKey);

	if (cached) {
		return cached;
	}

	const node = math.parse(normalized);

	if (!isSafeMathNode(node)) {
		throw new Error('Expression contains unsupported syntax.');
	}

	const compiled = node.compile() as EvalFunction;
	nativeCompileCache.set(cacheKey, compiled);
	return compiled;
}

function isSafeMathNode(node: MathNode): boolean {
	let safe = true;

	node.traverse((current, path, parent) => {
		if (!safe) {
			return;
		}

		if (DISALLOWED_NODE_TYPES.has(current.type)) {
			safe = false;
			return;
		}

		if (current.type === 'FunctionNode') {
			const fnName = String((current as unknown as { fn?: { name?: string } }).fn?.name ?? '');

			if (!FUNCTION_TOKENS.includes(fnName as (typeof FUNCTION_TOKENS)[number])) {
				safe = false;
			}
		}

		if (current.type === 'SymbolNode') {
			const name = String((current as unknown as { name: string }).name);

			if (BLOCKED_SCOPE_KEYS.has(name)) {
				safe = false;
				return;
			}

			if (
				parent?.type === 'FunctionNode' &&
				path === 'fn' &&
				!FUNCTION_TOKENS.includes(name as (typeof FUNCTION_TOKENS)[number])
			) {
				safe = false;
			}
		}
	});

	return safe;
}

export function toFiniteNumber(value: unknown): number | null {
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

function safeEvaluateCompiled(
	compiled: EvalFunction,
	scope: Record<string, number>
): number | null {
	try {
		return toFiniteNumber(compiled.evaluate(toSafeScope(scope)));
	} catch {
		return null;
	}
}

function toSafeScope(scope: Record<string, number>): Map<string, number> {
	SAFE_SCOPE_MAP.clear();

	for (const [key, value] of Object.entries(scope)) {
		if (!SAFE_SCOPE_KEY.test(key) || BLOCKED_SCOPE_KEYS.has(key) || !Number.isFinite(value)) {
			continue;
		}

		SAFE_SCOPE_MAP.set(key, value);
	}

	return SAFE_SCOPE_MAP;
}

function evaluateWithVariable(
	source: ExpressionSource,
	variable: 'x' | 'y' | 't',
	value: number,
	scope: Record<string, number> = {}
): number | null {
	const compiled = compileNode(source);

	if (!compiled) {
		return null;
	}

	return safeEvaluateCompiled(compiled, { ...scope, [variable]: value });
}

export function evaluateCompiledWithScope(
	source: ExpressionSource,
	scope: Record<string, number>
): number | null {
	const compiled = compileNode(source);
	return compiled ? safeEvaluateCompiled(compiled, scope) : null;
}

export function evaluateParametric(
	nodes: ParametricNodes,
	t: number,
	scope: Record<string, number> = {}
) {
	const safeScope = { ...scope, t };
	const x = safeEvaluateCompiled(nodes.xCompiled, safeScope);
	const y = safeEvaluateCompiled(nodes.yCompiled, safeScope);
	return x === null || y === null ? null : { x, y };
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
	points: number[],
	perSegmentBudget: { current: number; max: number }
): void {
	if (
		depth >= 8 ||
		budget.current >= budget.max ||
		perSegmentBudget.current >= perSegmentBudget.max
	) {
		points.push(x1, y1);
		return;
	}

	const midpointX = (x0 + x1) / 2;
	const previousX = scope.x;
	scope.x = midpointX;
	const midpointY = safeEvaluateCompiled(evaluator, scope);

	if (previousX === undefined) {
		delete scope.x;
	} else {
		scope.x = previousX;
	}

	if (midpointY === null) {
		points.push(x1, y1);
		return;
	}

	const projected = y0 + ((y1 - y0) * (midpointX - x0)) / (x1 - x0 || 1);
	const normalizedError =
		Math.abs(midpointY - projected) / Math.max(1, Math.abs(y0), Math.abs(y1), Math.abs(midpointY));

	if (normalizedError > 0.025 || Math.abs(y1 - y0) > 1.5) {
		budget.current += 1;
		perSegmentBudget.current += 1;
		refineCartesian(
			evaluator,
			x0,
			y0,
			midpointX,
			midpointY,
			scope,
			depth + 1,
			budget,
			points,
			perSegmentBudget
		);
		refineCartesian(
			evaluator,
			midpointX,
			midpointY,
			x1,
			y1,
			scope,
			depth + 1,
			budget,
			points,
			perSegmentBudget
		);
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

function parseNode(source: string): { node: MathNode | null; error: string | null } {
	try {
		const node = math.parse(source);

		if (!isSafeMathNode(node)) {
			return {
				node: null,
				error: 'Expression contains unsupported syntax.'
			};
		}

		return { node, error: null };
	} catch (error) {
		return {
			node: null,
			error: error instanceof Error ? error.message : 'Unable to parse expression.'
		};
	}
}

function splitTopLevel(source: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];

		if (character === '(' || character === '{') {
			depth += 1;
			continue;
		}

		if (character === ')' || character === '}') {
			depth = Math.max(0, depth - 1);
			continue;
		}

		if (depth === 0 && character === separator) {
			parts.push(source.slice(start, index).trim());
			start = index + 1;
		}
	}

	parts.push(source.slice(start).trim());
	return parts.filter((entry) => entry.length > 0);
}

function splitTopLevelOnce(source: string, separator: string): [string, string] | null {
	let depth = 0;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];

		if (character === '(' || character === '{') {
			depth += 1;
			continue;
		}

		if (character === ')' || character === '}') {
			depth = Math.max(0, depth - 1);
			continue;
		}

		if (depth === 0 && character === separator) {
			return [source.slice(0, index).trim(), source.slice(index + 1).trim()];
		}
	}

	return null;
}

function splitPiecewiseConditions(source: string): string[] {
	const clauses: string[] = [];
	let depth = 0;
	let start = 0;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];

		if (character === '(') {
			depth += 1;
			continue;
		}

		if (character === ')') {
			depth = Math.max(0, depth - 1);
			continue;
		}

		if (
			depth === 0 &&
			source.slice(index, index + 3).toLowerCase() === 'and' &&
			(index === 0 || /\s/.test(source[index - 1] ?? '')) &&
			(index + 3 >= source.length || /\s/.test(source[index + 3] ?? ''))
		) {
			clauses.push(source.slice(start, index).trim());
			start = index + 3;
			index += 2;
		}
	}

	clauses.push(source.slice(start).trim());
	return clauses.filter((entry) => entry.length > 0);
}

function validateIdentifiers(tokens: string[]): string | null {
	for (const token of tokens) {
		if (!isIdentifierToken(token)) {
			continue;
		}

		if (KNOWN_IDENTIFIERS.includes(token as (typeof KNOWN_IDENTIFIERS)[number])) {
			continue;
		}

		if (token === 'θ' || token.length === 1) {
			continue;
		}

		return token;
	}

	return null;
}

function extractVariablesFromRaw(raw: string): string[] {
	const matches = raw.match(/[A-Za-z]/g) ?? [];
	return [...new Set(matches)]
		.map((value) => value.toLowerCase())
		.filter(
			(value) =>
				value.length === 1 &&
				!RESERVED_VARIABLES.has(value) &&
				!FUNCTION_TOKENS.includes(value as never)
		)
		.sort();
}

export function extractFreeVariables(raw: string, node?: MathNode | null): string[] {
	if (!node) {
		return extractVariablesFromRaw(raw);
	}

	const variables = new Set<string>();
	node.traverse((current, path, parent) => {
		if (current.type !== 'SymbolNode') {
			return;
		}

		const name = String((current as unknown as { name: string }).name);

		if (name.length !== 1 || RESERVED_VARIABLES.has(name)) {
			return;
		}

		if (parent?.type === 'FunctionNode' && path === 'fn') {
			return;
		}

		variables.add(name);
	});

	return [...variables].sort();
}

function parseParametric(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();
	const match =
		trimmed.match(/x\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*y\s*\(\s*t\s*\)\s*=\s*(.+)$/i) ??
		trimmed.match(/y\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*x\s*\(\s*t\s*\)\s*=\s*(.+)$/i);

	if (!match) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Use x(t)=...; y(t)=... for parametric curves.',
			kind: 'parametric',
			isParametric: true,
			inequality: null,
			parametric: null,
			normalized: '',
			freeVariables: []
		};
	}

	const xRaw = normalizeImplicitMultiplication(match[1]!);
	const yRaw = normalizeImplicitMultiplication(match[2]!);
	const invalid = validateIdentifiers([...tokenize(xRaw), ...tokenize(yRaw)]);

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind: 'parametric',
			isParametric: true,
			inequality: null,
			parametric: null,
			normalized: `${xRaw};${yRaw}`,
			freeVariables: []
		};
	}

	try {
		const xParsed = parseNode(xRaw);
		const yParsed = parseNode(yRaw);

		if (!xParsed.node || !yParsed.node) {
			return {
				node: null,
				compiledExpression: null,
				error: xParsed.error ?? yParsed.error,
				kind: 'parametric',
				isParametric: true,
				inequality: null,
				parametric: null,
				normalized: `${xRaw};${yRaw}`,
				freeVariables: []
			};
		}

		const xNode = xParsed.node;
		const yNode = yParsed.node;
		return {
			node: null,
			compiledExpression: null,
			error: null,
			kind: 'parametric',
			isParametric: true,
			inequality: null,
			parametric: {
				xNode,
				yNode,
				xCompiled: compileNativeExpression(xRaw),
				yCompiled: compileNativeExpression(yRaw),
				xRaw,
				yRaw
			},
			normalized: `${xRaw};${yRaw}`,
			freeVariables: [
				...new Set([...extractFreeVariables(xRaw, xNode), ...extractFreeVariables(yRaw, yNode)])
			].sort()
		};
	} catch (error) {
		return {
			node: null,
			compiledExpression: null,
			error: error instanceof Error ? error.message : 'Unable to parse parametric equation.',
			kind: 'parametric',
			isParametric: true,
			inequality: null,
			parametric: null,
			normalized: `${xRaw};${yRaw}`,
			freeVariables: []
		};
	}
}

function parseInequality(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();
	const match = trimmed.match(/^(.*?)(<=|>=|<|>)(.*)$/);

	if (!match) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Unable to parse inequality.',
			kind: 'inequality',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: trimmed,
			freeVariables: []
		};
	}

	const lhsRaw = normalizeImplicitMultiplication(match[1]!);
	const rhsRaw = normalizeImplicitMultiplication(match[3]!);
	const invalid = validateIdentifiers([...tokenize(lhsRaw), ...tokenize(rhsRaw)]);

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind: 'inequality',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: `${lhsRaw}${match[2]}${rhsRaw}`,
			freeVariables: []
		};
	}

	const lhs = parseNode(lhsRaw);
	const rhs = parseNode(rhsRaw);

	if (!lhs.node || !rhs.node) {
		return {
			node: null,
			compiledExpression: null,
			error: lhs.error ?? rhs.error,
			kind: 'inequality',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: `${lhsRaw}${match[2]}${rhsRaw}`,
			freeVariables: []
		};
	}

	const node = math.parse(`(${lhsRaw}) - (${rhsRaw})`);
	return {
		node,
		compiledExpression: compileNativeExpression(`(${lhsRaw}) - (${rhsRaw})`),
		error: null,
		kind: 'inequality',
		isParametric: false,
		inequality: {
			operator: match[2] as InequalityNodes['operator'],
			lhsNode: lhs.node,
			rhsNode: rhs.node,
			lhsCompiled: compileNativeExpression(lhsRaw),
			rhsCompiled: compileNativeExpression(rhsRaw),
			lhsRaw,
			rhsRaw,
			isExplicitYBoundary: lhsRaw === 'y' || rhsRaw === 'y'
		},
		parametric: null,
		normalized: `${lhsRaw}${match[2]}${rhsRaw}`,
		freeVariables: [
			...new Set([
				...extractFreeVariables(lhsRaw, lhs.node),
				...extractFreeVariables(rhsRaw, rhs.node)
			])
		].sort()
	};
}

function matchesInequality(
	inequality: InequalityNodes,
	scope: Record<string, number> | Map<string, number>
): boolean {
	const normalizedScope = scope instanceof Map ? Object.fromEntries(scope.entries()) : { ...scope };
	const left = safeEvaluateCompiled(inequality.lhsCompiled, normalizedScope);
	const right = safeEvaluateCompiled(inequality.rhsCompiled, normalizedScope);

	if (left === null || right === null) {
		return false;
	}

	switch (inequality.operator) {
		case '<':
			return left < right;
		case '<=':
			return left <= right;
		case '>':
			return left > right;
		case '>=':
			return left >= right;
	}
}

function parsePiecewise(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();

	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Use {condition: expression, ...} for piecewise functions.',
			kind: 'cartesian',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: trimmed,
			freeVariables: []
		};
	}

	const body = trimmed.slice(1, -1).trim();

	if (!body.length) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Add at least one condition: expression pair.',
			kind: 'cartesian',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: '{}',
			freeVariables: []
		};
	}

	const entries = splitTopLevel(body, ',');
	const branches: PiecewiseBranch[] = [];
	const freeVariables = new Set<string>();
	const normalizedPairs: string[] = [];

	for (const entry of entries) {
		const pair = splitTopLevelOnce(entry, ':');

		if (!pair) {
			return {
				node: null,
				compiledExpression: null,
				error: 'Each piecewise branch must use condition: expression syntax.',
				kind: 'cartesian',
				isParametric: false,
				inequality: null,
				parametric: null,
				normalized: trimmed,
				freeVariables: []
			};
		}

		const [rawCondition, rawExpression] = pair;
		const clauses = splitPiecewiseConditions(rawCondition);
		const parsedClauses: PiecewiseConditionClause[] = [];

		for (const clause of clauses) {
			const parsedCondition = parseInequality(clause);

			if (!parsedCondition.inequality || parsedCondition.error) {
				return {
					node: null,
					compiledExpression: null,
					error: parsedCondition.error ?? 'Invalid piecewise condition.',
					kind: 'cartesian',
					isParametric: false,
					inequality: null,
					parametric: null,
					normalized: trimmed,
					freeVariables: []
				};
			}

			parsedClauses.push({
				inequality: parsedCondition.inequality,
				normalized: parsedCondition.normalized
			});

			for (const variable of parsedCondition.freeVariables) {
				freeVariables.add(variable);
			}
		}

		const expressionRaw = normalizeImplicitMultiplication(stripPrefix(rawExpression, 'cartesian'));
		const invalid = validateIdentifiers(tokenize(expressionRaw));

		if (invalid) {
			return {
				node: null,
				compiledExpression: null,
				error: `Unknown symbol "${invalid}".`,
				kind: 'cartesian',
				isParametric: false,
				inequality: null,
				parametric: null,
				normalized: trimmed,
				freeVariables: []
			};
		}

		const expression = parseNode(expressionRaw);

		if (!expression.node || expression.error) {
			return {
				node: null,
				compiledExpression: null,
				error: expression.error ?? 'Invalid piecewise branch expression.',
				kind: 'cartesian',
				isParametric: false,
				inequality: null,
				parametric: null,
				normalized: trimmed,
				freeVariables: []
			};
		}

		for (const variable of extractFreeVariables(expressionRaw, expression.node)) {
			freeVariables.add(variable);
		}

		branches.push({
			conditions: parsedClauses,
			conditionSource: parsedClauses.map((clause) => clause.normalized).join(' and '),
			expressionNode: expression.node,
			expressionCompiled: compileNativeExpression(expressionRaw),
			expressionRaw
		});
		normalizedPairs.push(
			`${parsedClauses.map((clause) => clause.normalized).join(' and ')}:${expressionRaw}`
		);
	}

	const compiledExpression: EvalFunction = {
		evaluate(scope) {
			for (const branch of branches) {
				if (branch.conditions.every((clause) => matchesInequality(clause.inequality, scope))) {
					const normalizedScope =
						scope instanceof Map ? Object.fromEntries(scope.entries()) : { ...scope };
					return safeEvaluateCompiled(branch.expressionCompiled, normalizedScope) ?? Number.NaN;
				}
			}

			return Number.NaN;
		}
	};

	return {
		node: null,
		compiledExpression,
		error: null,
		kind: 'cartesian',
		isParametric: false,
		inequality: null,
		parametric: null,
		normalized: `{${normalizedPairs.join(',')}}`,
		freeVariables: [...freeVariables].sort()
	};
}

function parseImplicit(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();
	const match = trimmed.match(/^(.*)=(.*)$/);

	if (!match) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Use lhs = rhs for implicit equations.',
			kind: 'implicit',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: trimmed,
			freeVariables: []
		};
	}

	const lhsRaw = normalizeImplicitMultiplication(match[1]!);
	const rhsRaw = normalizeImplicitMultiplication(match[2]!);
	const invalid = validateIdentifiers([...tokenize(lhsRaw), ...tokenize(rhsRaw)]);

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind: 'implicit',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: `${lhsRaw}=${rhsRaw}`,
			freeVariables: []
		};
	}

	const parsed = parseNode(`(${lhsRaw}) - (${rhsRaw})`);
	return {
		node: parsed.node,
		compiledExpression: parsed.node ? compileNativeExpression(`(${lhsRaw}) - (${rhsRaw})`) : null,
		error: parsed.error,
		kind: 'implicit',
		isParametric: false,
		inequality: null,
		parametric: null,
		normalized: `${lhsRaw}=${rhsRaw}`,
		freeVariables: extractFreeVariables(`${lhsRaw}${rhsRaw}`, parsed.node)
	};
}

function parseSlopeField(raw: string): ParsedEquationResult {
	const normalized = normalizeImplicitMultiplication(stripPrefix(raw, 'slopefield'));
	const invalid = validateIdentifiers(tokenize(normalized));

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind: 'slopefield',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized,
			freeVariables: []
		};
	}

	const parsed = parseNode(normalized);
	const freeVariables = extractFreeVariables(normalized, parsed.node);

	return {
		node: parsed.node,
		compiledExpression: parsed.node ? compileNativeExpression(normalized) : null,
		error: parsed.error,
		kind: 'slopefield',
		isParametric: false,
		inequality: null,
		parametric: null,
		normalized,
		freeVariables: [...new Set([...freeVariables, 'x', 'y'])].sort()
	};
}

function parseVectorField(raw: string): ParsedEquationResult {
	const trimmed = raw.trim();
	const match =
		trimmed.match(/x\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*y\s*\(\s*t\s*\)\s*=\s*(.+)$/i) ??
		trimmed.match(/y\s*\(\s*t\s*\)\s*=\s*([^;\n]+)\s*[;,\n]\s*x\s*\(\s*t\s*\)\s*=\s*(.+)$/i);
	const parts = match ? [match[1]!, match[2]!] : splitTopLevel(trimmed, ';');

	if (parts.length !== 2) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Use P(x,y); Q(x,y) for vector fields.',
			kind: 'vectorfield',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: trimmed,
			freeVariables: []
		};
	}

	const xRaw = normalizeImplicitMultiplication(parts[0]!);
	const yRaw = normalizeImplicitMultiplication(parts[1]!);
	const invalid = validateIdentifiers([...tokenize(xRaw), ...tokenize(yRaw)]);

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind: 'vectorfield',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: `${xRaw};${yRaw}`,
			freeVariables: []
		};
	}

	const xParsed = parseNode(xRaw);
	const yParsed = parseNode(yRaw);

	if (!xParsed.node || !yParsed.node) {
		return {
			node: null,
			compiledExpression: null,
			error: xParsed.error ?? yParsed.error,
			kind: 'vectorfield',
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized: `${xRaw};${yRaw}`,
			freeVariables: []
		};
	}

	return {
		node: null,
		compiledExpression: null,
		error: null,
		kind: 'vectorfield',
		isParametric: false,
		inequality: null,
		// Reuse the parametric pair container for vector-field P/Q component evaluators.
		parametric: {
			xNode: xParsed.node,
			yNode: yParsed.node,
			xCompiled: compileNativeExpression(xRaw),
			yCompiled: compileNativeExpression(yRaw),
			xRaw,
			yRaw
		},
		normalized: `${xRaw};${yRaw}`,
		freeVariables: [
			...new Set([
				...extractFreeVariables(xRaw, xParsed.node),
				...extractFreeVariables(yRaw, yParsed.node),
				'x',
				'y'
			])
		].sort()
	};
}

export function parseEquation(raw: string, kind: EquationKind = 'cartesian'): ParsedEquationResult {
	const trimmed = raw.trim();

	if (!trimmed) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Type an expression to plot.',
			kind,
			isParametric: kind === 'parametric',
			inequality: null,
			parametric: null,
			normalized: '',
			freeVariables: []
		};
	}

	if (!isSafeExpressionInput(trimmed)) {
		return {
			node: null,
			compiledExpression: null,
			error: 'Expression contains unsupported or unsafe tokens.',
			kind,
			isParametric: kind === 'parametric',
			inequality: null,
			parametric: null,
			normalized: '',
			freeVariables: []
		};
	}

	if (kind === 'parametric') {
		return parseParametric(trimmed);
	}

	if (kind === 'slopefield') {
		return parseSlopeField(trimmed);
	}

	if (kind === 'vectorfield') {
		return parseVectorField(trimmed);
	}

	if (kind === 'cartesian' && trimmed.startsWith('{')) {
		return parsePiecewise(trimmed);
	}

	if (kind === 'inequality' || /<=|>=|<|>/.test(trimmed)) {
		return parseInequality(trimmed);
	}

	if (kind === 'implicit') {
		return parseImplicit(trimmed);
	}

	const normalized = normalizeImplicitMultiplication(stripPrefix(trimmed, kind));
	const invalid = validateIdentifiers(tokenize(normalized));

	if (invalid) {
		return {
			node: null,
			compiledExpression: null,
			error: `Unknown symbol "${invalid}".`,
			kind,
			isParametric: false,
			inequality: null,
			parametric: null,
			normalized,
			freeVariables: []
		};
	}

	const parsed = parseNode(normalized);
	return {
		node: parsed.node,
		compiledExpression: parsed.node ? compileNativeExpression(normalized) : null,
		error: parsed.error,
		kind,
		isParametric: false,
		inequality: null,
		parametric: null,
		normalized,
		freeVariables: extractFreeVariables(normalized, parsed.node)
	};
}

export function evaluateSampled(
	source: ExpressionSource,
	xMin: number,
	xMax: number,
	samples: number,
	scope: Record<string, number> = {},
	variable: 'x' | 't' = 'x'
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
	const evalScope = { ...scope } as Record<string, number>;

	for (let index = 0; index < samples; index += 1) {
		const x = xMin + step * index;
		evalScope[variable] = x;
		const y = safeEvaluateCompiled(compiled, evalScope);

		if (y === null || Math.abs(y) > 1_000_000) {
			pushSegment(segments, points);
			points = [];
			previousX = null;
			previousY = null;
			continue;
		}

		if (previousX !== null && previousY !== null) {
			const midpointX = (previousX + x) / 2;
			evalScope[variable] = midpointX;
			const midpointY = safeEvaluateCompiled(compiled, evalScope);

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
	scope: Record<string, number> = {},
	variable: 'x' | 't' = 'x'
): Float64Array[] {
	const compiled = compileNode(source);

	if (!compiled) {
		return [];
	}

	const coarse = evaluateSampled(compiled, xMin, xMax, baseN, scope, variable);

	return coarse.map((segment) => {
		const points = Array.from(segment);

		if (points.length <= 4 || variable !== 'x') {
			return segment;
		}

		const refined: number[] = [points[0]!, points[1]!];
		const budget = { current: points.length / 2, max: maxN };
		const refinementScope = { ...scope };

		for (let index = 0; index < points.length - 2; index += 2) {
			const perSegmentBudget = { current: 0, max: 32 };
			refineCartesian(
				compiled,
				points[index]!,
				points[index + 1]!,
				points[index + 2]!,
				points[index + 3]!,
				refinementScope,
				0,
				budget,
				refined,
				perSegmentBudget
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
	const safeBaseN = Math.min(Math.max(baseN, 48), 1200);
	const safeMaxN = Math.max(safeBaseN, maxN);

	if (input.kind === 'parametric' && input.parametricNodes) {
		return sampleParametric(
			input.parametricNodes,
			input.paramRange[0],
			input.paramRange[1],
			safeBaseN,
			safeMaxN,
			scope
		);
	}

	if (input.kind === 'polar') {
		return adaptiveSample(
			input.compiledExpression ?? input.compiled,
			xMin,
			xMax,
			safeBaseN,
			safeMaxN,
			scope,
			't'
		);
	}

	if (
		input.kind === 'inequality' ||
		input.kind === 'implicit' ||
		input.kind === 'slopefield' ||
		input.kind === 'vectorfield'
	) {
		return [];
	}

	return adaptiveSample(
		input.compiledExpression ?? input.compiled,
		xMin,
		xMax,
		safeBaseN,
		safeMaxN,
		scope,
		'x'
	);
}

export function evaluateCartesianAt(
	source: ExpressionSource,
	x: number,
	scope: Record<string, number> = {}
): number | null {
	return evaluateWithVariable(source, 'x', x, scope);
}

export function evaluatePolarAt(
	source: ExpressionSource,
	t: number,
	scope: Record<string, number> = {}
): number | null {
	return evaluateWithVariable(source, 't', t, scope);
}

export function evaluateImplicitAt(
	source: ExpressionSource,
	x: number,
	y: number,
	scope: Record<string, number> = {}
): number | null {
	return evaluateCompiledWithScope(source, { ...scope, x, y });
}

export function evaluateInequalityBoundaryAt(
	inequality: InequalityNodes,
	x: number,
	scope: Record<string, number> = {}
): number | null {
	if (inequality.lhsRaw === 'y') {
		return safeEvaluateCompiled(inequality.rhsCompiled, { ...scope, x });
	}

	if (inequality.rhsRaw === 'y') {
		return safeEvaluateCompiled(inequality.lhsCompiled, { ...scope, x });
	}

	return null;
}

export function toLatex(raw: string, kind: EquationKind = 'cartesian'): string {
	const parsed = parseEquation(raw, kind);

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

	if (parsed.inequality) {
		try {
			return `${parsed.inequality.lhsNode.toTex({ parenthesis: 'auto' })}${parsed.inequality.operator}${parsed.inequality.rhsNode.toTex({ parenthesis: 'auto' })}`;
		} catch {
			return raw;
		}
	}

	return raw;
}

export { math };
export type { MathNode };
