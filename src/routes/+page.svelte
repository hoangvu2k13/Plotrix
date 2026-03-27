<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	import CommandPalette, { type CommandAction } from '$components/CommandPalette.svelte';
	import DataPanel from '$components/DataPanel.svelte';
	import EquationCard from '$components/EquationCard.svelte';
	import GraphCanvas from '$components/GraphCanvas.svelte';
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
		graph.addEquation(`y >= ${first.raw}`, 'inequality');
		graph.addEquation(`y <= ${second.raw}`, 'inequality');
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
		shareUrl = graph.shareURL() ?? (browser ? window.location.href : '');
		ui.openModal('share');
	}

	async function copyShareLink(): Promise<void> {
		if (!shareUrl) {
			shareUrl = graph.shareURL() ?? '';
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
			title: 'Add equation',
			description: 'Create a fresh editable equation row.',
			shortcut: 'Mod+E',
			run: () => addEquation('')
		},
		{
			id: 'fit-all',
			title: 'Fit all curves',
			description: 'Auto-frame the visible equations in the canvas.',
			shortcut: 'F',
			run: () => graph.fitAll()
		},
		{
			id: 'reset-view',
			title: 'Reset view',
			description: 'Return to the default zoom and centered origin.',
			shortcut: '0',
			run: () => graph.resetView()
		},
		{
			id: 'toggle-theme',
			title: 'Cycle theme',
			description: 'Move between system, light, and dark presentation.',
			run: toggleTheme
		},
		{
			id: 'export-svg',
			title: 'Export SVG',
			description: 'Save a vector render of the current graph.',
			run: exportSVGFile
		},
		{
			id: 'share',
			title: 'Open share link',
			description: 'Generate a portable URL with the current graph state.',
			run: openShareModal
		},
		{
			id: 'settings',
			title: 'Open settings',
			description: 'Fine tune canvas, theme, and rendering preferences.',
			run: () => ui.openModal('settings')
		},
		{
			id: 'toggle-analysis',
			title: 'Toggle analysis panel',
			description: 'Open the analysis drawer for the active equation.',
			shortcut: 'Mod+Shift+A',
			run: () => (ui.activeAnalysisEquationId = ui.activeEquationId)
		},
		{
			id: 'open-regression',
			title: 'Open regression panel',
			description: 'Fit a model to the active data sheet.',
			shortcut: 'Mod+Shift+R',
			run: () => ui.openModal('regression')
		},
		{
			id: 'open-data',
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
			title: 'Toggle critical markers',
			description: 'Show or hide critical point markers.',
			shortcut: 'Mod+Shift+M',
			run: () => graph.updateSettings({ showCriticalPoints: !graph.settings.showCriticalPoints })
		},
		{
			id: 'toggle-intersections',
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
		<div class="topbar-brand" aria-hidden="true">
			<img src="/brand/icon.svg" alt="" width="18" height="18" />
			<span>Plotrix</span>
		</div>

		<div class="toolbar-cluster">
			<IconButton
				label={ui.sidebarOpen ? 'Hide panel' : 'Show panel'}
				size={36}
				onClick={() => ui.setSidebarOpen(!ui.sidebarOpen)}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					{#if ui.sidebarOpen}
						<path
							d="M7.25 4.75 12.5 10l-5.25 5.25M4 4.5h2.25v11H4z"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					{:else}
						<path
							d="M12.75 4.75 7.5 10l5.25 5.25M13.75 4.5H16v11h-2.25z"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					{/if}
				</svg>
			</IconButton>

			<IconButton label="Command" size={36} onClick={() => ui.setCommandPaletteOpen(true)}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M3.5 5.5h13v9h-13zM6.25 8.25l2 1.75-2 1.75M11 13h3"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.6"
					/>
				</svg>
			</IconButton>
		</div>

		<div class="toolbar-divider toolbar-divider-push" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton label="Undo" size={36} disabled={!canUndo} onClick={() => graph.undoHistory()}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M8 5.25 3.75 9.5 8 13.75M4.25 9.5h6.25a5 5 0 1 1 0 10"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</IconButton>

			<IconButton label="Redo" size={36} disabled={!canRedo} onClick={() => graph.redoHistory()}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="m12 5.25 4.25 4.25L12 13.75M15.75 9.5H9.5a5 5 0 1 0 0 10"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</IconButton>
		</div>

		<div class="toolbar-divider" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton label="Theme" size={36} onClick={toggleTheme}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M10 2.75v2.1M10 15.15v2.1M4.87 4.87l1.48 1.48M13.65 13.65l1.48 1.48M2.75 10h2.1M15.15 10h2.1M4.87 15.13l1.48-1.48M13.65 6.35l1.48-1.48"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-width="1.4"
					/>
					<path
						d="M12.5 4.2a6 6 0 1 0 3.3 10.3A6.3 6.3 0 0 1 12.5 4.2Z"
						fill="none"
						stroke="currentColor"
						stroke-linejoin="round"
						stroke-width="1.5"
					/>
				</svg>
			</IconButton>
		</div>

		<div class="toolbar-divider" aria-hidden="true"></div>

		<div class="toolbar-cluster">
			<IconButton label="Settings" size={36} onClick={() => ui.openModal('settings')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0-2 1.02 1.95 2.2.35.64 2.13 1.84 1.25-.72 2.1.72 2.1-1.84 1.25-.64 2.13-2.2.35L10 17.5l-1.02-1.95-2.2-.35-.64-2.13L4.3 11.82l.72-2.1-.72-2.1 1.84-1.25.64-2.13 2.2-.35Z"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.4"
					/>
				</svg>
			</IconButton>

			<IconButton label="Export" size={36} onClick={() => ui.openModal('export')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M10 3.5v8M6.75 8.5 10 11.75 13.25 8.5M4 14.5h12v2H4z"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</IconButton>

			<IconButton label="Share" size={36} onClick={openShareModal}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M8.25 10.75 11.75 9.25M8.25 9.25 11.75 10.75M14.5 6.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM5.5 12.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm9 6a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.6"
					/>
				</svg>
			</IconButton>
		</div>
	</header>

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
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path
									d="M10 4.5v11M4.5 10h11"
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-width="1.8"
								/>
							</svg>
							<span>Add</span>
						</button>

						<button
							type="button"
							class="compact-action compact-action-neutral"
							onclick={openImportDialog}
						>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path
									d="M10 3.5v8m0 0 2.75-2.75M10 11.5 7.25 8.75M4 13.75v1.75h12v-1.75"
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
								/>
							</svg>
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
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M4 13.75h12M5.5 11V7m4 4V5.5m4 5.5V8"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
							/>
						</svg>
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
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M4.5 4.5h11v11h-11zM4.5 8.5h11M8.5 4.5v11M12.5 4.5v11"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
							/>
						</svg>
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
									<svg viewBox="0 0 20 20" aria-hidden="true">
										<path
											d="M10 4.5v11M4.5 10h11"
											fill="none"
											stroke="currentColor"
											stroke-linecap="round"
											stroke-width="1.8"
										/>
									</svg>
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
				{#if ui.sidebarActiveTab === 'equations' && ui.selectedEquationIds.size === 2}
					<div class="sidebar-footer">
						<button
							type="button"
							class="compact-action compact-action-neutral shade-between"
							onclick={shadeBetweenSelected}
						>
							Shade between
						</button>
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
				<svg viewBox="0 0 20 20" aria-hidden="true" class:collapsed={!settingsSections.appearance}>
					<path
						d="m6 8 4 4 4-4"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</button>
			{#if settingsSections.appearance}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v2.25M10 14.75V17M4.75 4.75l1.5 1.5M13.75 13.75l1.5 1.5M3 10h2.25M14.75 10H17M4.75 15.25l1.5-1.5M13.75 6.25l1.5-1.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path d="M12.25 4.75a5.25 5.25 0 1 0 2.75 9 5.5 5.5 0 0 1-2.75-9Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/></svg>
						</div>
						<div class="setting-copy">
							<strong>Theme</strong>
						</div>
						<Select
							value={graph.settings.theme}
							options={themeOptions}
							ariaLabel="Theme"
							onChange={(value) => graph.updateSettings({ theme: value as typeof graph.settings.theme })}
						/>
					</div>

					<div class="setting-row">
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.5h3l2 7 2-7h3M4.5 13.5h3M12.5 13.5h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
							<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 3v3M10 14v3M3 10h3M14 10h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/></svg>
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
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5 14.5 10 10.75 10.75 10 14.5 6 4.5Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><circle cx="14.75" cy="5.25" r="1" fill="currentColor" stroke="none" /></svg>
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
				<svg viewBox="0 0 20 20" aria-hidden="true" class:collapsed={!settingsSections.grid}>
					<path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" />
				</svg>
			</button>
			{#if settingsSections.grid}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5h12M4 10h12M4 13.5h12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/></svg>
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

					<div class="setting-row setting-row-nested" class:is-disabled={!graph.settings.gridVisible}>
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5v11M14 4.5v11M3.5 7h13M3.5 13h13" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
							onChange={(value) => graph.updateSettings({ gridStyle: value as typeof graph.settings.gridStyle })}
						/>
					</div>

					<div class="setting-row setting-row-nested" class:is-disabled={!graph.settings.gridVisible}>
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6.5h.01M14 6.5h.01M6 13.5h.01M14 13.5h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>
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
				<svg viewBox="0 0 20 20" aria-hidden="true" class:collapsed={!settingsSections.analysis}>
					<path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" />
				</svg>
			</button>
			{#if settingsSections.analysis}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v8m0 0 2.75-2.75M10 11.5 7.25 8.75M4 13.75v1.75h12v-1.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
				<svg viewBox="0 0 20 20" aria-hidden="true" class:collapsed={!settingsSections.rendering}>
					<path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" />
				</svg>
			</button>
			{#if settingsSections.rendering}
				<div class="settings-category-body">
					<div class="setting-row">
						<div class="setting-row-icon">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.25a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-1.75v2M10 15.5v2M4.5 10h-2M17.5 10h-2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h9v8H4zM13 8.5l2.5-2.5M10.5 9.5l4 4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10a5.5 5.5 0 0 1 11 0M6.5 10a3.5 3.5 0 1 1 7 0M10 10l2.75-2.75" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>
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
	open={ui.modalOpen === 'regression'}
	title="Regression"
	onClose={() => ui.closeModal()}
>
	<RegressionPanel {graph} {ui} />
</Modal>

<Modal
	open={ui.modalOpen === 'export'}
	title="Export"
	onClose={() => ui.closeModal()}
>
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

<Modal
	open={ui.modalOpen === 'share'}
	title="Share"
	onClose={() => ui.closeModal()}
>
	<div class="share-stack">
		<input readonly value={shareUrl} />
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

<Modal
	open={ui.modalOpen === 'shortcuts'}
	title="Shortcuts"
	onClose={() => ui.closeModal()}
>
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
		overflow-x: auto;
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
		transition: grid-template-columns var(--duration-normal) var(--ease-default);
	}

	.workspace.sidebar-collapsed {
		grid-template-columns: 0 0 minmax(0, 1fr);
	}

	.sidebar {
		position: relative;
		z-index: var(--z-sidebar);
		min-height: 0;
		min-width: 0;
		overflow: hidden;
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

	.compact-action svg {
		width: 14px;
		height: 14px;
	}

	.compact-action-accent {
		border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		background: var(--color-accent-subtle);
		color: var(--color-accent);
	}

	.compact-action-neutral {
		border: 1px solid var(--color-border);
		background: var(--color-bg-overlay);
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

	.sidebar-tab svg {
		width: 16px;
		height: 16px;
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
		padding-right: var(--space-1);
	}

	.shade-between {
		justify-self: start;
	}

	.sidebar-footer {
		padding-top: var(--space-2);
		border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
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

	.settings-category-header h3 {
		font-size: var(--text-sm);
	}

	.settings-category-header p {
		margin-top: 2px;
		color: var(--color-text-secondary);
		font-size: var(--text-xs);
	}

	.settings-category-header svg {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		transition: transform var(--duration-fast) var(--ease-default);
	}

	.settings-category-header svg.collapsed {
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

	.setting-row-icon svg {
		width: 20px;
		height: 20px;
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
		grid-template-columns: repeat(2, minmax(0, 1fr));
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

	.share-stack input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-overlay);
		color: var(--color-text-primary);
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

	@media (max-width: 960px) {
		.settings-list {
			grid-template-columns: 1fr;
		}

		:global(body) {
			overflow: auto;
		}

		.page-shell {
			grid-template-rows: 48px auto;
			height: auto;
			min-height: 100svh;
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
