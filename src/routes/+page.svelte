<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	import CommandPalette, { type CommandAction } from '$components/CommandPalette.svelte';
	import EquationCard from '$components/EquationCard.svelte';
	import GraphCanvas from '$components/GraphCanvas.svelte';
	import IconButton from '$components/IconButton.svelte';
	import Modal from '$components/Modal.svelte';
	import Select from '$components/Select.svelte';
	import ToastViewport from '$components/ToastViewport.svelte';
	import Toggle from '$components/Toggle.svelte';
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

	const shortcuts = [
		['Pan', 'Drag or use arrow keys'],
		['Zoom', 'Mouse wheel, pinch, +, -'],
		['Reset view', '0'],
		['Fit all', 'F'],
		['New equation', formatShortcut('Mod+E')],
		['Undo / redo', `${formatShortcut('Mod+Z')} / ${formatShortcut('Mod+Shift+Z')}`],
		['Command palette', formatShortcut('Mod+K')]
	] as const;

	let importInput: HTMLInputElement | null = null;
	let shareUrl = $state('');
	let resizingSidebar = $state(false);

	const canUndo = $derived(graph.historyIndex > 0);
	const canRedo = $derived(graph.historyIndex < graph.historySize - 1);
	const equationCount = $derived(graph.equations.length);
	const visibleCount = $derived(graph.equations.filter((equation) => equation.visible).length);

	function addEquation(raw = ''): void {
		const equation = graph.addEquation(raw);
		ui.activeEquationId = equation.id;
		ui.sidebarOpen = true;
	}

	function setActiveEquation(id: string): void {
		ui.activeEquationId = id;
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

	async function handleImport(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];

		if (!file) {
			return;
		}

		try {
			graph.importJSON(await file.text());
			ui.activeEquationId = graph.equations[0]?.id ?? null;
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

		try {
			if (hash.startsWith('#plotrix=')) {
				graph.importJSON(hash);
			} else {
				const stored = localStorage.getItem('plotrix-session');

				if (stored) {
					graph.importJSON(stored);
				}
			}
		} catch {
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

		graph.renderVersion;
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

<div class="page-shell">
	<header class="topbar">
		<div class="toolbar-cluster">
			<IconButton label={ui.sidebarOpen ? 'Hide panel' : 'Show panel'} size={36} onClick={() => (ui.sidebarOpen = !ui.sidebarOpen)}>
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

			<IconButton label="Command" size={36} onClick={() => (ui.commandPaletteOpen = true)}>
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

	<div class="workspace" style={`--sidebar-width: ${graph.settings.equationPanelWidth}px`}>
		<button
			type="button"
			class:shown={ui.sidebarOpen}
			class="mobile-overlay"
			aria-label="Close sidebar"
			onclick={() => (ui.sidebarOpen = false)}
		></button>

		<aside class:open={ui.sidebarOpen} class="sidebar">
			<section class="sidebar-panel">
				<header class="sidebar-header">
					<div class="brand-lockup">
						<div class="brand-mark">
							<img src="/brand/icon.svg" alt="" />
						</div>
						<div>
							<p class="brand-title">Plotrix</p>
							<p class="brand-subtitle">{equationCount} equations</p>
						</div>
					</div>

					<div class="sidebar-actions">
						<button type="button" class="compact-action compact-action-accent" onclick={() => addEquation('')}>
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

						<button type="button" class="compact-action compact-action-neutral" onclick={openImportDialog}>
							<span>Import</span>
						</button>
					</div>
				</header>

				<div class="panel-stats">
					<div>
						<strong>{visibleCount}</strong>
						<span>Visible</span>
					</div>
					<div>
						<strong>{graph.settings.gridStyle}</strong>
						<span>Grid</span>
					</div>
					<div>
						<strong>{resolveTheme(graph.settings.theme)}</strong>
						<span>Theme</span>
					</div>
				</div>

				<div class="equation-list">
					{#if graph.equations.length}
						{#each graph.equations as equation, index (equation.id)}
							<EquationCard {graph} {ui} {equation} {index} onActivate={setActiveEquation} />
						{/each}
					{:else}
						<div class="empty-state">
							<p>No equations yet.</p>
							<button type="button" class="compact-action compact-action-accent" onclick={() => addEquation('')}>
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
				</div>
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

<Modal
	open={ui.modalOpen === 'settings'}
	title="Settings"
	description="Tune the viewport, theme, and rendering defaults."
	onClose={() => ui.closeModal()}
>
	<div class="settings-list">
		<div class="setting-row">
			<div class="setting-copy">
				<strong>Theme</strong>
				<p>Choose how Plotrix resolves light and dark surfaces.</p>
			</div>
			<Select
				value={graph.settings.theme}
				options={themeOptions}
				ariaLabel="Theme"
				onChange={(value) =>
					graph.updateSettings({
						theme: value as typeof graph.settings.theme
					})}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Grid style</strong>
				<p>Switch between cartesian and polar scaffolding.</p>
			</div>
			<Select
				value={graph.settings.gridStyle}
				options={gridStyleOptions}
				ariaLabel="Grid style"
				onChange={(value) =>
					graph.updateSettings({
						gridStyle: value as typeof graph.settings.gridStyle
					})}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Grid</strong>
				<p>Show or hide the graph grid entirely.</p>
			</div>
			<Toggle
				label="Grid visibility"
				checked={graph.settings.gridVisible}
				onChange={(checked) => graph.updateSettings({ gridVisible: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Minor grid</strong>
				<p>Render sub-divisions between major grid intervals.</p>
			</div>
			<Toggle
				label="Minor grid"
				checked={graph.settings.minorGridVisible}
				onChange={(checked) => graph.updateSettings({ minorGridVisible: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Axis labels</strong>
				<p>Display numeric tick labels along the axes.</p>
			</div>
			<Toggle
				label="Axis labels"
				checked={graph.settings.axisLabelsVisible}
				onChange={(checked) => graph.updateSettings({ axisLabelsVisible: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Crosshair</strong>
				<p>Show a pointer-aligned coordinate crosshair over the canvas.</p>
			</div>
			<Toggle
				label="Crosshair overlay"
				checked={graph.settings.crosshairVisible}
				onChange={(checked) => graph.updateSettings({ crosshairVisible: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Trace mode</strong>
				<p>Snap to the nearest visible curve while hovering.</p>
			</div>
			<Toggle
				label="Trace mode"
				checked={graph.settings.traceMode}
				onChange={(checked) => graph.updateSettings({ traceMode: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Render timings</strong>
				<p>Expose per-curve render durations in the equation cards.</p>
			</div>
			<Toggle
				label="Render timings"
				checked={graph.settings.showRenderTime}
				onChange={(checked) => graph.updateSettings({ showRenderTime: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>HiDPI rendering</strong>
				<p>Use device pixel ratio scaling for sharper output.</p>
			</div>
			<Toggle
				label="HiDPI rendering"
				checked={graph.settings.highDPI}
				onChange={(checked) => graph.updateSettings({ highDPI: checked })}
			/>
		</div>

		<div class="setting-row">
			<div class="setting-copy">
				<strong>Antialiasing</strong>
				<p>Smooth curves and axes when rasterizing the graph.</p>
			</div>
			<Toggle
				label="Antialiasing"
				checked={graph.settings.antialiasing}
				onChange={(checked) => graph.updateSettings({ antialiasing: checked })}
			/>
		</div>
	</div>
</Modal>

<Modal
	open={ui.modalOpen === 'export'}
	title="Export"
	description="Choose a delivery format for the current graph."
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
	description="Create a self-contained URL for the current graph state."
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
	description="Keyboard controls for navigating the graph faster."
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
	onClose={() => (ui.commandPaletteOpen = false)}
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
		grid-template-columns: var(--sidebar-width) 8px minmax(0, 1fr);
		min-height: 0;
		padding: var(--space-3);
		gap: var(--space-3);
	}

	.sidebar {
		position: relative;
		z-index: var(--z-sidebar);
		min-height: 0;
	}

	.sidebar-panel {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		gap: var(--space-4);
		height: 100%;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-2xl) + 2px);
		background: color-mix(in srgb, var(--color-bg-surface) 94%, transparent);
		box-shadow: var(--shadow-lg);
		backdrop-filter: blur(14px);
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

	.brand-subtitle {
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

	.panel-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-3);
	}

	.panel-stats div {
		display: grid;
		gap: 2px;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-base);
	}

	.panel-stats strong {
		font-size: var(--text-base);
		text-transform: capitalize;
	}

	.panel-stats span {
		font-size: var(--text-xs);
		color: var(--color-text-secondary);
	}

	.equation-list {
		display: grid;
		align-content: start;
		gap: var(--space-3);
		min-height: 0;
		overflow: auto;
		padding-right: var(--space-1);
	}

	.empty-state {
		display: grid;
		justify-items: start;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-base) 80%, transparent);
		color: var(--color-text-secondary);
	}

	.sidebar-resizer {
		width: 8px;
		border-radius: var(--radius-full);
		background: transparent;
		cursor: col-resize;
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
		gap: var(--space-4);
	}

	.setting-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-xl);
		background: var(--color-bg-base);
	}

	.setting-copy {
		display: grid;
		gap: 4px;
	}

	.setting-copy strong {
		font-size: var(--text-base);
	}

	.setting-copy p {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
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
		:global(body) {
			overflow: auto;
		}

		.page-shell {
			grid-template-rows: 48px auto;
			height: auto;
			min-height: 100svh;
		}

		.topbar {
			overflow-x: auto;
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
		.panel-stats,
		.export-grid,
		.settings-list,
		.setting-row {
			grid-template-columns: 1fr;
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
