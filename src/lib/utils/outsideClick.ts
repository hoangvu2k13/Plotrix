type OutsideClickRegistration = {
	close: () => void;
	isOpen: () => boolean;
	root: () => HTMLElement | null;
};

export function createOutsideClickRegistry() {
	const registrations = new Set<OutsideClickRegistration>();
	let pointerListenerAttached = false;

	function handlePointerDown(event: PointerEvent): void {
		const target = event.target;

		if (!(target instanceof Node)) {
			return;
		}

		for (const registration of registrations) {
			const root = registration.root();

			if (registration.isOpen() && root && !root.contains(target)) {
				registration.close();
			}
		}
	}

	function ensurePointerListener(): void {
		if (pointerListenerAttached || typeof document === 'undefined') {
			return;
		}

		document.addEventListener('pointerdown', handlePointerDown);
		pointerListenerAttached = true;
	}

	function maybeRemovePointerListener(): void {
		if (!pointerListenerAttached || registrations.size > 0 || typeof document === 'undefined') {
			return;
		}

		document.removeEventListener('pointerdown', handlePointerDown);
		pointerListenerAttached = false;
	}

	return {
		add(registration: OutsideClickRegistration): void {
			registrations.add(registration);
			ensurePointerListener();
		},
		delete(registration: OutsideClickRegistration): void {
			registrations.delete(registration);
			maybeRemovePointerListener();
		}
	};
}
