import { browser } from '$app/environment';
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

interface CalibrationPoint {
	x: number;
	y: number;
}

interface CalibrationEntry {
	image: CalibrationPoint;
	math: CalibrationPoint;
}

export interface CalibrationModeState {
	imageId: string;
	step: 1 | 2;
	points: CalibrationEntry[];
}

export interface CalibrationPromptState {
	imageId: string;
	imagePoint: CalibrationPoint;
	step: 1 | 2;
	xInput: string;
	yInput: string;
}

export function createUiState() {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const initialSelectedEquationIds = new Set<string>();
	const ui = $state({
		sidebarOpen: true,
		activeEquationId: null as string | null,
		activeAnalysisEquationId: null as string | null,
		activeConstrainedPointId: null as string | null,
		activeRegressionSeriesId: null as string | null,
		tooltipVisible: false,
		tooltipContent: '',
		tooltipAnchor: null as TooltipAnchor | null,
		toasts: [] as Toast[],
		modalOpen: null as
			| 'settings'
			| 'export'
			| 'share'
			| 'shortcuts'
			| 'regression'
			| 'auth'
			| 'calibration'
			| null,
		commandPaletteOpen: false,
		announcement: '',
		tracePoint: null as TracePoint | null,
		isPanningOrZooming: false,
		isOffline: browser ? !navigator.onLine : false,
		calibrationMode: null as CalibrationModeState | null,
		calibrationPrompt: null as CalibrationPromptState | null,
		presentationMode: false,
		presentationControlsVisible: false,
		laserPointerActive: false,
		highlightedAsymptotes: [] as number[],
		selectedEquationIds: initialSelectedEquationIds,
		sidebarActiveTab: 'equations' as 'equations' | 'data'
	});

	let interactionTimer: ReturnType<typeof setTimeout> | null = null;
	let announcementTimer: ReturnType<typeof setTimeout> | null = null;
	let presentationTimer: ReturnType<typeof setTimeout> | null = null;
	const handleOnlineStatusChange = () => {
		ui.isOffline = !navigator.onLine;
	};

	const handleFullscreenChange = () => {
		if (!document.fullscreenElement && ui.presentationMode) {
			exitPresentationMode();
		}
	};

	if (browser) {
		window.addEventListener('online', handleOnlineStatusChange);
		window.addEventListener('offline', handleOnlineStatusChange);
		document.addEventListener('fullscreenchange', handleFullscreenChange);
	}

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
		name: 'settings' | 'export' | 'share' | 'shortcuts' | 'regression' | 'auth' | 'calibration'
	): void {
		ui.modalOpen = name;
	}

	function closeModal(): void {
		if (ui.modalOpen === 'calibration') {
			ui.calibrationPrompt = null;
		}

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

	function setActiveConstrainedPointId(id: string | null): void {
		ui.activeConstrainedPointId = id;
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

	function setCalibrationMode(mode: CalibrationModeState | null): void {
		ui.calibrationMode = mode;
	}

	function openCalibrationPrompt(
		prompt: Omit<CalibrationPromptState, 'xInput' | 'yInput'> & {
			xInput?: string;
			yInput?: string;
		}
	): void {
		ui.calibrationPrompt = {
			imageId: prompt.imageId,
			imagePoint: prompt.imagePoint,
			step: prompt.step,
			xInput: prompt.xInput ?? (prompt.step === 1 ? '0' : '1'),
			yInput: prompt.yInput ?? (prompt.step === 1 ? '0' : '1')
		};
		ui.modalOpen = 'calibration';
	}

	function clearCalibrationPrompt(): void {
		ui.calibrationPrompt = null;

		if (ui.modalOpen === 'calibration') {
			ui.modalOpen = null;
		}
	}

	function schedulePresentationFade(): void {
		if (presentationTimer) {
			clearTimeout(presentationTimer);
		}

		if (!ui.presentationMode) {
			ui.presentationControlsVisible = false;
			return;
		}

		ui.presentationControlsVisible = true;
		presentationTimer = setTimeout(() => {
			ui.presentationControlsVisible = false;
			presentationTimer = null;
		}, 2000);
	}

	async function enterPresentationMode(): Promise<void> {
		ui.presentationMode = true;
		schedulePresentationFade();

		if (!browser) {
			return;
		}

		try {
			const root = document.documentElement as HTMLElement & {
				webkitRequestFullscreen?: () => Promise<void> | void;
			};
			if (root.requestFullscreen) {
				await root.requestFullscreen();
			} else {
				await root.webkitRequestFullscreen?.();
			}
		} catch {
			// Ignore fullscreen failures and continue in windowed presentation mode.
		}
	}

	async function exitPresentationMode(): Promise<void> {
		ui.presentationMode = false;
		ui.presentationControlsVisible = false;
		ui.laserPointerActive = false;

		if (presentationTimer) {
			clearTimeout(presentationTimer);
			presentationTimer = null;
		}

		if (!browser) {
			return;
		}

		try {
			const fullscreenDocument = document as Document & {
				webkitExitFullscreen?: () => Promise<void> | void;
			};
			if (document.fullscreenElement && document.exitFullscreen) {
				await document.exitFullscreen();
			} else {
				await fullscreenDocument.webkitExitFullscreen?.();
			}
		} catch {
			// Ignore exit failures.
		}
	}

	function markPresentationActivity(): void {
		if (!ui.presentationMode) {
			return;
		}

		schedulePresentationFade();
	}

	function setLaserPointerActive(active: boolean): void {
		ui.laserPointerActive = active;
		schedulePresentationFade();
	}

	function destroy(): void {
		if (!browser) {
			return;
		}

		window.removeEventListener('online', handleOnlineStatusChange);
		window.removeEventListener('offline', handleOnlineStatusChange);
		document.removeEventListener('fullscreenchange', handleFullscreenChange);
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
		setActiveConstrainedPointId,
		setActiveRegressionSeriesId,
		setSidebarOpen,
		setSidebarActiveTab,
		setCommandPaletteOpen,
		announce,
		setHighlightedAsymptotes,
		setSelectedEquationIds,
		toggleSelectedEquationId,
		setCalibrationMode,
		openCalibrationPrompt,
		clearCalibrationPrompt,
		enterPresentationMode,
		exitPresentationMode,
		markPresentationActivity,
		setLaserPointerActive,
		pingInteraction,
		destroy
	});
}

export type UiState = ReturnType<typeof createUiState>;
