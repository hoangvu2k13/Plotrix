const DEFAULT_DERIVATIVE_STEP = 1e-7;

export function finiteValue(value: number): number | null {
	return Number.isFinite(value) && !Number.isNaN(value) ? value : null;
}

export function derivative(
	evaluate: (x: number) => number,
	x: number,
	step = DEFAULT_DERIVATIVE_STEP
): number | null {
	const left = finiteValue(evaluate(x - step));
	const right = finiteValue(evaluate(x + step));

	if (left === null || right === null) {
		return null;
	}

	return (right - left) / (2 * step);
}

export function secondDerivative(
	evaluate: (x: number) => number,
	x: number,
	step = DEFAULT_DERIVATIVE_STEP
): number | null {
	const left = finiteValue(evaluate(x - step));
	const center = finiteValue(evaluate(x));
	const right = finiteValue(evaluate(x + step));

	if (left === null || center === null || right === null) {
		return null;
	}

	return (left - 2 * center + right) / (step * step);
}

export function bisect(
	evaluate: (x: number) => number | null,
	left: number,
	right: number,
	iterations = 40
): number | null {
	let a = left;
	let b = right;
	let fa = evaluate(a);
	const fb = evaluate(b);

	if (fa === null || fb === null) {
		return null;
	}

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const midpoint = (a + b) / 2;
		const fm = evaluate(midpoint);

		if (fm === null) {
			return null;
		}

		if (Math.sign(fa) === Math.sign(fm)) {
			a = midpoint;
			fa = fm;
		} else {
			b = midpoint;
		}
	}

	return (a + b) / 2;
}

export function cluster(values: number[], gap = 0.02): number[] {
	if (!values.length) {
		return [];
	}

	const sorted = [...values].sort((left, right) => left - right);
	const buckets: number[][] = [[sorted[0]!]];

	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index]!;
		const bucket = buckets[buckets.length - 1]!;
		const previous = bucket[bucket.length - 1]!;

		if (Math.abs(current - previous) <= gap) {
			bucket.push(current);
		} else {
			buckets.push([current]);
		}
	}

	return buckets.map((bucket) => bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
}
