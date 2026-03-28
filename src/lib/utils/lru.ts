export class LruMap<K, V> extends Map<K, V> {
	constructor(private readonly maxEntries: number) {
		super();
	}

	override get(key: K): V | undefined {
		const value = super.get(key);

		if (value !== undefined) {
			super.delete(key);
			super.set(key, value);
		}

		return value;
	}

	override set(key: K, value: V): this {
		if (super.has(key)) {
			super.delete(key);
		}

		super.set(key, value);
		this.evict();
		return this;
	}

	private evict(): void {
		while (this.size > this.maxEntries) {
			const oldestKey = this.keys().next().value;

			if (oldestKey === undefined) {
				break;
			}

			super.delete(oldestKey);
		}
	}
}
