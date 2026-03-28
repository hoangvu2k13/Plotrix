/// <reference lib="webworker" />

import katex from 'katex';

interface KatexRenderRequest {
	type: 'render';
	id: string;
	cacheKey: string;
	latex: string;
	displayMode: boolean;
}

function isKatexRenderRequest(value: unknown): value is KatexRenderRequest {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const entry = value as Record<string, unknown>;
	return (
		entry.type === 'render' &&
		typeof entry.id === 'string' &&
		typeof entry.cacheKey === 'string' &&
		typeof entry.latex === 'string' &&
		typeof entry.displayMode === 'boolean'
	);
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isKatexRenderRequest(event.data)) {
		console.warn('katex.worker rejected invalid message payload');
		return;
	}

	const request = event.data;
	let html: string;

	try {
		html = katex.renderToString(request.latex, {
			throwOnError: false,
			displayMode: request.displayMode
		});
	} catch {
		html = request.latex;
	}

	self.postMessage({
		type: 'render',
		id: request.id,
		cacheKey: request.cacheKey,
		html
	});
};

export {};
