import { browser } from '$app/environment';
import { nanoid } from 'nanoid';

import { getCachedKatex, setCachedKatex } from '$lib/utils/katex-cache';

type PendingRequest = {
	resolve: (html: string) => void;
	reject: (reason?: unknown) => void;
};

const pending = new Map<string, PendingRequest[]>();
let worker: Worker | null = null;
let renderGeneration = 0;

function ensureWorker(): Worker | null {
	if (!browser || typeof Worker === 'undefined') {
		return null;
	}

	if (worker) {
		return worker;
	}

	worker = new Worker(new URL('../workers/katex.worker.ts', import.meta.url), {
		type: 'module'
	});

	worker.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data as {
			type?: string;
			cacheKey?: string;
			html?: string;
		};

		if (
			data?.type !== 'render' ||
			typeof data.cacheKey !== 'string' ||
			typeof data.html !== 'string'
		) {
			return;
		}

		setCachedKatex(data.cacheKey, data.html);
		const listeners = pending.get(data.cacheKey) ?? [];
		pending.delete(data.cacheKey);

		for (const listener of listeners) {
			listener.resolve(data.html);
		}
	};

	worker.onerror = (error) => {
		for (const listeners of pending.values()) {
			for (const listener of listeners) {
				listener.reject(error);
			}
		}

		pending.clear();
		worker?.terminate();
		worker = null;
	};

	return worker;
}

export function renderKatex(
	cacheKey: string,
	latex: string,
	displayMode: boolean,
	fallback: string
): Promise<string> {
	const cached = getCachedKatex(cacheKey);

	if (cached) {
		return Promise.resolve(cached);
	}

	const nextWorker = ensureWorker();

	if (!nextWorker) {
		setCachedKatex(cacheKey, fallback);
		return Promise.resolve(fallback);
	}

	const myGeneration = ++renderGeneration;

	const existing = pending.get(cacheKey);

	if (existing) {
		return new Promise((resolve, reject) => {
			existing.push({ resolve, reject });
		});
	}

	const listeners: PendingRequest[] = [];
	pending.set(cacheKey, listeners);

	const promise = new Promise<string>((resolve, reject) => {
		listeners.push({ resolve, reject });
	});

	nextWorker.postMessage({
		type: 'render',
		id: nanoid(),
		cacheKey,
		latex,
		displayMode
	});

	return promise
		.then((html) => (renderGeneration > myGeneration + 50 ? fallback : html))
		.catch(() => fallback);
}
