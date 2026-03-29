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
	detail?: string;
}

export function createUiState() {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const initialSelectedEquationIds = new Set<string>();
	const ui = $state({
		sidebarOpen: true,
		activeEquationId: null as string | null,
		activeAnalysisEquationId: null as string | null,
		activeRegressionSeriesId: null as string | null,
		tooltipVisible: false,
		tooltipContent: '',
		tooltipAnchor: null as TooltipAnchor | null,
		toasts: [] as Toast[],
		modalOpen: null as 'settings' | 'export' | 'share' | 'shortcuts' | 'regression' | 'auth' | null,
		commandPaletteOpen: false,
		announcement: '',
		tracePoint: null as TracePoint | null,
		isPanningOrZooming: false,
		highlightedAsymptotes: [] as number[],
		selectedEquationIds: initialSelectedEquationIds,
		sidebarActiveTab: 'equations' as 'equations' | 'data'
	});

	let interactionTimer: ReturnType<typeof setTimeout> | null = null;
	let announcementTimer: ReturnType<typeof setTimeout> | null = null;

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

	function openModal(
		name: 'settings' | 'export' | 'share' | 'shortcuts' | 'regression' | 'auth'
	): void {
		ui.modalOpen = name;
	}

	function closeModal(): void {
		ui.modalOpen = null;
	}

	function setTracePoint(tracePoint: TracePoint | null): void {
		ui.tracePoint = tracePoint;
	}

	function setActiveEquationId(id: string | null): void {
		ui.activeEquationId = id;
	}

	function setActiveAnalysisEquationId(id: string | null): void {
		ui.activeAnalysisEquationId = id;
	}

	function setActiveRegressionSeriesId(id: string | null): void {
		ui.activeRegressionSeriesId = id;
	}

	function setSidebarOpen(open: boolean): void {
		ui.sidebarOpen = open;
	}

	function setSidebarActiveTab(tab: 'equations' | 'data'): void {
		ui.sidebarActiveTab = tab;
	}

	function setCommandPaletteOpen(open: boolean): void {
		ui.commandPaletteOpen = open;
	}

	function announce(message: string): void {
		ui.announcement = message;

		if (announcementTimer) {
			clearTimeout(announcementTimer);
		}

		announcementTimer = setTimeout(() => {
			ui.announcement = '';
			announcementTimer = null;
		}, 1200);
	}

	function setHighlightedAsymptotes(values: number[]): void {
		ui.highlightedAsymptotes = [...values];
	}

	function setSelectedEquationIds(ids: Iterable<string>): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		ui.selectedEquationIds = new Set(ids);
	}

	function toggleSelectedEquationId(id: string): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const next = new Set(ui.selectedEquationIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		ui.selectedEquationIds = next;
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
		setActiveEquationId,
		setActiveAnalysisEquationId,
		setActiveRegressionSeriesId,
		setSidebarOpen,
		setSidebarActiveTab,
		setCommandPaletteOpen,
		announce,
		setHighlightedAsymptotes,
		setSelectedEquationIds,
		toggleSelectedEquationId,
		pingInteraction
	});
}

export type UiState = ReturnType<typeof createUiState>;
