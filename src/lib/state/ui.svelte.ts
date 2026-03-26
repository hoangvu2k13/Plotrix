import { nanoid } from 'nanoid';

export interface Toast {
	id: string;
	title: string;
	description: string;
	tone: 'info' | 'success' | 'warning' | 'danger';
	duration: number;
}

export interface TooltipAnchor {
	x: number;
	y: number;
}

export interface TracePoint {
	x: number;
	y: number;
	equationId: string;
}

export function createUiState() {
	const ui = $state({
		sidebarOpen: true,
		activeEquationId: null as string | null,
		tooltipVisible: false,
		tooltipContent: '',
		tooltipAnchor: null as TooltipAnchor | null,
		toasts: [] as Toast[],
		modalOpen: null as 'settings' | 'export' | 'share' | 'shortcuts' | null,
		commandPaletteOpen: false,
		tracePoint: null as TracePoint | null,
		isPanningOrZooming: false
	});

	let interactionTimer: ReturnType<typeof setTimeout> | null = null;

	function pushToast(toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }): string {
		const id = nanoid();
		const entry: Toast = {
			id,
			duration: toast.duration ?? 3600,
			title: toast.title,
			description: toast.description,
			tone: toast.tone
		};

		ui.toasts.unshift(entry);

		if (entry.duration > 0) {
			setTimeout(() => dismissToast(id), entry.duration);
		}

		return id;
	}

	function dismissToast(id: string): void {
		const index = ui.toasts.findIndex((toast) => toast.id === id);

		if (index !== -1) {
			ui.toasts.splice(index, 1);
		}
	}

	function setTooltip(content: string, anchor: TooltipAnchor): void {
		ui.tooltipVisible = true;
		ui.tooltipContent = content;
		ui.tooltipAnchor = anchor;
	}

	function clearTooltip(): void {
		ui.tooltipVisible = false;
		ui.tooltipContent = '';
		ui.tooltipAnchor = null;
	}

	function openModal(name: 'settings' | 'export' | 'share' | 'shortcuts'): void {
		ui.modalOpen = name;
	}

	function closeModal(): void {
		ui.modalOpen = null;
	}

	function setTracePoint(tracePoint: TracePoint | null): void {
		ui.tracePoint = tracePoint;
	}

	function pingInteraction(timeout = 800): void {
		ui.isPanningOrZooming = true;

		if (interactionTimer) {
			clearTimeout(interactionTimer);
		}

		interactionTimer = setTimeout(() => {
			ui.isPanningOrZooming = false;
			interactionTimer = null;
		}, timeout);
	}

	return Object.assign(ui, {
		pushToast,
		dismissToast,
		setTooltip,
		clearTooltip,
		openModal,
		closeModal,
		setTracePoint,
		pingInteraction
	});
}

export type UiState = ReturnType<typeof createUiState>;
