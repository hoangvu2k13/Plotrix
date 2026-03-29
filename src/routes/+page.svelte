<script lang="ts">
	import { browser } from '$app/environment';
	import {
		Aperture,
		Check,
		CircleHelp,
		ChevronDown,
		CircleDot,
		CircleGauge,
		Cloud,
		CloudOff,
		Crosshair,
		Download,
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
		Undo2,
		Upload,
		UserRound,
		X
	} from '@lucide/svelte';
	import { onDestroy, onMount, untrack } from 'svelte';

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
		rendering: true
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

	let importInput: HTMLInputElement | null = null;
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
	let lastConfiguredUid: string | null | undefined = undefined;
	let lastSyncError = '';
	let syncSuccessFlash = $state(false);
	let lastSeenSyncedAt: number | null = null;
	let syncSuccessTimer: ReturnType<typeof setTimeout> | null = null;

	const canUndo = $derived(graph.historyIndex > 0);
	const canRedo = $derived(graph.historyIndex < graph.historySize - 1);
	const syncStatusSummary = $derived.by(() => {
		if (authState.loading && authState.pendingAction === 'bootstrap') {
			return 'Checking account';
		}

		if (!authState.available) {
			return 'Firebase off';
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
	const filteredEquations = $derived.by(() => {
		const needle = equationQuery.trim().toLowerCase();
		const indexed = graph.equations.map((equation, index) => ({ equation, index }));

		if (!needle) {
			return indexed;
		}

		return indexed.filter(({ equation }) =>
			`${equation.raw} ${equation.label}`.toLowerCase().includes(needle)
		);
	});
	function addEquation(raw = ''): void {
		const equation = graph.addEquation(raw);
		ui.activeEquationId = equation.id;
		ui.selectedEquationIds = new Set([equation.id]);
		ui.sidebarOpen = true;
		ui.announce('Equation added');
	}

	function setActiveEquation(id: string): void {
		ui.activeEquationId = id;
		ui.selectedEquationIds = new Set([id]);
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

	function closeMobileToolbar(): void {
		mobileToolbarOpen = false;
	}

	function openAuthModal(): void {
		ui.openModal('auth');
		closeMobileToolbar();
	}

	async function configureWorkspaceSession(
		user: typeof authState.user,
		options: {
			preferCurrentGraph?: boolean;
			sharedSnapshot?: string | null;
		} = {}
	): Promise<void> {
		const token = ++sessionConfigToken;
		await sync.configureSession(user, options);

		if (token !== sessionConfigToken) {
			return;
		}

		ui.activeEquationId = graph.equations[0]?.id ?? null;
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
			ui.activeEquationId = graph.equations[0]?.id ?? null;
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
				ui.sidebarActiveTab = 'data';
				ui.sidebarOpen = true;
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
					rendering: parsed.rendering ?? DEFAULT_SETTINGS_SECTIONS.rendering
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

		if (currentUid === lastConfiguredUid && initialSharedSnapshot === null) {
			return;
		}

		const sharedSnapshot = initialSharedSnapshot;
		const shouldPreferCurrentGraph =
			currentUid !== null &&
			lastConfiguredUid === null &&
			untrack(() => hasMeaningfulWorkspaceContent(graph.exportSnapshot()));

		lastConfiguredUid = currentUid;
		initialSharedSnapshot = null;

		void configureWorkspaceSession(authState.user, {
			preferCurrentGraph: shouldPreferCurrentGraph,
			sharedSnapshot
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
		ui.pushToast({
			title: 'Workspace sync issue',
			description: sync.error,
			tone: 'warning'
		});
	});
</script>

<svelte:head>
	<title>Plotrix · Graph Visualizer</title>
</svelte:head>

<input
	bind:this={importInput}
	type="file"
	accept="application/json"
	class="sr-only"
	onchange={handleImport}
/>

<div class="sr-only" aria-live="polite" aria-atomic="true">{ui.announcement}</div>

<div class="page-shell">
	<header class="topbar">
		<div class="topbar-brand">
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
		class:sidebar-collapsed={!ui.sidebarOpen}
		class="workspace"
		style={`--sidebar-width: ${graph.settings.equationPanelWidth}px`}
	>
		<button
			type="button"
			class:shown={ui.sidebarOpen}
			class="mobile-overlay"
			aria-label="Close sidebar"
			onclick={() => ui.setSidebarOpen(false)}
		></button>

		<aside
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
							{#each filteredEquations as entry (entry.equation.id)}
								<EquationCard
									{graph}
									{ui}
									equation={entry.equation}
									index={entry.index}
									onActivate={setActiveEquation}
								/>
							{/each}
							{#if equationQuery.trim() && filteredEquations.length === 0}
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
					</div>
				{:else}
					<div class="sidebar-tab-content">
						<DataPanel {graph} {ui} />
					</div>
				{/if}
				{#if ui.sidebarActiveTab === 'equations'}
					<div class="sidebar-footer">
						<button
							type="button"
							class="compact-action compact-action-neutral shade-between"
							title="Select two cartesian equations with Shift + click to shade between them."
							onclick={shadeBetweenSelected}
							disabled={ui.selectedEquationIds.size !== 2 ||
								graph.equations
									.filter((equation) => ui.selectedEquationIds.has(equation.id))
									.some((equation) => equation.kind !== 'cartesian')}
						>
							Shade between
						</button>

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
			class:active={resizingSidebar}
			class="sidebar-resizer"
			aria-hidden="true"
			onmousedown={startSidebarResize}
		></div>

		<section class="content-column">
			<GraphCanvas {graph} {ui} />
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
	</div>
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
