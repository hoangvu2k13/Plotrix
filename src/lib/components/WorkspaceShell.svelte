<script lang="ts">
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import {
		Aperture,
		ArrowLeft,
		Check,
		CircleHelp,
		ChevronDown,
		CircleDot,
		CircleGauge,
		Cloud,
		CloudOff,
		CornerDownLeft,
		Crosshair,
		Download,
		Eye,
		EyeOff,
		FolderClosed,
		FunctionSquare,
		Grid2x2,
		Grid3x3,
		Lock,
		LoaderCircle,
		MoreHorizontal,
		MousePointer2,
		PanelLeft,
		PanelRight,
		Plus,
		Radar,
		Redo2,
		ScanEye,
		Search,
		Settings2,
		Share2,
		SunMoon,
		Terminal,
		Trash2,
		Undo2,
		Upload,
		UserRound,
		X
	} from '@lucide/svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';

	import AuthPanel from '$components/AuthPanel.svelte';
	import CommandPalette, { type CommandAction } from '$components/CommandPalette.svelte';
	import DataPanel from '$components/DataPanel.svelte';
	import EquationCard from '$components/EquationCard.svelte';
	import GraphCanvas from '$components/GraphCanvas.svelte';
	import Icon from '$components/Icon.svelte';
	import IconButton from '$components/IconButton.svelte';
	import Modal from '$components/Modal.svelte';
	import AnalysisPanel from '$components/AnalysisPanel.svelte';
	import RegressionPanel from '$components/RegressionPanel.svelte';
	import Select from '$components/Select.svelte';
	import Slider from '$components/Slider.svelte';
	import ToastViewport from '$components/ToastViewport.svelte';
	import Toggle from '$components/Toggle.svelte';
	import VariableSliderPanel from '$components/VariableSliderPanel.svelte';
	import { authState } from '$lib/firebase/auth.svelte';
	import { hasMeaningfulWorkspaceContent } from '$lib/firebase/projects';
	import { createWorkspaceSyncState } from '$lib/firebase/workspace-sync.svelte';
	import { parseEquation } from '$lib/math/engine';
	import { createGraphState } from '$stores/graph.svelte';
	import { createUiState } from '$stores/ui.svelte';
	import { copyText, saveBlob, saveText } from '$utils/download';
	import { formatShortcut } from '$utils/format';
	import { nextTheme, resolveTheme } from '$utils/theme';

	let { workspaceId = 'default' } = $props<{ workspaceId?: string }>();

	const graph = createGraphState();
	const ui = createUiState();
	const sync = createWorkspaceSyncState(graph, ui);

	const themeOptions = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];

	const gridStyleOptions = [
		{ value: 'cartesian', label: 'Cartesian' },
		{ value: 'polar', label: 'Polar' }
	];
	const SETTINGS_SECTIONS_KEY = 'plotrix-settings-sections';
	const DEFAULT_SETTINGS_SECTIONS = {
		appearance: true,
		grid: true,
		analysis: true,
		rendering: true,
		canvas: true
	} as const;

	const shortcuts = [
		['Close any panel / modal', 'Escape'],
		['Pan', 'Drag or use arrow keys'],
		['Zoom', 'Mouse wheel, pinch, +, -'],
		['Reset view', '0'],
		['New equation', formatShortcut('Mod+E')],
		['Undo / redo', `${formatShortcut('Mod+Z')} / ${formatShortcut('Mod+Shift+Z')}`],
		['Command palette', formatShortcut('Mod+K')],
		['Toggle analysis', formatShortcut('Mod+Shift+A')],
		['Open regression', formatShortcut('Mod+Shift+R')],
		['Open data tab', formatShortcut('Mod+Shift+D')],
		['Toggle markers', formatShortcut('Mod+Shift+M')],
		['Toggle intersections', formatShortcut('Mod+Shift+I')]
	] as const;

	type SidebarListItem =
		| {
				type: 'folder';
				folder: (typeof graph.folders)[number];
				folderIndex: number;
				matchCount: number;
		  }
		| {
				type: 'equation';
				equation: (typeof graph.equations)[number];
				index: number;
				folderId: string | null;
		  };

	const DISTRIBUTION_PRESETS = [
		{ id: 'normal', label: 'Normal', raw: 'normalPDF(x, 0, 1)', equationLabel: 'N(0,1)' },
		{
			id: 'binomial',
			label: 'Binomial',
			raw: 'binomialPDF(x, 10, 0.5)',
			equationLabel: 'Binomial(10,0.5)'
		},
		{
			id: 'poisson',
			label: 'Poisson',
			raw: 'poissonPDF(x, 4)',
			equationLabel: 'Poisson(4)'
		},
		{ id: 't', label: 't', raw: 'tPDF(x, 5)', equationLabel: 't(5)' },
		{ id: 'chi2', label: 'chi^2', raw: 'chiSquaredPDF(x, 4)', equationLabel: 'chi^2(4)' }
	] as const;

	const EMBED_BASE_URL = 'https://plotrix.app';
	const MAX_BACKGROUND_IMAGE_BYTES = 8 * 1024 * 1024;

	let importInput: HTMLInputElement | null = null;
	let imageInput: HTMLInputElement | null = null;
	let shareUrl = $state('');
	let equationQuery = $state('');
	let resizingSidebar = $state(false);
	let settingsSections = $state({ ...DEFAULT_SETTINGS_SECTIONS });
	let mobileToolbarOpen = $state(false);
	let sidebarSwipeStart: { x: number; y: number } | null = $state(null);
	let mounted = false;
	let initialHashAction = $state<'new' | 'share' | null>(null);
	let initialSharedSnapshot = $state<string | null>(null);
	let hashActionHandled = $state(false);
	let sessionConfigToken = 0;
	let lastConfiguredSessionKey: string | null | undefined = undefined;
	let lastSyncError = '';
	let syncSuccessFlash = $state(false);
	let lastSeenSyncedAt: number | null = null;
	let syncSuccessTimer: ReturnType<typeof setTimeout> | null = null;
	let distributionsOpen = $state(true);
	let editingFolderId = $state<string | null>(null);
	let embedPanelOpen = $state(false);

	const canUndo = $derived(graph.historyIndex > 0);
	const canRedo = $derived(graph.historyIndex < graph.historySize - 1);
	const syncStatusSummary = $derived.by(() => {
		if (authState.loading && authState.pendingAction === 'bootstrap') {
			return 'Checking account';
		}

		if (!authState.available) {
			return 'Firebase off';
		}

		if (ui.isOffline && authState.user && sync.pendingWrite) {
			return 'Queued';
		}

		switch (sync.status) {
			case 'loading':
				return 'Restoring';
			case 'syncing':
				return 'Syncing';
			case 'synced':
				return 'Synced';
			case 'error':
				return 'Sync paused';
			default:
				return authState.user ? 'Account ready' : 'Local only';
		}
	});
	const syncStatusDescription = $derived.by(() => {
		if (!authState.available) {
			return 'Firebase env is not configured for this build.';
		}

		if (ui.isOffline && authState.user && sync.pendingWrite) {
			return 'Workspace changes are queued locally and will upload when the connection returns.';
		}

		switch (sync.status) {
			case 'loading':
				return 'Restoring the Firebase workspace.';
			case 'syncing':
				return 'Uploading recent workspace changes.';
			case 'synced':
				return sync.lastSyncedAt
					? `Realtime sync active. Last sync ${new Date(sync.lastSyncedAt).toLocaleTimeString()}.`
					: 'Realtime sync active for this account.';
			case 'error':
				return sync.error ?? 'Workspace sync is paused.';
			default:
				return authState.user
					? 'Signed in, waiting for workspace activity.'
					: 'Guest mode stores this workspace locally on the current device.';
		}
	});
	const accountLabel = $derived.by(
		() => authState.user?.displayName || authState.user?.email || 'Account sync'
	);
	const accountSecondaryLabel = $derived.by(() =>
		authState.user ? authState.user.email || 'Firebase account session' : 'Guest mode'
	);
	const sidebarItems = $derived.by<SidebarListItem[]>(() => {
		const needle = equationQuery.trim().toLowerCase();
		const items: SidebarListItem[] = [];
		const indexed = graph.equations.map((equation, index) => ({ equation, index }));
		const indexedById = new Map(indexed.map((entry) => [entry.equation.id, entry]));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const equationToFolder = new Map<string, string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const folderEquationMap = new Map<string, Array<(typeof indexed)[number]>>();

		for (const folder of graph.folders) {
			const folderEntries: Array<(typeof indexed)[number]> = [];

			for (const equationId of folder.equationIds) {
				const entry = indexedById.get(equationId);

				if (!entry) {
					continue;
				}

				equationToFolder.set(equationId, folder.id);
				folderEntries.push(entry);
			}

			folderEquationMap.set(folder.id, folderEntries);
		}

		for (const [folderIndex, folder] of graph.folders.entries()) {
			const folderEquations = folderEquationMap.get(folder.id) ?? [];
			const matches = needle
				? folderEquations.filter(({ equation }) =>
						`${equation.raw} ${equation.label}`.toLowerCase().includes(needle)
					)
				: folderEquations;

			if (!needle || matches.length > 0) {
				items.push({
					type: 'folder',
					folder,
					folderIndex,
					matchCount: matches.length
				});
			}

			if (!folder.collapsed || needle) {
				for (const entry of matches) {
					items.push({
						type: 'equation',
						equation: entry.equation,
						index: entry.index,
						folderId: folder.id
					});
				}
			}
		}

		for (const entry of indexed) {
			if (equationToFolder.has(entry.equation.id)) {
				continue;
			}

			if (
				needle &&
				!`${entry.equation.raw} ${entry.equation.label}`.toLowerCase().includes(needle)
			) {
				continue;
			}

			items.push({
				type: 'equation',
				equation: entry.equation,
				index: entry.index,
				folderId: null
			});
		}

		return items;
	});
	const backgroundImages = $derived.by(() => {
		void graph.backgroundImagesVersion;
		return graph.backgroundImages;
	});
	const embedSrc = $derived.by(() => `${EMBED_BASE_URL}/embed/${workspaceId}`);
	const embedCode = $derived.by(
		() => `<iframe src="${embedSrc}" width="800" height="500" frameborder="0"></iframe>`
	);
	function addEquation(raw = ''): void {
		const equation = graph.addEquation(raw);
		ui.setActiveEquationId(equation.id);
		ui.setSelectedEquationIds([equation.id]);
		ui.setSidebarOpen(true);
		ui.announce('Equation added');
	}

	function addDistributionEquation(raw: string, label: string): void {
		const equation = graph.addEquation(raw, 'cartesian');
		graph.updateEquation(equation.id, { label });
		ui.setActiveEquationId(equation.id);
		ui.setSelectedEquationIds([equation.id]);
		ui.setSidebarOpen(true);
		ui.pushToast({
			title: 'Distribution added',
			description: raw.includes('binomialPDF')
				? 'Inserted a discrete distribution. Probability shading will sum integer outcomes.'
				: 'Inserted a statistical distribution equation.',
			tone: 'success'
		});
	}

	function setActiveEquation(id: string): void {
		ui.setActiveEquationId(id);
		ui.setSelectedEquationIds([id]);
	}

	function parseDragPayload(
		event: DragEvent
	):
		| { type: 'equation'; equationId: string; index: number }
		| { type: 'folder'; folderId: string; index: number }
		| null {
		const payload = event.dataTransfer?.getData('application/x-plotrix-item');

		if (!payload) {
			return null;
		}

		try {
			const parsed = JSON.parse(payload) as {
				type?: string;
				equationId?: string;
				folderId?: string;
				index?: number;
			};

			if (
				parsed.type === 'equation' &&
				typeof parsed.equationId === 'string' &&
				typeof parsed.index === 'number' &&
				Number.isFinite(parsed.index)
			) {
				return {
					type: 'equation',
					equationId: parsed.equationId,
					index: parsed.index
				};
			}

			if (
				parsed.type === 'folder' &&
				typeof parsed.folderId === 'string' &&
				typeof parsed.index === 'number' &&
				Number.isFinite(parsed.index)
			) {
				return {
					type: 'folder',
					folderId: parsed.folderId,
					index: parsed.index
				};
			}
		} catch {
			return null;
		}

		return null;
	}

	async function startFolderRename(folderId: string): Promise<void> {
		editingFolderId = folderId;
		await tick();
		document.querySelector<HTMLInputElement>(`[data-folder-name="${folderId}"]`)?.focus();
	}

	function finishFolderRename(): void {
		editingFolderId = null;
	}

	function handleFolderDragStart(event: DragEvent, folderId: string, folderIndex: number): void {
		if (!event.dataTransfer) {
			return;
		}

		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData(
			'application/x-plotrix-item',
			JSON.stringify({
				type: 'folder',
				folderId,
				index: folderIndex
			})
		);
	}

	function handleFolderDrop(event: DragEvent, folderId: string, folderIndex: number): void {
		event.preventDefault();
		const payload = parseDragPayload(event);

		if (!payload) {
			return;
		}

		if (payload.type === 'equation') {
			graph.addEquationToFolder(folderId, payload.equationId);
			return;
		}

		if (payload.type === 'folder') {
			graph.reorderFolders(payload.index, folderIndex);
		}
	}

	function handleUngroupedDrop(event: DragEvent): void {
		event.preventDefault();
		const payload = parseDragPayload(event);

		if (!payload || payload.type !== 'equation') {
			return;
		}

		const folder = graph.getFolderForEquation(payload.equationId);

		if (!folder) {
			return;
		}

		graph.removeEquationFromFolder(folder.id, payload.equationId);
	}

	function toggleFolderVisibility(folderId: string): void {
		const folder = graph.folders.find((entry) => entry.id === folderId);

		if (!folder) {
			return;
		}

		const visible = !folder.visible;
		graph.updateFolder(folder.id, { visible });

		for (const equationId of folder.equationIds) {
			graph.updateEquation(equationId, { visible });
		}
	}

	function shadeBetweenSelected(): void {
		const selected = graph.equations.filter((equation) => ui.selectedEquationIds.has(equation.id));
		if (selected.length !== 2 || selected.some((equation) => equation.kind !== 'cartesian')) {
			return;
		}

		const [first, second] = selected;
		if (!first || !second) {
			return;
		}

		const upper = parseEquation(first.raw, 'cartesian');
		const lower = parseEquation(second.raw, 'cartesian');

		if (upper.error || lower.error || !upper.normalized || !lower.normalized) {
			ui.pushToast({
				title: 'Shade between unavailable',
				description: 'Plotrix could not normalize one of the selected equations safely.',
				tone: 'warning'
			});
			return;
		}

		graph.addEquation(`y >= (${upper.normalized})`, 'inequality');
		graph.addEquation(`y <= (${lower.normalized})`, 'inequality');
		ui.pushToast({
			title: 'Shaded region added',
			description: 'Created an inequality pair between the selected curves.',
			tone: 'success'
		});
	}

	function handleSidebarPointerDown(event: PointerEvent): void {
		if (
			event.pointerType !== 'touch' ||
			typeof window === 'undefined' ||
			window.innerWidth >= 960 ||
			!ui.sidebarOpen
		) {
			sidebarSwipeStart = null;
			return;
		}

		sidebarSwipeStart = { x: event.clientX, y: event.clientY };
	}

	function handleSidebarPointerUp(event: PointerEvent): void {
		if (!sidebarSwipeStart) {
			return;
		}

		const deltaX = event.clientX - sidebarSwipeStart.x;
		const deltaY = Math.abs(event.clientY - sidebarSwipeStart.y);
		sidebarSwipeStart = null;

		if (deltaX < -72 && deltaY < 44) {
			ui.setSidebarOpen(false);
		}
	}

	function toggleTheme(): void {
		graph.updateSettings({ theme: nextTheme(graph.settings.theme) });
	}

	function applyTheme(theme: 'system' | 'light' | 'dark'): void {
		graph.updateSettings({ theme });
	}

	async function exportPNG(scale: 1 | 2 | 3): Promise<void> {
		const blob = await graph.exportPNG(scale);

		if (!blob) {
			ui.pushToast({
				title: 'PNG export unavailable',
				description: 'The graph canvas has not finished mounting yet.',
				tone: 'warning'
			});
			return;
		}

		saveBlob(blob, `plotrix-${scale}x.png`);
		ui.pushToast({
			title: 'PNG exported',
			description: `Saved a ${scale}x raster export of the current graph.`,
			tone: 'success'
		});
	}

	function exportSVGFile(): void {
		const svg = graph.exportSVG();

		if (!svg) {
			ui.pushToast({
				title: 'SVG export unavailable',
				description: 'The graph canvas has not finished mounting yet.',
				tone: 'warning'
			});
			return;
		}

		saveText(svg, 'plotrix-graph.svg', 'image/svg+xml');
		ui.pushToast({
			title: 'SVG exported',
			description: 'Saved a vector export of the current graph.',
			tone: 'success'
		});
	}

	async function exportPDFFile(): Promise<void> {
		const toastId = ui.pushToast({
			title: 'Generating PDF',
			description: 'Preparing a PDF export from the current Plotrix canvas.',
			tone: 'info',
			duration: 0
		});

		try {
			const blob = await graph.exportPDF();
			saveBlob(blob, 'plotrix-graph.pdf');
			ui.pushToast({
				title: 'PDF exported',
				description: 'Saved a vector PDF of the current graph.',
				tone: 'success'
			});
		} catch (error) {
			ui.pushToast({
				title: 'PDF export failed',
				description: error instanceof Error ? error.message : 'Unable to export the graph as PDF.',
				tone: 'warning'
			});
		} finally {
			ui.dismissToast(toastId);
		}
	}

	function exportJSONFile(): void {
		saveText(graph.exportJSON(), 'plotrix-session.json');
		ui.pushToast({
			title: 'Session exported',
			description: 'Saved the complete Plotrix graph state as JSON.',
			tone: 'success'
		});
	}

	function openShareModal(): void {
		try {
			shareUrl = graph.shareURL() ?? (browser ? window.location.href : '');
			embedPanelOpen = false;
			ui.openModal('share');
			mobileToolbarOpen = false;
		} catch (error) {
			ui.pushToast({
				title: 'Share link unavailable',
				description:
					error instanceof Error ? error.message : 'Plotrix could not build a shareable URL.',
				tone: 'warning'
			});
		}
	}

	async function copyShareLink(): Promise<void> {
		if (!shareUrl) {
			try {
				shareUrl = graph.shareURL() ?? '';
			} catch (error) {
				ui.pushToast({
					title: 'Share link unavailable',
					description:
						error instanceof Error ? error.message : 'Plotrix could not build a shareable URL.',
					tone: 'warning'
				});
				return;
			}
		}

		if (!shareUrl) {
			return;
		}

		await copyText(shareUrl);
		ui.pushToast({
			title: 'Share link copied',
			description: 'The current graph state is now on your clipboard.',
			tone: 'success'
		});
	}

	function openImportDialog(): void {
		importInput?.click();
	}

	function openImageDialog(): void {
		imageInput?.click();
	}

	async function readFileAsDataUrl(file: File): Promise<string> {
		return await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				if (typeof reader.result === 'string') {
					resolve(reader.result);
					return;
				}

				reject(new Error('Unable to read the selected image.'));
			};
			reader.onerror = () =>
				reject(reader.error ?? new Error('Unable to read the selected image.'));
			reader.readAsDataURL(file);
		});
	}

	async function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
		return await new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () =>
				resolve({
					width: image.naturalWidth || image.width,
					height: image.naturalHeight || image.height
				});
			image.onerror = () => reject(new Error('The selected file is not a readable image.'));
			image.src = dataUrl;
		});
	}

	function closeMobileToolbar(): void {
		mobileToolbarOpen = false;
	}

	function openAuthModal(): void {
		ui.openModal('auth');
		closeMobileToolbar();
	}

	async function toggleWorkspacePublic(nextValue: boolean): Promise<void> {
		if (!authState.user) {
			ui.pushToast({
				title: 'Sign in required',
				description: 'Public embeds are available only for signed-in workspaces.',
				tone: 'warning'
			});
			return;
		}

		try {
			await sync.setPublic(nextValue);
			ui.pushToast({
				title: nextValue ? 'Workspace embed enabled' : 'Workspace embed disabled',
				description: nextValue
					? 'Anyone with the embed link can view this workspace.'
					: 'This workspace is private again.',
				tone: nextValue ? 'warning' : 'success'
			});
		} catch (error) {
			ui.pushToast({
				title: 'Embed visibility update failed',
				description:
					error instanceof Error ? error.message : 'Plotrix could not update workspace visibility.',
				tone: 'warning'
			});
		}
	}

	async function copyEmbedCode(): Promise<void> {
		await copyText(embedCode);
		ui.pushToast({
			title: 'Embed code copied',
			description: 'The Plotrix iframe snippet is now on your clipboard.',
			tone: 'success'
		});
	}

	async function handleImageImport(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) {
			return;
		}

		try {
			if (!file.type.startsWith('image/')) {
				throw new Error('Select a valid image file.');
			}

			if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
				throw new Error('Background images must be 8MB or smaller.');
			}

			const dataUrl = await readFileAsDataUrl(file);
			const { width, height } = await measureImage(dataUrl);
			const image = graph.addBackgroundImage(dataUrl, width, height);

			if (!image) {
				throw new Error('Plotrix could not add the selected background image.');
			}

			ui.pushToast({
				title: 'Background image added',
				description:
					'Background images stay local to this device and are never synced to Firebase.',
				tone: 'info'
			});
		} catch (error) {
			ui.pushToast({
				title: 'Image import failed',
				description:
					error instanceof Error ? error.message : 'Unable to import the selected image.',
				tone: 'warning'
			});
		} finally {
			input.value = '';
		}
	}

	function startImageCalibration(imageId: string): void {
		ui.closeModal();
		ui.clearCalibrationPrompt();
		ui.setCalibrationMode({
			imageId,
			step: 1,
			points: []
		});
		ui.pushToast({
			title: 'Calibration started',
			description: 'Click a known point on the image, then enter its math coordinates.',
			tone: 'info'
		});
	}

	function cancelCalibrationPrompt(): void {
		ui.clearCalibrationPrompt();
	}

	function confirmCalibrationPrompt(): void {
		const prompt = ui.calibrationPrompt;
		const mode = ui.calibrationMode;

		if (!prompt || !mode || prompt.imageId !== mode.imageId || prompt.step !== mode.step) {
			ui.clearCalibrationPrompt();
			return;
		}

		const x = Number.parseFloat(prompt.xInput.trim());
		const y = Number.parseFloat(prompt.yInput.trim());

		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			ui.pushToast({
				title: 'Invalid calibration coordinates',
				description: 'Use two finite numeric coordinate values.',
				tone: 'warning'
			});
			return;
		}

		const nextPoints = [
			...mode.points,
			{
				image: prompt.imagePoint,
				math: { x, y }
			}
		];

		ui.clearCalibrationPrompt();

		if (nextPoints.length >= 2) {
			const [first, second] = nextPoints;

			if (!first || !second) {
				ui.setCalibrationMode(null);
				return;
			}

			graph.updateBackgroundImage(mode.imageId, {
				calibration: {
					imagePoint1: first.image,
					imagePoint2: second.image,
					mathPoint1: first.math,
					mathPoint2: second.math
				}
			});
			ui.setCalibrationMode(null);
			ui.pushToast({
				title: 'Image calibrated',
				description: 'The background image is now aligned to the graph coordinates.',
				tone: 'success'
			});
			return;
		}

		ui.setCalibrationMode({
			imageId: mode.imageId,
			step: 2,
			points: nextPoints
		});
		ui.pushToast({
			title: 'Select the second point',
			description: 'Click another known point on the image to finish calibration.',
			tone: 'info'
		});
	}

	async function enterPresentationMode(): Promise<void> {
		closeMobileToolbar();
		await ui.enterPresentationMode();
		await tick();
		graph.requestRender();
		requestAnimationFrame(() => {
			graph.requestRender();
		});
	}

	function goToDashboard(): void {
		const workspacePath = resolve('/workspace/[id]', { id: workspaceId });
		const dashboardPath = workspacePath.replace(/\/workspace\/[^/]+$/, '') || '/';

		window.location.assign(dashboardPath);
	}

	async function configureWorkspaceSession(
		user: typeof authState.user,
		options: {
			preferCurrentGraph?: boolean;
			sharedSnapshot?: string | null;
			workspaceId?: string;
		} = {}
	): Promise<void> {
		const token = ++sessionConfigToken;
		await sync.configureSession(user, options);

		if (token !== sessionConfigToken) {
			return;
		}

		ui.setActiveEquationId(graph.equations[0]?.id ?? null);
	}

	function toggleSettingsSection(section: keyof typeof DEFAULT_SETTINGS_SECTIONS): void {
		settingsSections = {
			...settingsSections,
			[section]: !settingsSections[section]
		};
	}

	async function handleImport(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) {
			return;
		}

		try {
			await graph.importJSON(await file.text(), { resetHistory: true });
			ui.setActiveEquationId(graph.equations[0]?.id ?? null);
			ui.announce('Session imported');
			ui.pushToast({
				title: 'Session imported',
				description: 'Plotrix restored the graph from your JSON file.',
				tone: 'success'
			});
		} catch (error) {
			ui.pushToast({
				title: 'Import failed',
				description: error instanceof Error ? error.message : 'Unable to import the selected file.',
				tone: 'danger'
			});
		} finally {
			input.value = '';
		}
	}

	function startSidebarResize(event: MouseEvent): void {
		if (window.innerWidth < 960) {
			return;
		}

		resizingSidebar = true;
		const startX = event.clientX;
		const startWidth = graph.settings.equationPanelWidth;

		const handleMove = (moveEvent: MouseEvent) => {
			graph.updateSettings({
				equationPanelWidth: startWidth + (moveEvent.clientX - startX)
			});
		};

		const handleUp = () => {
			resizingSidebar = false;
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);
		};

		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);
	}

	const commandActions = $derived.by<CommandAction[]>(() => [
		{
			id: 'add-equation',
			category: 'Create',
			title: 'Add equation',
			description: 'Create a fresh editable equation row.',
			shortcut: 'Mod+E',
			run: () => addEquation('')
		},
		{
			id: 'fit-all',
			category: 'View',
			title: 'Fit all curves',
			description: 'Auto-frame the visible equations in the canvas.',
			run: () => graph.fitAll()
		},
		{
			id: 'reset-view',
			category: 'View',
			title: 'Reset view',
			description: 'Return to the default zoom and centered origin.',
			shortcut: '0',
			run: () => graph.resetView()
		},
		{
			id: 'toggle-theme',
			category: 'Appearance',
			title: 'Cycle theme',
			description: 'Move between system, light, and dark presentation.',
			run: toggleTheme
		},
		{
			id: 'export-svg',
			category: 'Export',
			title: 'Export SVG',
			description: 'Save a vector render of the current graph.',
			run: exportSVGFile
		},
		{
			id: 'export-pdf',
			category: 'Export',
			title: 'Export PDF',
			description: 'Save a PDF export of the current graph.',
			run: () => void exportPDFFile()
		},
		{
			id: 'share',
			category: 'Export',
			title: 'Open share link',
			description: 'Generate a portable URL with the current graph state.',
			run: openShareModal
		},
		{
			id: 'settings',
			category: 'Workspace',
			title: 'Open settings',
			description: 'Fine tune canvas, theme, and rendering preferences.',
			run: () => ui.openModal('settings')
		},
		{
			id: 'present',
			category: 'Workspace',
			title: ui.presentationMode ? 'Exit presentation mode' : 'Enter presentation mode',
			description: 'Show the graph fullscreen without workspace chrome.',
			run: () =>
				ui.presentationMode ? void ui.exitPresentationMode() : void enterPresentationMode()
		},
		{
			id: 'account-sync',
			category: 'Workspace',
			title: authState.user ? 'Manage account sync' : 'Sign in for sync',
			description: authState.user
				? 'View Firebase auth state and realtime workspace sync.'
				: 'Enable Firebase auth and bind this workspace to an account.',
			run: openAuthModal
		},
		{
			id: 'toggle-analysis',
			category: 'Analysis',
			title: 'Toggle analysis panel',
			description: 'Open the analysis drawer for the active equation.',
			shortcut: 'Mod+Shift+A',
			run: () => (ui.activeAnalysisEquationId = ui.activeEquationId)
		},
		{
			id: 'open-regression',
			category: 'Analysis',
			title: 'Open regression panel',
			description: 'Fit a model to the active data sheet.',
			shortcut: 'Mod+Shift+R',
			run: () => ui.openModal('regression')
		},
		{
			id: 'open-data',
			category: 'Data',
			title: 'Switch to data tab',
			description: 'Open the spreadsheet data panel.',
			shortcut: 'Mod+Shift+D',
			run: () => {
				ui.setSidebarActiveTab('data');
				ui.setSidebarOpen(true);
			}
		},
		{
			id: 'toggle-markers',
			category: 'Analysis',
			title: 'Toggle critical markers',
			description: 'Show or hide critical point markers.',
			shortcut: 'Mod+Shift+M',
			run: () => graph.updateSettings({ showCriticalPoints: !graph.settings.showCriticalPoints })
		},
		{
			id: 'toggle-intersections',
			category: 'Analysis',
			title: 'Toggle intersections',
			description: 'Show or hide intersection markers.',
			shortcut: 'Mod+Shift+I',
			run: () => graph.updateSettings({ showIntersections: !graph.settings.showIntersections })
		}
	]);

	onMount(() => {
		if (!browser) {
			return;
		}

		mounted = true;

		const savedTheme = localStorage.getItem('plotrix-theme');

		if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') {
			graph.updateSettings({ theme: savedTheme });
		}

		const hash = window.location.hash;
		const savedSections = localStorage.getItem(SETTINGS_SECTIONS_KEY);

		if (savedSections) {
			try {
				const parsed = JSON.parse(savedSections) as Partial<typeof DEFAULT_SETTINGS_SECTIONS>;
				settingsSections = {
					appearance: parsed.appearance ?? DEFAULT_SETTINGS_SECTIONS.appearance,
					grid: parsed.grid ?? DEFAULT_SETTINGS_SECTIONS.grid,
					analysis: parsed.analysis ?? DEFAULT_SETTINGS_SECTIONS.analysis,
					rendering: parsed.rendering ?? DEFAULT_SETTINGS_SECTIONS.rendering,
					canvas: parsed.canvas ?? DEFAULT_SETTINGS_SECTIONS.canvas
				};
			} catch {
				localStorage.removeItem(SETTINGS_SECTIONS_KEY);
			}
		}

		if (hash.startsWith('#plotrix=')) {
			initialSharedSnapshot = hash;
		} else if (hash === '#new') {
			initialHashAction = 'new';
		} else if (hash === '#share') {
			initialHashAction = 'share';
		}

		void authState.initialize();
	});

	onDestroy(() => {
		if (syncSuccessTimer) {
			clearTimeout(syncSuccessTimer);
		}

		sync.destroy();
		authState.destroy();
		graph.destroy();
		ui.destroy();
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		const resolved = resolveTheme(graph.settings.theme);
		document.documentElement.dataset.theme = resolved;
		document.documentElement.style.colorScheme = resolved;
		localStorage.setItem('plotrix-theme', graph.settings.theme);
	});

	$effect(() => {
		if (!browser) {
			return;
		}

		localStorage.setItem(SETTINGS_SECTIONS_KEY, JSON.stringify(settingsSections));
	});

	$effect(() => {
		if (!browser || !mounted || !authState.initialized) {
			return;
		}

		const currentUid = authState.user?.uid ?? null;
		const sessionKey = `${currentUid ?? 'guest'}:${workspaceId}`;
		const wasGuestSession = lastConfiguredSessionKey === `guest:${workspaceId}`;

		if (sessionKey === lastConfiguredSessionKey && initialSharedSnapshot === null) {
			return;
		}

		const sharedSnapshot = initialSharedSnapshot;
		const shouldPreferCurrentGraph =
			currentUid !== null &&
			wasGuestSession &&
			untrack(() => hasMeaningfulWorkspaceContent(graph.exportSnapshot()));

		lastConfiguredSessionKey = sessionKey;
		initialSharedSnapshot = null;

		void configureWorkspaceSession(authState.user, {
			preferCurrentGraph: shouldPreferCurrentGraph,
			sharedSnapshot,
			workspaceId
		});
	});

	$effect(() => {
		if (!sync.bootstrapped || hashActionHandled) {
			return;
		}

		hashActionHandled = true;

		if (initialHashAction === 'new') {
			addEquation('');
		}

		if (initialHashAction === 'share') {
			openShareModal();
		}

		initialHashAction = null;
	});

	$effect(() => {
		if (!browser || !sync.bootstrapped) {
			return;
		}

		void graph.historyIndex;
		void graph.historySize;
		sync.schedulePersist();
	});

	$effect(() => {
		if (sync.lastSyncedAt === null) {
			lastSeenSyncedAt = null;
			syncSuccessFlash = false;
			if (syncSuccessTimer) {
				clearTimeout(syncSuccessTimer);
				syncSuccessTimer = null;
			}
			return;
		}

		if (sync.status !== 'synced') {
			syncSuccessFlash = false;
			return;
		}

		if (lastSeenSyncedAt === null) {
			lastSeenSyncedAt = sync.lastSyncedAt;
			return;
		}

		if (sync.lastSyncedAt === lastSeenSyncedAt) {
			return;
		}

		lastSeenSyncedAt = sync.lastSyncedAt;
		syncSuccessFlash = true;

		if (syncSuccessTimer) {
			clearTimeout(syncSuccessTimer);
		}

		syncSuccessTimer = setTimeout(() => {
			syncSuccessFlash = false;
			syncSuccessTimer = null;
		}, 1100);
	});

	$effect(() => {
		if (!sync.error) {
			lastSyncError = '';
			return;
		}

		if (sync.error === lastSyncError) {
			return;
		}

		lastSyncError = sync.error;
		if (
			!/firestore rejected this workspace request|missing or insufficient permissions/i.test(
				sync.error
			)
		) {
			ui.pushToast({
				title: 'Workspace sync issue',
				description: sync.error,
				tone: 'warning'
			});
		}
	});

	$effect(() => {
		void ui.presentationMode;
		void tick().then(() => {
			graph.requestRender();
			requestAnimationFrame(() => {
				graph.requestRender();
			});
		});
	});
</script>

<svelte:head>
	<title>{sync.projectName} · Plotrix</title>
</svelte:head>

<input
	bind:this={importInput}
	type="file"
	accept="application/json"
	class="sr-only"
	onchange={handleImport}
/>
<input
	bind:this={imageInput}
	type="file"
	accept="image/*"
	class="sr-only"
	onchange={handleImageImport}
/>

<div class="sr-only" aria-live="polite" aria-atomic="true">{ui.announcement}</div>

<svelte:window onmousemove={() => ui.markPresentationActivity()} />

<div class="page-shell">
	<header class:hidden={ui.presentationMode} class="topbar">
		<div class="topbar-brand">
			<IconButton label="Back to dashboard" size={36} onClick={goToDashboard}>
				<Icon icon={ArrowLeft} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
			<img src="/brand/icon.svg" alt="" width="18" height="18" />
			<span>Plotrix</span>
		</div>

		<div class="toolbar-cluster">
			<IconButton
				label={ui.sidebarOpen ? 'Hide panel' : 'Show panel'}
				size={36}
				touchLabel="Panel"
				onClick={() => ui.setSidebarOpen(!ui.sidebarOpen)}
			>
				<Icon
					icon={ui.sidebarOpen ? PanelLeft : PanelRight}
					size="var(--icon-lg)"
					class="toolbar-icon"
				/>
			</IconButton>

			<IconButton
				label="Command"
				size={36}
				touchLabel="Command"
				onClick={() => ui.setCommandPaletteOpen(true)}
			>
				<Icon icon={Terminal} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
		</div>

		<div class="toolbar-divider toolbar-divider-push" aria-hidden="true"></div>

		<div class="account-cluster">
			<button
				type="button"
				class="sync-chip"
				data-state={sync.status}
				data-flash={syncSuccessFlash}
				title={syncStatusDescription}
				onclick={openAuthModal}
			>
				{#if authState.loading && authState.pendingAction === 'bootstrap'}
					<Icon icon={LoaderCircle} size="var(--icon-sm)" class="inline-icon spin-icon" />
				{:else if sync.status === 'error' || !authState.available}
					<Icon icon={CloudOff} size="var(--icon-sm)" class="inline-icon" />
				{:else if syncSuccessFlash}
					<Icon icon={Check} size="var(--icon-sm)" class="inline-icon sync-success-icon" />
				{:else}
					<Icon icon={Cloud} size="var(--icon-sm)" class="inline-icon" />
				{/if}
				<span>{syncStatusSummary}</span>
			</button>
			{#if ui.isOffline}
				<span
					class="offline-badge"
					title="Network connection lost. Firebase writes will retry later.">Offline</span
				>
			{/if}

			<button
				type="button"
				class="account-chip"
				aria-label={authState.user ? 'Open account sync' : 'Open sign-in dialog'}
				onclick={openAuthModal}
			>
				<span class="account-avatar" aria-hidden="true">
					{#if authState.user?.photoURL}
						<img src={authState.user.photoURL} alt="" referrerpolicy="no-referrer" />
					{:else}
						<Icon icon={UserRound} size="var(--icon-md)" class="inline-icon" />
					{/if}
				</span>
				<span class="account-copy">
					<strong>{accountLabel}</strong>
					<small>{accountSecondaryLabel}</small>
				</span>
			</button>
		</div>

		<div class="toolbar-cluster">
			<IconButton
				label="Undo"
				size={36}
				touchLabel="Undo"
				disabled={!canUndo}
				onClick={() => graph.undoHistory()}
			>
				<Icon icon={Undo2} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton
				label="Redo"
				size={36}
				touchLabel="Redo"
				disabled={!canRedo}
				onClick={() => graph.redoHistory()}
			>
				<Icon icon={Redo2} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
		</div>

		<div class="toolbar-divider" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton label="Theme" size={36} onClick={toggleTheme}>
				<Icon icon={SunMoon} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
		</div>

		<div class="toolbar-divider" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton
				label={ui.presentationMode ? 'Exit presentation' : 'Present'}
				size={36}
				onClick={() =>
					ui.presentationMode ? void ui.exitPresentationMode() : void enterPresentationMode()}
			>
				<Icon icon={Aperture} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton label="Settings" size={36} onClick={() => ui.openModal('settings')}>
				<Icon icon={Settings2} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton label="Export" size={36} onClick={() => ui.openModal('export')}>
				<Icon icon={Download} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton label="Share" size={36} onClick={openShareModal}>
				<Icon icon={Share2} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton label="Shortcuts" size={36} onClick={() => ui.openModal('shortcuts')}>
				<Icon icon={CircleHelp} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
		</div>

		<div class="toolbar-mobile-actions">
			<button
				type="button"
				class="toolbar-overflow-trigger"
				aria-expanded={mobileToolbarOpen}
				aria-label="Open toolbar actions"
				onclick={() => (mobileToolbarOpen = !mobileToolbarOpen)}
			>
				<Icon icon={MoreHorizontal} size="var(--icon-lg)" class="toolbar-icon" />
				<span>More</span>
			</button>
		</div>
	</header>

	{#if mobileToolbarOpen}
		<button
			type="button"
			class="toolbar-popover-backdrop"
			aria-label="Close toolbar actions"
			onclick={closeMobileToolbar}
		></button>
		<div class="toolbar-popover" role="dialog" aria-label="Toolbar actions">
			<button type="button" class="toolbar-popover-item" onclick={openAuthModal}>
				<Icon
					icon={authState.user ? UserRound : authState.available ? Cloud : CloudOff}
					size="var(--icon-md)"
					class="inline-icon"
				/>
				<span>{authState.user ? 'Account' : 'Sign in'}</span>
			</button>
			<button
				type="button"
				class="toolbar-popover-item"
				onclick={() => {
					toggleTheme();
					closeMobileToolbar();
				}}
			>
				<Icon icon={SunMoon} size="var(--icon-md)" class="inline-icon" />
				<span>Theme</span>
			</button>
			<button
				type="button"
				class="toolbar-popover-item"
				onclick={() => {
					void enterPresentationMode();
					closeMobileToolbar();
				}}
			>
				<Icon icon={Aperture} size="var(--icon-md)" class="inline-icon" />
				<span>Present</span>
			</button>
			<button
				type="button"
				class="toolbar-popover-item"
				onclick={() => {
					ui.openModal('settings');
					closeMobileToolbar();
				}}
			>
				<Icon icon={Settings2} size="var(--icon-md)" class="inline-icon" />
				<span>Settings</span>
			</button>
			<button
				type="button"
				class="toolbar-popover-item"
				onclick={() => {
					ui.openModal('export');
					closeMobileToolbar();
				}}
			>
				<Icon icon={Download} size="var(--icon-md)" class="inline-icon" />
				<span>Export</span>
			</button>
			<button type="button" class="toolbar-popover-item" onclick={openShareModal}>
				<Icon icon={Share2} size="var(--icon-md)" class="inline-icon" />
				<span>Share</span>
			</button>
			<button
				type="button"
				class="toolbar-popover-item"
				onclick={() => {
					ui.openModal('shortcuts');
					closeMobileToolbar();
				}}
			>
				<Icon icon={CircleHelp} size="var(--icon-md)" class="inline-icon" />
				<span>Shortcuts</span>
			</button>
		</div>
	{/if}

	<div
		class:presentation-mode={ui.presentationMode}
		class:sidebar-collapsed={!ui.sidebarOpen}
		class="workspace"
		style={`--sidebar-width: ${graph.settings.equationPanelWidth}px`}
	>
		<button
			type="button"
			class:hidden={ui.presentationMode}
			class:shown={ui.sidebarOpen}
			class="mobile-overlay"
			aria-label="Close sidebar"
			onclick={() => ui.setSidebarOpen(false)}
		></button>

		<aside
			class:hidden={ui.presentationMode}
			class:open={ui.sidebarOpen}
			class="sidebar"
			onpointerdown={handleSidebarPointerDown}
			onpointerup={handleSidebarPointerUp}
		>
			<section class="sidebar-panel">
				<header class="sidebar-header">
					<div class="sidebar-actions">
						<button
							type="button"
							class="compact-action compact-action-accent"
							onclick={() => addEquation('')}
						>
							<Icon icon={Plus} size="var(--icon-md)" class="inline-icon" />
							<span>Add</span>
						</button>

						<button
							type="button"
							class="compact-action compact-action-neutral"
							onclick={openImportDialog}
						>
							<Icon icon={Upload} size="var(--icon-md)" class="inline-icon" />
							<span>Import</span>
						</button>

						<button
							type="button"
							class="compact-action compact-action-neutral"
							onclick={async () => {
								const folder = graph.createFolder('New folder');
								await startFolderRename(folder.id);
							}}
						>
							<Icon icon={FolderClosed} size="var(--icon-md)" class="inline-icon" />
							<span>New folder</span>
						</button>
					</div>
				</header>
				<div class="sidebar-tabs" role="tablist" aria-label="Sidebar mode">
					<button
						type="button"
						role="tab"
						class="sidebar-tab"
						class:active={ui.sidebarActiveTab === 'equations'}
						aria-selected={ui.sidebarActiveTab === 'equations'}
						onclick={() => ui.setSidebarActiveTab('equations')}
					>
						<Icon icon={FunctionSquare} size="var(--icon-md)" class="inline-icon" />
						Equations
					</button>
					<button
						type="button"
						role="tab"
						class="sidebar-tab"
						class:active={ui.sidebarActiveTab === 'data'}
						aria-selected={ui.sidebarActiveTab === 'data'}
						onclick={() => ui.setSidebarActiveTab('data')}
					>
						<Icon icon={Grid3x3} size="var(--icon-md)" class="inline-icon" />
						Data
					</button>
				</div>

				{#if ui.sidebarActiveTab === 'equations'}
					<div
						class="sidebar-tab-content equation-list"
						style={`--equation-count:${graph.equations.length};`}
					>
						{#if graph.equations.length >= 5}
							<label class="equation-search">
								<Icon icon={Search} size="var(--icon-md)" class="equation-search-icon" />
								<input
									type="search"
									bind:value={equationQuery}
									placeholder="Search equations"
									aria-label="Search equations"
								/>
							</label>
						{/if}
						{#if graph.equations.length}
							{#if graph.folders.length > 0}
								<div
									role="button"
									tabindex="0"
									style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px dashed var(--color-border);border-radius:14px;color:var(--color-text-secondary);"
									ondragover={(event) => event.preventDefault()}
									ondrop={handleUngroupedDrop}
								>
									<span>Drop here to move an equation out of folders</span>
									<span
										>{graph.equations.filter((equation) => !graph.getFolderForEquation(equation.id))
											.length} ungrouped</span
									>
								</div>
							{/if}
							{#each sidebarItems as item (`${item.type}:${item.type === 'folder' ? item.folder.id : item.equation.id}`)}
								{#if item.type === 'folder'}
									<div
										draggable="true"
										role="group"
										aria-label={`Folder ${item.folder.name}`}
										style="display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto auto;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-border);border-radius:16px;background:color-mix(in oklch, var(--color-bg-surface) 94%, transparent);"
										ondragstart={(event) =>
											handleFolderDragStart(event, item.folder.id, item.folderIndex)}
										ondragover={(event) => event.preventDefault()}
										ondrop={(event) => handleFolderDrop(event, item.folder.id, item.folderIndex)}
									>
										<button
											type="button"
											class="summary-action"
											aria-label={item.folder.collapsed ? 'Expand folder' : 'Collapse folder'}
											onclick={() =>
												graph.updateFolder(item.folder.id, {
													collapsed: !item.folder.collapsed
												})}
										>
											<Icon
												icon={ChevronDown}
												size="var(--icon-md)"
												class={item.folder.collapsed
													? 'accordion-icon chevron-rotated'
													: 'accordion-icon'}
											/>
										</button>
										<span
											aria-hidden="true"
											style={`width:12px;height:12px;border-radius:999px;background:${item.folder.color};box-shadow:0 0 0 2px color-mix(in oklch, ${item.folder.color} 22%, transparent);`}
										></span>
										<div style="min-width:0;display:grid;gap:4px;">
											{#if editingFolderId === item.folder.id}
												<input
													class="folder-name-input"
													data-folder-name={item.folder.id}
													type="text"
													value={item.folder.name}
													oninput={(event) =>
														graph.updateFolder(item.folder.id, {
															name: (event.currentTarget as HTMLInputElement).value
														})}
													onblur={finishFolderRename}
													onkeydown={(event) => {
														if (event.key === 'Enter' || event.key === 'Escape') {
															finishFolderRename();
														}
													}}
												/>
											{:else}
												<button
													type="button"
													style="display:flex;align-items:center;gap:8px;padding:0;border:0;background:none;color:var(--color-text-primary);font:inherit;text-align:left;"
													ondblclick={() => void startFolderRename(item.folder.id)}
													onclick={() => void startFolderRename(item.folder.id)}
												>
													<Icon icon={FolderClosed} size="var(--icon-md)" class="inline-icon" />
													<strong
														style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
													>
														{item.folder.name}
													</strong>
												</button>
											{/if}
											<small style="color:var(--color-text-secondary);">
												{item.folder.equationIds.length} equation{item.folder.equationIds.length ===
												1
													? ''
													: 's'}
												{#if equationQuery.trim()}
													· {item.matchCount} match{item.matchCount === 1 ? '' : 'es'}
												{/if}
											</small>
										</div>
										<button
											type="button"
											class="summary-action"
											aria-label={item.folder.visible ? 'Hide folder' : 'Show folder'}
											onclick={() => toggleFolderVisibility(item.folder.id)}
										>
											<Icon
												icon={item.folder.visible ? Eye : EyeOff}
												size="var(--icon-md)"
												class="inline-icon"
											/>
										</button>
										<button
											type="button"
											class="summary-action"
											aria-label="Delete folder"
											onclick={() => graph.deleteFolder(item.folder.id)}
										>
											<Icon icon={Trash2} size="var(--icon-md)" class="inline-icon" />
										</button>
										<span style="color:var(--color-text-secondary);font-size:0.82rem;">
											#{item.folderIndex + 1}
										</span>
									</div>
								{:else}
									<EquationCard
										{graph}
										{ui}
										equation={item.equation}
										index={item.index}
										onActivate={setActiveEquation}
									/>
								{/if}
							{/each}
							{#if equationQuery.trim() && sidebarItems.filter((entry) => entry.type === 'equation').length === 0}
								<div class="empty-state compact-empty">
									<p>No equations match “{equationQuery.trim()}”.</p>
								</div>
							{/if}
						{:else}
							<div class="empty-state">
								<p>No equations yet.</p>
								<button
									type="button"
									class="compact-action compact-action-accent"
									onclick={() => addEquation('')}
								>
									<Icon icon={Plus} size="var(--icon-md)" class="inline-icon" />
									<span>Add equation</span>
								</button>
							</div>
						{/if}

						<VariableSliderPanel {graph} />

						<section class="distribution-panel">
							<button
								type="button"
								class="accordion"
								onclick={() => (distributionsOpen = !distributionsOpen)}
							>
								<span>Distributions</span>
								<Icon
									icon={ChevronDown}
									size="var(--icon-md)"
									class={!distributionsOpen ? 'accordion-icon chevron-rotated' : 'accordion-icon'}
								/>
							</button>
							{#if distributionsOpen}
								<div class="distribution-grid">
									{#each DISTRIBUTION_PRESETS as preset (preset.id)}
										<button
											type="button"
											class="distribution-card"
											onclick={() => addDistributionEquation(preset.raw, preset.equationLabel)}
										>
											<strong>{preset.label}</strong>
											<span>{preset.equationLabel}</span>
										</button>
									{/each}
								</div>
							{/if}
						</section>
					</div>
				{:else}
					<div class="sidebar-tab-content">
						<DataPanel {graph} {ui} />
					</div>
				{/if}
				{#if ui.sidebarActiveTab === 'equations'}
					<div class="sidebar-footer">
						{#if ui.selectedEquationIds.size === 2}
							<button
								type="button"
								class="compact-action compact-action-neutral shade-between"
								title="Select two cartesian equations with Shift + click to shade between them."
								onclick={shadeBetweenSelected}
								disabled={graph.equations
									.filter((equation) => ui.selectedEquationIds.has(equation.id))
									.some((equation) => equation.kind !== 'cartesian')}
							>
								Shade between
							</button>
						{/if}

						<div class="theme-switcher" role="group" aria-label="Theme">
							{#each themeOptions as option (option.value)}
								<button
									type="button"
									class:active={graph.settings.theme === option.value}
									onclick={() => applyTheme(option.value as 'system' | 'light' | 'dark')}
								>
									{option.label.slice(0, 1)}
									<span class="sr-only">{option.label}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		</aside>

		<div
			class:hidden={ui.presentationMode}
			class:active={resizingSidebar}
			class="sidebar-resizer"
			aria-hidden="true"
			onmousedown={startSidebarResize}
		></div>

		<section class="content-column">
			<GraphCanvas
				{graph}
				{ui}
				showControls={!ui.presentationMode}
				showRangeInputs={!ui.presentationMode}
			/>

			{#if ui.presentationMode}
				<div
					style={`position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:999px;border:1px solid var(--color-border);background:color-mix(in oklch, var(--color-bg-surface) 94%, transparent);backdrop-filter:blur(16px);box-shadow:var(--shadow-lg);opacity:${ui.presentationControlsVisible ? '1' : '0'};pointer-events:${ui.presentationControlsVisible ? 'auto' : 'none'};transition:opacity var(--duration-fast) var(--ease-default);z-index:30;`}
				>
					<button
						type="button"
						class="compact-action compact-action-neutral"
						onclick={() => void ui.exitPresentationMode()}
					>
						<Icon icon={CornerDownLeft} size="var(--icon-md)" class="inline-icon" />
						<span>Exit</span>
					</button>
					<button
						type="button"
						class="compact-action compact-action-neutral"
						aria-pressed={ui.laserPointerActive}
						onclick={() => ui.setLaserPointerActive(!ui.laserPointerActive)}
					>
						<Icon icon={Crosshair} size="var(--icon-md)" class="inline-icon" />
						<span>{ui.laserPointerActive ? 'Laser on' : 'Laser'}</span>
					</button>
					<button
						type="button"
						class="compact-action compact-action-neutral"
						onclick={() => graph.zoomTo(1.12)}
					>
						+
					</button>
					<button
						type="button"
						class="compact-action compact-action-neutral"
						onclick={() => graph.zoomTo(0.9)}
					>
						-
					</button>
				</div>
			{/if}
		</section>
	</div>
</div>

<AnalysisPanel {graph} {ui} />

<Modal
	open={ui.modalOpen === 'settings'}
	title="Settings"
	description="Tune the viewport, theme, and rendering defaults."
	onClose={() => ui.closeModal()}
>
	<div class="settings-list">
		<section class="settings-category">
			<button
				type="button"
				class="settings-category-header"
				aria-expanded={settingsSections.appearance}
				onclick={() => toggleSettingsSection('appearance')}
			>
				<div>
					<h3>Appearance</h3>
					<p>Core presentation and interaction overlays.</p>
				</div>
				<Icon
					icon={ChevronDown}
					size="var(--icon-md)"
					class={!settingsSections.appearance
						? 'section-chevron chevron-rotated'
						: 'section-chevron'}
				/>
			</button>
			{#if settingsSections.appearance}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={SunMoon} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong>Theme</strong>
						</div>
						<Select
							value={graph.settings.theme}
							options={themeOptions}
							ariaLabel="Theme"
							onChange={(value) =>
								graph.updateSettings({ theme: value as typeof graph.settings.theme })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={FunctionSquare} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-axis-labels-label">Axis labels</strong>
							<p>Numeric tick labels along axes.</p>
						</div>
						<Toggle
							label="Axis labels"
							ariaLabelledby="setting-axis-labels-label"
							checked={graph.settings.axisLabelsVisible}
							onChange={(checked) => graph.updateSettings({ axisLabelsVisible: checked })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={Crosshair} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-crosshair-label">Crosshair</strong>
							<p>Pointer-aligned coordinate overlay.</p>
						</div>
						<Toggle
							label="Crosshair overlay"
							ariaLabelledby="setting-crosshair-label"
							checked={graph.settings.crosshairVisible}
							onChange={(checked) => graph.updateSettings({ crosshairVisible: checked })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={MousePointer2} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-trace-label">Trace mode</strong>
							<p>Snap to nearest curve while hovering.</p>
						</div>
						<Toggle
							label="Trace mode"
							ariaLabelledby="setting-trace-label"
							checked={graph.settings.traceMode}
							onChange={(checked) => graph.updateSettings({ traceMode: checked })}
						/>
					</div>
				</div>
			{/if}
		</section>

		<section class="settings-category">
			<button
				type="button"
				class="settings-category-header"
				aria-expanded={settingsSections.grid}
				onclick={() => toggleSettingsSection('grid')}
			>
				<div>
					<h3>Grid & Axes</h3>
					<p>Structure, spacing, and axis scaffolding.</p>
				</div>
				<Icon
					icon={ChevronDown}
					size="var(--icon-md)"
					class={!settingsSections.grid ? 'section-chevron chevron-rotated' : 'section-chevron'}
				/>
			</button>
			{#if settingsSections.grid}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={Grid3x3} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-grid-label">Grid</strong>
							<p>Toggle entire graph grid.</p>
						</div>
						<Toggle
							label="Grid visibility"
							ariaLabelledby="setting-grid-label"
							checked={graph.settings.gridVisible}
							onChange={(checked) => graph.updateSettings({ gridVisible: checked })}
						/>
					</div>

					<div
						class="setting-row setting-row-nested"
						class:is-disabled={!graph.settings.gridVisible}
					>
						<div class="setting-row-icon">
							<Icon icon={Radar} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong>Grid style</strong>
							<p>Switch between Cartesian and Polar.</p>
						</div>
						<Select
							value={graph.settings.gridStyle}
							options={gridStyleOptions}
							ariaLabel="Grid style"
							disabled={!graph.settings.gridVisible}
							onChange={(value) =>
								graph.updateSettings({ gridStyle: value as typeof graph.settings.gridStyle })}
						/>
					</div>

					<div
						class="setting-row setting-row-nested"
						class:is-disabled={!graph.settings.gridVisible}
					>
						<div class="setting-row-icon">
							<Icon icon={Grid2x2} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-minor-grid-label">Minor grid</strong>
							<p>Render sub-divisions between major intervals.</p>
						</div>
						<Toggle
							label="Minor grid"
							ariaLabelledby="setting-minor-grid-label"
							disabled={!graph.settings.gridVisible}
							checked={graph.settings.minorGridVisible}
							onChange={(checked) => graph.updateSettings({ minorGridVisible: checked })}
						/>
					</div>
				</div>
			{/if}
		</section>

		<section class="settings-category">
			<button
				type="button"
				class="settings-category-header"
				aria-expanded={settingsSections.analysis}
				onclick={() => toggleSettingsSection('analysis')}
			>
				<div>
					<h3>Analysis</h3>
					<p>Markers and analytical overlays.</p>
				</div>
				<Icon
					icon={ChevronDown}
					size="var(--icon-md)"
					class={!settingsSections.analysis ? 'section-chevron chevron-rotated' : 'section-chevron'}
				/>
			</button>
			{#if settingsSections.analysis}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={CircleDot} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-critical-label">Critical markers</strong>
							<p>Show detected roots, extrema, and inflection points.</p>
						</div>
						<Toggle
							label="Critical markers"
							ariaLabelledby="setting-critical-label"
							checked={graph.settings.showCriticalPoints}
							onChange={(checked) => graph.updateSettings({ showCriticalPoints: checked })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={X} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-intersections-label">Intersections</strong>
							<p>Show detected intersections between visible curves.</p>
						</div>
						<Toggle
							label="Intersection markers"
							ariaLabelledby="setting-intersections-label"
							checked={graph.settings.showIntersections}
							onChange={(checked) => graph.updateSettings({ showIntersections: checked })}
						/>
					</div>
				</div>
			{/if}
		</section>

		<section class="settings-category">
			<button
				type="button"
				class="settings-category-header"
				aria-expanded={settingsSections.rendering}
				onclick={() => toggleSettingsSection('rendering')}
			>
				<div>
					<h3>Rendering</h3>
					<p>Performance and raster output behavior.</p>
				</div>
				<Icon
					icon={ChevronDown}
					size="var(--icon-md)"
					class={!settingsSections.rendering
						? 'section-chevron chevron-rotated'
						: 'section-chevron'}
				/>
			</button>
			{#if settingsSections.rendering}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={CircleGauge} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-render-timing-label">Render timings</strong>
							<p>Per-curve render durations on cards.</p>
						</div>
						<Toggle
							label="Render timings"
							ariaLabelledby="setting-render-timing-label"
							checked={graph.settings.showRenderTime}
							onChange={(checked) => graph.updateSettings({ showRenderTime: checked })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={ScanEye} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-hidpi-label">HiDPI rendering</strong>
							<p>Pixel ratio scaling for sharper output.</p>
						</div>
						<Toggle
							label="HiDPI rendering"
							ariaLabelledby="setting-hidpi-label"
							checked={graph.settings.highDPI}
							onChange={(checked) => graph.updateSettings({ highDPI: checked })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={Aperture} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong id="setting-antialiasing-label">Antialiasing</strong>
							<p>Smooth curves and axes during rasterization.</p>
						</div>
						<Toggle
							label="Antialiasing"
							ariaLabelledby="setting-antialiasing-label"
							checked={graph.settings.antialiasing}
							onChange={(checked) => graph.updateSettings({ antialiasing: checked })}
						/>
					</div>
				</div>
			{/if}
		</section>

		<section class="settings-category">
			<button
				type="button"
				class="settings-category-header"
				aria-expanded={settingsSections.canvas}
				onclick={() => toggleSettingsSection('canvas')}
			>
				<div>
					<h3>Canvas</h3>
					<p>Local-only background images and calibration.</p>
				</div>
				<Icon
					icon={ChevronDown}
					size="var(--icon-md)"
					class={!settingsSections.canvas ? 'section-chevron chevron-rotated' : 'section-chevron'}
				/>
			</button>
			{#if settingsSections.canvas}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<Icon icon={Upload} size="var(--icon-lg)" class="setting-icon" />
						</div>
						<div class="setting-copy">
							<strong>Background images</strong>
							<p>Images stay local to this device and are never uploaded to Firebase.</p>
						</div>
						<button
							type="button"
							class="compact-action compact-action-neutral"
							onclick={openImageDialog}
						>
							Add image
						</button>
					</div>

					{#if backgroundImages.length}
						{#each backgroundImages as image (image.id)}
							<div class="setting-row" style="align-items:start;">
								<div class="setting-row-icon">
									<Icon icon={FolderClosed} size="var(--icon-lg)" class="setting-icon" />
								</div>
								<div class="setting-copy">
									<strong>Background image</strong>
									<p>
										{image.width}×{image.height}
										{image.calibration ? ' · calibrated' : ' · not calibrated'}
									</p>
									<div style="max-width:220px;">
										<Slider
											value={image.opacity}
											min={0.05}
											max={1}
											step={0.01}
											ariaLabel="Background image opacity"
											onChange={(opacity) => graph.updateBackgroundImage(image.id, { opacity })}
										/>
									</div>
								</div>
								<div
									style="display:flex;flex-wrap:wrap;justify-content:end;gap:8px;align-self:center;"
								>
									<button
										type="button"
										class="compact-action compact-action-neutral"
										onclick={() => startImageCalibration(image.id)}
									>
										{image.calibration ? 'Recalibrate' : 'Calibrate'}
									</button>
									<button
										type="button"
										class="compact-action compact-action-neutral"
										onclick={() => graph.removeBackgroundImage(image.id)}
									>
										Remove
									</button>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</section>
	</div>
</Modal>

<Modal
	open={ui.modalOpen === 'calibration' && ui.calibrationPrompt !== null}
	title="Calibrate background image"
	description={`Point ${ui.calibrationPrompt?.step ?? 1}: enter the graph coordinates for the selected image point.`}
	onClose={cancelCalibrationPrompt}
>
	{#if ui.calibrationPrompt}
		<form
			class="share-stack"
			onsubmit={(event) => {
				event.preventDefault();
				confirmCalibrationPrompt();
			}}
		>
			<div class="values-controls">
				<label>
					<span>Math x</span>
					<input type="number" bind:value={ui.calibrationPrompt.xInput} />
				</label>
				<label>
					<span>Math y</span>
					<input type="number" bind:value={ui.calibrationPrompt.yInput} />
				</label>
			</div>
			<div class="share-actions">
				<button
					type="button"
					class="action-btn action-btn-secondary"
					onclick={cancelCalibrationPrompt}
				>
					Cancel
				</button>
				<button type="submit" class="action-btn action-btn-primary">Save point</button>
			</div>
		</form>
	{/if}
</Modal>

<Modal
	open={ui.modalOpen === 'auth'}
	title="Account sync"
	description="Sign in with Firebase to keep this Plotrix workspace synced in real time across sessions."
	onClose={() => ui.closeModal()}
>
	<AuthPanel auth={authState} {sync} onClose={() => ui.closeModal()} />
</Modal>

<Modal open={ui.modalOpen === 'regression'} title="Regression" onClose={() => ui.closeModal()}>
	<RegressionPanel {graph} {ui} />
</Modal>

<Modal open={ui.modalOpen === 'export'} title="Export" onClose={() => ui.closeModal()}>
	<div class="export-grid">
		<button type="button" class="export-card" onclick={() => exportPNG(1)}>
			<strong>PNG 1x</strong>
			<p>Fast raster export for quick sharing.</p>
		</button>
		<button type="button" class="export-card" onclick={() => exportPNG(2)}>
			<strong>PNG 2x</strong>
			<p>High-density raster export for presentations.</p>
		</button>
		<button type="button" class="export-card" onclick={() => exportPNG(3)}>
			<strong>PNG 3x</strong>
			<p>Maximum raster sharpness for detailed layouts.</p>
		</button>
		<button type="button" class="export-card" onclick={exportSVGFile}>
			<strong>SVG</strong>
			<p>Vector output for design tools and scalable docs.</p>
		</button>
		<button type="button" class="export-card" onclick={() => void exportPDFFile()}>
			<strong>PDF</strong>
			<p>Vector PDF for academic submission and print workflows.</p>
		</button>
		<button type="button" class="export-card" onclick={exportJSONFile}>
			<strong>JSON</strong>
			<p>Complete Plotrix session for import or versioning.</p>
		</button>
	</div>
</Modal>

<Modal open={ui.modalOpen === 'share'} title="Share" onClose={() => ui.closeModal()}>
	<div class="share-stack">
		<div class="share-field">
			<div class="share-field-icon" aria-hidden="true">
				<Icon icon={Lock} size="var(--icon-md)" class="inline-icon" />
			</div>
			<input
				class="share-readonly"
				aria-label="Share URL (read-only)"
				readonly
				title="Read-only share URL"
				value={shareUrl}
			/>
		</div>
		<p class="share-note">Read-only link generated from the current Plotrix session.</p>
		<div class="share-actions">
			<button type="button" class="action-btn action-btn-primary" onclick={copyShareLink}>
				Copy link
			</button>
			<button
				type="button"
				class="action-btn action-btn-secondary"
				onclick={() => saveText(graph.exportJSON(), 'plotrix-share.json')}
			>
				Download JSON
			</button>
		</div>
		<hr style="border:0;border-top:1px solid var(--color-border);width:100%;margin:4px 0;" />
		<div class="share-actions">
			<button
				type="button"
				class="action-btn action-btn-secondary"
				onclick={() => (embedPanelOpen = !embedPanelOpen)}
			>
				Get embed code
			</button>
		</div>
		{#if embedPanelOpen}
			<div class="share-stack">
				{#if authState.user}
					<div class="setting-row" style="margin:0;">
						<div class="setting-copy">
							<strong>Public embed</strong>
							<p>Making this workspace public allows anyone with the link to view it.</p>
						</div>
						<Toggle
							label="Public embed visibility"
							checked={sync.isPublic}
							onChange={(checked) => void toggleWorkspacePublic(checked)}
						/>
					</div>
					<div class="share-field">
						<textarea
							class="share-readonly"
							aria-label="Embed code"
							readonly
							rows="4"
							value={embedCode}
						></textarea>
					</div>
					<div class="share-actions">
						<button
							type="button"
							class="action-btn action-btn-primary"
							onclick={copyEmbedCode}
							disabled={!sync.isPublic}
						>
							Copy embed code
						</button>
					</div>
				{:else}
					<p class="share-note">
						Sign in to publish this workspace and generate an embeddable iframe.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</Modal>

<Modal open={ui.modalOpen === 'shortcuts'} title="Shortcuts" onClose={() => ui.closeModal()}>
	<div class="shortcut-list">
		{#each shortcuts as [label, combo] (label)}
			<div class="shortcut-row">
				<strong>{label}</strong>
				<kbd>{combo}</kbd>
			</div>
		{/each}
	</div>
</Modal>

<CommandPalette
	open={ui.commandPaletteOpen}
	actions={commandActions}
	onClose={() => ui.setCommandPaletteOpen(false)}
/>
<ToastViewport {ui} />
