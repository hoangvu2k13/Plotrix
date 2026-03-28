import { LruMap } from '$lib/utils/lru';

const CACHE_LIMIT = 300;
const cache = new LruMap<string, string>(CACHE_LIMIT);

export function getCachedKatex(cacheKey: string): string | null {
	return cache.get(cacheKey) ?? null;
}

export function setCachedKatex(cacheKey: string, html: string): void {
	cache.set(cacheKey, html);
}
