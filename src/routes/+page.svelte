<script lang="ts">
	import { browser } from '$app/environment';
	import {
		Aperture,
		ChevronDown,
		CircleDot,
		CircleGauge,
		Crosshair,
		Download,
		Grid2x2,
		Grid3x3,
		Lock,
		MoreHorizontal,
		MousePointer2,
		PanelLeft,
		PanelRight,
		Plus,
		Radar,
		Redo2,
		ScanEye,
		Settings2,
		Share2,
		Sigma,
		SunMoon,
		Terminal,
		Undo2,
		Upload,
		X
	} from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';

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
	import { createGraphState } from '$stores/graph.svelte';
	import { createUiState } from '$stores/ui.svelte';
	import { copyText, saveBlob, saveText } from '$utils/download';
	import { formatShortcut } from '$utils/format';
	import { nextTheme, resolveTheme } from '$utils/theme';

	const graph = createGraphState();
	const ui = createUiState();

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
		['Pan', 'Drag or use arrow keys'],
		['Zoom', 'Mouse wheel, pinch, +, -'],
		['Reset view', '0'],
		['Fit all', 'F'],
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
	let resizingSidebar = $state(false);
	let settingsSections = $state({ ...DEFAULT_SETTINGS_SECTIONS });
	let mobileToolbarOpen = $state(false);

	const canUndo = $derived(graph.historyIndex > 0);
	const canRedo = $derived(graph.historyIndex < graph.historySize - 1);
	const equationCount = $derived(graph.equations.length);
	const visibleCount = $derived(graph.equations.filter((equation) => equation.visible).length);

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
		graph.addEquation(`y >= (${first.raw.trim()})`, 'inequality');
		graph.addEquation(`y <= (${second.raw.trim()})`, 'inequality');
		ui.pushToast({
			title: 'Shaded region added',
			description: 'Created an inequality pair between the selected curves.',
			tone: 'success'
		});
	}

	function toggleTheme(): void {
		graph.updateSettings({ theme: nextTheme(graph.settings.theme) });
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
			graph.importJSON(await file.text());
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
			shortcut: 'F',
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

		const savedTheme = localStorage.getItem('plotrix-theme');

		if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') {
			graph.updateSettings({ theme: savedTheme });
		}

		const hash = window.location.hash;
		let restored = false;
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

		try {
			if (hash.startsWith('#plotrix=')) {
				graph.importJSON(hash);
				restored = true;
			} else {
				const stored = localStorage.getItem('plotrix-session');

				if (stored) {
					graph.importJSON(stored);
					restored = true;
				}
			}
		} catch {
			localStorage.removeItem('plotrix-session');
			ui.pushToast({
				title: 'Previous session skipped',
				description: 'Plotrix started fresh because the saved session could not be restored.',
				tone: 'warning'
			});
		}

		if (hash === '#new') {
			addEquation('');
		}

		if (hash === '#share') {
			openShareModal();
		}

		if (!restored && !graph.equations.length) {
			graph.seedStarterEquations();
		}

		ui.activeEquationId = graph.equations[0]?.id ?? null;
	});

	onDestroy(() => {
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
		if (!browser) {
			return;
		}

		graph.historyIndex;
		graph.historySize;
		localStorage.setItem('plotrix-session', graph.exportJSON());
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
				onClick={() => ui.setSidebarOpen(!ui.sidebarOpen)}
			>
				<Icon
					icon={ui.sidebarOpen ? PanelLeft : PanelRight}
					size="var(--icon-lg)"
					class="toolbar-icon"
				/>
			</IconButton>

			<IconButton label="Command" size={36} onClick={() => ui.setCommandPaletteOpen(true)}>
				<Icon icon={Terminal} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>
		</div>

		<div class="toolbar-divider toolbar-divider-push" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton label="Undo" size={36} disabled={!canUndo} onClick={() => graph.undoHistory()}>
				<Icon icon={Undo2} size="var(--icon-lg)" class="toolbar-icon" />
			</IconButton>

			<IconButton label="Redo" size={36} disabled={!canRedo} onClick={() => graph.redoHistory()}>
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

		<aside class:open={ui.sidebarOpen} class="sidebar">
			<section class="sidebar-panel">
				<header class="sidebar-header">
					<div class="brand-lockup">
						<div class="brand-mark">
							<img src="/brand/icon.svg" alt="" width="22" height="22" />
						</div>
						<div>
							<p class="brand-title">Plotrix</p>
						</div>
					</div>

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
						<Icon icon={Sigma} size="var(--icon-md)" class="inline-icon" />
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
					<div class="sidebar-tab-content equation-list">
						{#if graph.equations.length}
							{#each graph.equations as equation, index (equation.id)}
								<EquationCard {graph} {ui} {equation} {index} onActivate={setActiveEquation} />
							{/each}
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
						<p class="selection-hint">
							Select two equations with `Shift` + click to shade between them.
						</p>
						{#if ui.selectedEquationIds.size === 2}
							<button
								type="button"
								class="compact-action compact-action-neutral shade-between"
								onclick={shadeBetweenSelected}
							>
								Shade between
							</button>
						{/if}
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
					class={`section-chevron ${!settingsSections.appearance ? 'collapsed' : ''}`}
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
							<Icon icon={Sigma} size="var(--icon-lg)" class="setting-icon" />
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
					class={`section-chevron ${!settingsSections.grid ? 'collapsed' : ''}`}
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
					class={`section-chevron ${!settingsSections.analysis ? 'collapsed' : ''}`}
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
					class={`section-chevron ${!settingsSections.rendering ? 'collapsed' : ''}`}
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
			<input class="share-readonly" readonly value={shareUrl} />
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

<style>
	:global(body) {
		overflow: hidden;
	}

	.page-shell {
		display: grid;
		grid-template-rows: 48px minmax(0, 1fr);
		height: 100svh;
		background:
			radial-gradient(
				circle at top right,
				color-mix(in srgb, var(--color-accent) 12%, transparent),
				transparent 34%
			),
			var(--color-bg-base);
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-surface);
	}

	.toolbar-mobile-actions {
		display: none;
		margin-left: auto;
	}

	.toolbar-overflow-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 36px;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
	}

	.toolbar-popover-backdrop {
		position: fixed;
		inset: 48px 0 0;
		z-index: calc(var(--z-toolbar) + 1);
		background: rgba(9, 9, 11, 0.22);
	}

	.toolbar-popover {
		position: fixed;
		top: calc(48px + var(--space-2));
		right: var(--space-3);
		z-index: calc(var(--z-toolbar) + 2);
		display: grid;
		gap: var(--space-2);
		min-width: 180px;
		padding: var(--space-3);
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-surface) 96%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(12px);
	}

	.toolbar-popover-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--color-text-primary);
		text-align: left;
	}

	.toolbar-popover-item:hover {
		background: var(--color-bg-overlay);
		border-radius: var(--radius-lg);
	}

	.topbar-brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		margin-right: var(--space-2);
		color: var(--color-text-primary);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-semibold);
	}

	.topbar-brand img {
		display: block;
	}

	.toolbar-cluster {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.toolbar-divider {
		width: 1px;
		height: 20px;
		background: var(--color-border);
	}

	.toolbar-divider-push {
		margin-left: auto;
	}

	.workspace {
		position: relative;
		display: grid;
		grid-template-columns: var(--sidebar-width) 0 minmax(0, 1fr);
		min-height: 0;
		padding: var(--space-3);
		gap: var(--space-3);
	}

	.workspace.sidebar-collapsed {
		grid-template-columns: 0 0 minmax(0, 1fr);
	}

	.sidebar {
		position: relative;
		z-index: var(--z-sidebar);
		min-height: 0;
		min-width: 0;
		transition:
			opacity var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}

	.workspace.sidebar-collapsed .sidebar {
		opacity: 0;
		pointer-events: none;
		transform: translateX(calc(-1 * var(--space-4)));
	}

	.sidebar-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		height: 100%;
		min-height: 0;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-2xl) + 2px);
		background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(12px);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.brand-lockup {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.brand-mark {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 10px;
		background: var(--color-bg-overlay);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border) 80%, transparent);
	}

	.brand-mark img {
		width: 22px;
		height: 22px;
	}

	.brand-title {
		font-size: var(--text-md);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-primary);
	}

	:global(.brand-subtitle) {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.sidebar-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.compact-action {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
	}

	.compact-action:hover {
		transform: translateY(-1px);
	}

	:global(.inline-icon),
	:global(.toolbar-icon) {
		display: block;
	}

	.compact-action-accent {
		border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	.compact-action-neutral {
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-secondary);
	}

	:global(.panel-stats) {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		flex-wrap: nowrap;
		overflow: hidden;
		max-height: 32px;
	}

	.sidebar-tabs {
		display: flex;
		flex-direction: row;
		width: 100%;
		margin: 0;
		padding: 0;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
		border-radius: 0;
		background: transparent;
	}

	.sidebar-tab {
		flex: 1;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1-5);
		padding: 0 var(--space-3);
		background: transparent;
		border: none;
		box-shadow: inset 0 -2px 0 transparent;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.sidebar-tab.active {
		box-shadow: inset 0 -2px 0 var(--color-accent);
		color: var(--color-text-primary);
	}

	.sidebar-tab:hover:not(.active) {
		color: var(--color-text-primary);
		background: var(--color-bg-overlay);
	}

	.sidebar-tab-content {
		position: relative;
		z-index: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	:global(.panel-stat) {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	:global(.panel-stat svg) {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	:global(.panel-stat-separator) {
		width: 3px;
		height: 3px;
		border-radius: 999px;
		background: var(--color-text-muted);
		flex-shrink: 0;
	}

	.equation-list {
		display: grid;
		flex: 1;
		align-content: start;
		gap: var(--space-3);
		min-height: 0;
		overflow: auto;
		scrollbar-gutter: stable;
	}

	.shade-between {
		justify-self: start;
	}

	.sidebar-footer {
		display: grid;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.selection-hint {
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
	}

	.empty-state {
		display: grid;
		justify-items: start;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-base) 80%, transparent);
		color: var(--color-text-secondary);
	}

	.sidebar-resizer {
		position: relative;
		left: calc(-1 * var(--space-1-5));
		width: 8px;
		margin-right: calc(-1 * var(--space-1-5));
		border-radius: var(--radius-full);
		background: transparent;
		cursor: col-resize;
	}

	.workspace.sidebar-collapsed .sidebar-resizer {
		pointer-events: none;
		opacity: 0;
	}

	.sidebar-resizer.active,
	.sidebar-resizer:hover {
		background: color-mix(in srgb, var(--color-accent) 28%, transparent);
	}

	.content-column {
		min-width: 0;
		min-height: 0;
	}

	.mobile-overlay {
		display: none;
	}

	.settings-list,
	.export-grid,
	.shortcut-list {
		display: grid;
	}

	.settings-list {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		align-items: start;
	}

	.settings-category {
		border: 1px solid color-mix(in srgb, var(--color-border) 76%, transparent);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
		overflow: hidden;
	}

	.settings-category-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		text-align: left;
		background: color-mix(in srgb, var(--color-bg-overlay) 78%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
	}

	.settings-category-header:focus-visible {
		outline: none;
		box-shadow:
			inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 58%, transparent),
			var(--shadow-focus);
	}

	.settings-category-header h3 {
		font-size: var(--text-sm);
	}

	.settings-category-header p {
		margin-top: 2px;
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
	}

	:global(.section-chevron) {
		flex-shrink: 0;
		transition: transform var(--duration-fast) var(--ease-default);
	}

	:global(.section-chevron.collapsed) {
		transform: rotate(-90deg);
	}

	.settings-category-body {
		display: grid;
		padding: 0 var(--space-4);
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid rgba(var(--color-border-rgb), 0.5);
		background: transparent;
	}

	.setting-row:last-child {
		border-bottom: none;
	}

	.setting-row-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: var(--color-text-secondary);
	}

	:global(.setting-icon) {
		display: block;
	}

	.setting-copy {
		display: grid;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}

	.setting-copy strong {
		font-size: var(--text-sm);
	}

	.setting-copy p {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}

	.setting-row :global(.select-shell) {
		width: 140px;
		flex-shrink: 0;
	}

	.setting-row :global(.toggle) {
		margin-left: auto;
		flex-shrink: 0;
	}

	.setting-row-nested {
		padding-left: var(--space-5);
	}

	.setting-row-nested .setting-row-icon {
		opacity: 0.82;
	}

	.setting-row.is-disabled {
		opacity: 0.55;
	}

	.export-grid {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: var(--space-3);
	}

	.export-card {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-bg-base);
		text-align: left;
		cursor: pointer;
	}

	.export-card:hover {
		border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border));
		background: color-mix(in srgb, var(--color-bg-overlay) 72%, var(--color-bg-surface));
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}

	.export-card p {
		color: var(--color-text-secondary);
	}

	.share-stack {
		display: grid;
		gap: var(--space-3);
	}

	.share-field {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		align-items: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-overlay) 92%, var(--color-bg-base));
	}

	.share-field-icon {
		display: grid;
		place-items: center;
		color: var(--color-text-secondary);
	}

	.share-stack input,
	.share-readonly {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 0;
		background: transparent;
		color: var(--color-text-primary);
	}

	.share-readonly {
		font-family: var(--font-mono);
	}

	.share-note {
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
	}

	.share-actions {
		display: flex;
		gap: var(--space-3);
	}

	.action-btn {
		height: 36px;
		padding: 0 var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
	}

	.action-btn:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-sm);
	}

	.action-btn-primary {
		border: 1px solid color-mix(in srgb, var(--color-accent) 60%, var(--color-border));
		background: var(--color-accent);
		color: var(--color-accent-foreground);
	}

	.action-btn-secondary {
		border: 1px solid var(--color-border);
		background: var(--color-bg-overlay);
		color: var(--color-text-secondary);
	}

	.shortcut-list {
		gap: var(--space-3);
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-base);
	}

	kbd {
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-subtle);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	@media (max-width: 1100px) {
		.settings-list {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 960px) {
		:global(body) {
			overflow: auto;
		}

		.page-shell {
			grid-template-rows: 48px auto;
			height: auto;
			min-height: 100svh;
		}

		.toolbar-divider,
		.topbar > .toolbar-cluster:nth-of-type(3),
		.topbar > .toolbar-cluster:nth-of-type(4) {
			display: none;
		}

		.toolbar-mobile-actions {
			display: inline-flex;
		}

		.workspace {
			grid-template-columns: 1fr;
			padding: var(--space-3);
		}

		.sidebar {
			position: fixed;
			top: 48px;
			left: 0;
			bottom: 0;
			width: min(92vw, 360px);
			padding: var(--space-3);
			transform: translateX(calc(-100% - var(--space-3)));
			transition: transform var(--duration-normal) var(--ease-default);
		}

		.sidebar.open {
			transform: translateX(0);
		}

		.sidebar-resizer {
			display: none;
		}

		.mobile-overlay {
			position: fixed;
			inset: 48px 0 0;
			z-index: calc(var(--z-sidebar) - 1);
			display: block;
			background: rgba(9, 9, 11, 0.45);
			opacity: 0;
			pointer-events: none;
			transition: opacity var(--duration-normal) var(--ease-default);
		}

		.mobile-overlay.shown {
			opacity: 1;
			pointer-events: auto;
		}
	}

	@media (max-width: 720px) {
		.settings-category-header {
			padding: var(--space-3);
		}

		.settings-category-body {
			padding: 0 var(--space-3);
		}

		.export-grid {
			grid-template-columns: 1fr;
		}

		:global(.panel-stats) {
			flex-wrap: wrap;
			max-height: none;
		}

		.setting-row {
			align-items: flex-start;
		}

		.setting-row-nested {
			padding-left: var(--space-4);
		}

		.sidebar-header {
			flex-direction: column;
			align-items: stretch;
		}

		.sidebar-actions,
		.share-actions {
			flex-wrap: wrap;
		}
	}
</style>
