import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
	evaluateCartesianAt,
	evaluateCompiledWithScope,
	parseEquation,
	sampleEquation
} from '$lib/math/engine';

describe('parseEquation hardening', () => {
	for (const source of [
		'math.import(1)',
		'math.config(1)',
		'math.createUnit(1)',
		'math.derivative(x, x)'
	]) {
		test(`rejects unsafe callable target ${source}`, () => {
			const parsed = parseEquation(source, 'cartesian');
			assert.ok(parsed.error);
		});
	}
});

describe('equation evaluation', () => {
	test('evaluates safe compiled expressions through the runtime scope adapter', () => {
		const parsed = parseEquation('sin(x)', 'cartesian');
		assert.equal(parsed.error, null);
		assert.ok(parsed.compiledExpression);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, Math.PI / 2, {}), 1);
	});

	test('samples visible cartesian curves into drawable segments', () => {
		const parsed = parseEquation('x^2', 'cartesian');
		assert.equal(parsed.error, null);
		const segments = sampleEquation(
			{
				compiled: parsed.node,
				compiledExpression: parsed.compiledExpression,
				kind: parsed.kind,
				paramRange: [-10, 10],
				parametricNodes: parsed.parametric
			},
			-2,
			2,
			48,
			96,
			{}
		);

		assert.ok(segments.length > 0);
		assert.ok(segments[0]!.length >= 4);
	});

	test('evaluates piecewise cartesian branches in order', () => {
		const parsed = parseEquation('{x<0:-x,x>=0:x}', 'cartesian');
		assert.equal(parsed.error, null);
		assert.equal(parsed.kind, 'cartesian');
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, -3, {}), 3);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, 0, {}), 0);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, 2, {}), 2);
	});

	test('evaluates piecewise branches with compound conditions', () => {
		const parsed = parseEquation('{x<-1:x^2,-1<=x and x<1:x,x>=1:1}', 'cartesian');
		assert.equal(parsed.error, null);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, -2, {}), 4);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, 0.5, {}), 0.5);
		assert.equal(evaluateCartesianAt(parsed.compiledExpression, 4, {}), 1);
	});

	test('parses slope fields and evaluates with x,y scope', () => {
		const parsed = parseEquation('dy/dx = x - y', 'slopefield');
		assert.equal(parsed.error, null);
		assert.equal(parsed.kind, 'slopefield');
		assert.equal(evaluateCompiledWithScope(parsed.compiledExpression, { x: 3, y: 1 }), 2);
	});

	test('parses vector fields into paired component evaluators', () => {
		const parsed = parseEquation('x(t)=y; y(t)=-x', 'vectorfield');
		assert.equal(parsed.error, null);
		assert.equal(parsed.kind, 'vectorfield');
		assert.ok(parsed.parametric);
		assert.equal(
			evaluateCompiledWithScope(parsed.parametric?.xCompiled ?? null, { x: 2, y: 5 }),
			5
		);
		assert.equal(
			evaluateCompiledWithScope(parsed.parametric?.yCompiled ?? null, { x: 2, y: 5 }),
			-2
		);
	});

	test('evaluates statistical distribution functions', () => {
		const normal = parseEquation('normalPDF(x, 0, 1)', 'cartesian');
		assert.equal(normal.error, null);
		assert.ok(normal.compiledExpression);
		assert.ok(
			Math.abs((evaluateCartesianAt(normal.compiledExpression, 0, {}) ?? 0) - 0.39894228) < 1e-6
		);

		const cdf = parseEquation('normalCDF(x, 0, 1)', 'cartesian');
		assert.ok(
			Math.abs((evaluateCartesianAt(cdf.compiledExpression, 1, {}) ?? 0) - 0.8413447) < 1e-5
		);

		const binomial = parseEquation('binomialPDF(x, 10, 0.5)', 'cartesian');
		assert.ok(
			Math.abs((evaluateCartesianAt(binomial.compiledExpression, 5, {}) ?? 0) - 0.24609375) < 1e-8
		);
	});
});
