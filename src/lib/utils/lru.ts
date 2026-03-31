export class LruMap<K, V> extends Map<K, V> {
	private oldestKey: K | undefined;

	constructor(private readonly maxEntries: number) {
		super();
	}

	override get(key: K): V | undefined {
		const value = super.get(key);

		if (value !== undefined) {
			const wasOldest = this.oldestKey !== undefined && Object.is(this.oldestKey, key);
			super.delete(key);
			super.set(key, value);
			if (wasOldest) {
				this.oldestKey = this.recomputeOldestKey();
			}
		}

		return value;
	}

	override set(key: K, value: V): this {
		if (super.has(key)) {
			const wasOldest = this.oldestKey !== undefined && Object.is(this.oldestKey, key);
			super.delete(key);
			if (wasOldest) {
				this.oldestKey = this.recomputeOldestKey();
			}
		}

		super.set(key, value);
		if (this.size === 1 || this.oldestKey === undefined) {
			this.oldestKey = key;
		}

		while (this.size > this.maxEntries) {
			const oldestKey = this.oldestKey;

			if (oldestKey === undefined) {
				break;
			}

			super.delete(oldestKey);
			this.oldestKey = this.recomputeOldestKey();
		}
		return this;
	}

	override delete(key: K): boolean {
		const removed = super.delete(key);

		if (removed && this.oldestKey !== undefined && Object.is(this.oldestKey, key)) {
			this.oldestKey = this.recomputeOldestKey();
		}

		return removed;
	}

	override clear(): void {
		super.clear();
		this.oldestKey = undefined;
	}

	private recomputeOldestKey(): K | undefined {
		for (const key of super.keys()) {
			return key;
		}

		return undefined;
	}
}
