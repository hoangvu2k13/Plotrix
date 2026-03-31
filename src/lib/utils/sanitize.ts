import { browser } from '$app/environment';
import DOMPurify from 'dompurify';

const MATH_ALLOWED_TAGS = [
	'span',
	'svg',
	'path',
	'line',
	'rect',
	'circle',
	'use',
	'defs',
	'g',
	'annotation',
	'semantics',
	'math',
	'mrow',
	'mn',
	'mi',
	'mo',
	'msup',
	'mfrac'
];

const MATH_ALLOWED_ATTR = [
	'class',
	'style',
	'd',
	'viewBox',
	'xmlns',
	'aria-hidden',
	'focusable',
	'width',
	'height',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'href'
];

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

export function sanitizePlainTextHtml(value: string): string {
	if (!browser) {
		return escapeHtml(value);
	}

	return DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

export function sanitizeMathHtml(value: string): string {
	if (!browser) {
		return escapeHtml(value);
	}

	return DOMPurify.sanitize(value, {
		ALLOWED_TAGS: MATH_ALLOWED_TAGS,
		ALLOWED_ATTR: MATH_ALLOWED_ATTR
	});
}
