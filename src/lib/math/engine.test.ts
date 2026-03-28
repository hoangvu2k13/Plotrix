import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateCartesianAt, parseEquation, sampleEquation } from '$lib/math/engine';

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
});
