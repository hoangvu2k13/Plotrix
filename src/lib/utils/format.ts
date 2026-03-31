export const DISPLAY_PRECISION = 4;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function trimDecimalZeros(value: string): string {
	return value.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export function formatNumber(value: number, fractionDigits = 2): string {
	if (!Number.isFinite(value)) {
		return value > 0 ? '∞' : value < 0 ? '-∞' : 'NaN';
	}

	if (Math.abs(value) >= 1_000_000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
		return value.toExponential(2);
	}

	if (Math.abs(value - Math.round(value)) < 1e-8) {
		return String(Math.round(value));
	}

	return value
		.toFixed(fractionDigits)
		.replace(/\.0+$/, '')
		.replace(/(\.\d*[1-9])0+$/, '$1');
}

export function formatCoordinate(value: number): string {
	return formatDisplay(value);
}

export function formatDuration(ms: number): string {
	return `${ms >= 10 ? Math.round(ms) : formatNumber(ms, 2)} ms`;
}

export function formatSig(value: number, digits = 3): string {
	if (!Number.isFinite(value)) {
		return value > 0 ? '∞' : value < 0 ? '-∞' : 'NaN';
	}

	if (value === 0) {
		return '0';
	}

	const abs = Math.abs(value);

	if (abs >= 1_000_000 && abs < 1e15) {
		const exponent = Math.floor(Math.log10(abs));
		const fractionDigits = Math.max(0, digits - exponent - 1);
		return trimDecimalZeros(
			value.toLocaleString('en-US', {
				maximumFractionDigits: fractionDigits,
				useGrouping: true
			})
		);
	}

	const formatted = value.toPrecision(digits);
	return formatted.includes('e') ? formatted : trimDecimalZeros(formatted);
}

export function formatDisplay(value: number): string {
	return formatSig(value, DISPLAY_PRECISION);
}

export function formatShortcut(shortcut: string): string {
	const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
	return shortcut.replace(/mod/gi, isMac ? 'Cmd' : 'Ctrl');
}
