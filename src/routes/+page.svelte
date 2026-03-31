<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import {
		Copy,
		FolderOpen,
		LayoutPanelLeft,
		LoaderCircle,
		Plus,
		Pencil,
		Settings2,
		Sparkles,
		SunMoon,
		Trash2
	} from '@lucide/svelte';
	import { getFirestore, type Firestore } from 'firebase/firestore';
	import { onDestroy, onMount } from 'svelte';

	import AuthPanel from '$components/AuthPanel.svelte';
	import Icon from '$components/Icon.svelte';
	import { authState } from '$lib/firebase/auth.svelte';
	import { firebaseSetup, getFirebaseApp } from '$lib/firebase/config';
	import {
		createWorkspace,
		deleteWorkspace,
		duplicateWorkspace,
		listUserWorkspaces,
		renameWorkspace,
		type WorkspaceListEntry
	} from '$lib/firebase/projects';
	import type { WorkspaceSyncState } from '$lib/firebase/workspace-sync.svelte';
	import { nextTheme, resolveTheme } from '$utils/theme';

	const dashboardSyncState = $state({
		available: browser && firebaseSetup.configured,
		bootstrapped: true,
		configured: firebaseSetup.configured,
		error: null as string | null,
		isPublic: false,
		lastSyncedAt: null as number | null,
		pendingWrite: false,
		projectName: 'Workspace',
		remoteExists: false,
		source: 'local' as const,
		status: 'local' as const,
		userUid: null as string | null,
		workspaceId: 'default'
	});
	const dashboardSync = Object.assign(dashboardSyncState, {
		async configureSession() {},
		async setPublic() {},
		destroy() {},
		schedulePersist() {}
	}) as WorkspaceSyncState;

	const dateFormatter = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	let workspaces = $state<WorkspaceListEntry[]>([]);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let editingWorkspaceId = $state<string | null>(null);
	let busyWorkspaceId = $state<string | null>(null);
	let creatingWorkspace = $state(false);
	let currentTheme = $state<'system' | 'light' | 'dark'>('system');

	const totalEquationCount = $derived.by(() =>
		workspaces.reduce((sum, workspace) => sum + workspace.equationCount, 0)
	);
	const lastUpdatedWorkspace = $derived.by(() =>
		workspaces.length
			? ([...workspaces].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null)
			: null
	);

	function getDb(): Firestore | null {
		if (!browser) {
			return null;
		}

		const app = getFirebaseApp();
		return app ? getFirestore(app) : null;
	}

	async function refreshWorkspaces(): Promise<void> {
		const user = authState.user;
		const db = getDb();

		if (!user || !db) {
			workspaces = [];
			loading = false;
			return;
		}

		loading = true;
		errorMessage = null;

		try {
			workspaces = await listUserWorkspaces(db, user.uid);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Couldn't load your workspaces. Try again.";
		} finally {
			loading = false;
		}
	}

	function applyTheme(theme: 'system' | 'light' | 'dark'): void {
		currentTheme = theme;

		if (!browser) {
			return;
		}

		localStorage.setItem('plotrix-theme', theme);
		const resolved = resolveTheme(theme);
		document.documentElement.dataset.theme = resolved;
		document.documentElement.style.colorScheme = resolved;
	}

	function cycleTheme(): void {
		applyTheme(nextTheme(currentTheme));
	}

	async function openWorkspace(id: string): Promise<void> {
		await goto(resolve('/workspace/[id]', { id }));
	}

	async function createNewWorkspace(): Promise<void> {
		const user = authState.user;
		const db = getDb();

		if (!user || !db || creatingWorkspace) {
			return;
		}

		creatingWorkspace = true;
		errorMessage = null;

		try {
			const id = await createWorkspace(db, user.uid, 'Untitled');
			await goto(resolve('/workspace/[id]', { id }));
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Couldn't create a workspace. Try again.";
			creatingWorkspace = false;
		}
	}

	async function duplicateExistingWorkspace(entry: WorkspaceListEntry): Promise<void> {
		const user = authState.user;
		const db = getDb();

		if (!user || !db) {
			return;
		}

		busyWorkspaceId = entry.id;
		errorMessage = null;

		try {
			const id = await duplicateWorkspace(db, user.uid, entry.id, `${entry.name} Copy`);
			await goto(resolve('/workspace/[id]', { id }));
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Couldn't duplicate this workspace. Try again.";
			busyWorkspaceId = null;
		}
	}

	async function removeWorkspace(entry: WorkspaceListEntry): Promise<void> {
		const user = authState.user;
		const db = getDb();

		if (!user || !db) {
			return;
		}

		if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
			return;
		}

		busyWorkspaceId = entry.id;
		errorMessage = null;

		try {
			await deleteWorkspace(db, user.uid, entry.id);
			await refreshWorkspaces();
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Couldn't delete this workspace. Try again.";
		} finally {
			busyWorkspaceId = null;
		}
	}

	function startRename(entry: WorkspaceListEntry, event: MouseEvent): void {
		editingWorkspaceId = entry.id;
		requestAnimationFrame(() => {
			const target =
				(event.currentTarget as HTMLElement | null) ??
				document.querySelector<HTMLElement>(`[data-workspace-title="${entry.id}"]`);
			target?.focus();
			const selection = window.getSelection();
			if (!selection || !target) {
				return;
			}

			const range = document.createRange();
			range.selectNodeContents(target);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		});
	}

	function triggerRename(entry: WorkspaceListEntry): void {
		startRename(entry, new MouseEvent('dblclick'));
	}

	async function commitRename(entry: WorkspaceListEntry, element: HTMLElement): Promise<void> {
		const user = authState.user;
		const db = getDb();

		editingWorkspaceId = null;

		if (!user || !db) {
			element.textContent = entry.name;
			return;
		}

		const nextName = element.textContent?.trim() || entry.name;

		if (nextName === entry.name) {
			element.textContent = entry.name;
			return;
		}

		busyWorkspaceId = entry.id;
		errorMessage = null;

		try {
			await renameWorkspace(db, user.uid, entry.id, nextName);
			await refreshWorkspaces();
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : "Couldn't rename this workspace. Try again.";
			element.textContent = entry.name;
		} finally {
			busyWorkspaceId = null;
		}
	}

	onMount(() => {
		if (browser) {
			const savedTheme = localStorage.getItem('plotrix-theme');

			if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') {
				currentTheme = savedTheme;
			}
		}

		void authState.initialize();
	});

	onDestroy(() => {
		authState.destroy();
	});

	$effect(() => {
		dashboardSync.available = authState.available;
		dashboardSync.configured = authState.configured;
		dashboardSync.userUid = authState.user?.uid ?? null;
	});

	$effect(() => {
		if (!browser || !authState.initialized) {
			return;
		}

		if (!authState.user) {
			workspaces = [];
			loading = false;
			return;
		}

		void refreshWorkspaces();
	});
</script>

<svelte:head>
	<title>Plotrix Workspaces</title>
</svelte:head>

<div class="dashboard-shell">
	<div class="dashboard-layout">
		<aside class="dashboard-sidebar">
			<div class="dashboard-sidebar-brand">
				<div class="dashboard-sidebar-mark">
					<img src="/brand/icon.svg" alt="" width="18" height="18" />
				</div>
				<div>
					<strong>Workspaces</strong>
				</div>
			</div>

			<section class="dashboard-sidebar-section">
				<button
					type="button"
					class="dashboard-sidebar-action dashboard-sidebar-action-primary"
					disabled={!authState.user || creatingWorkspace}
					onclick={() => void createNewWorkspace()}
				>
					<Icon icon={Plus} size="var(--icon-md)" class="inline-icon" />
					<span>{creatingWorkspace ? 'Creating workspace…' : 'New workspace'}</span>
				</button>
				<button
					type="button"
					class="dashboard-sidebar-action"
					onclick={() => goto(resolve('/workspace/[id]', { id: 'default' }))}
				>
					<Icon icon={FolderOpen} size="var(--icon-md)" class="inline-icon" />
					<span>Continue as guest</span>
				</button>
				<button type="button" class="dashboard-sidebar-action" onclick={cycleTheme}>
					<Icon icon={SunMoon} size="var(--icon-md)" class="inline-icon" />
					<span
						>Theme: {currentTheme === 'system'
							? 'System'
							: currentTheme === 'light'
								? 'Light'
								: 'Dark'}</span
					>
				</button>
			</section>

			<section class="dashboard-sidebar-section">
				<div class="dashboard-stat-list">
					<div class="dashboard-stat-card">
						<span>Workspaces</span>
						<strong>{authState.user ? workspaces.length : 1}</strong>
					</div>
					<div class="dashboard-stat-card">
						<span>Equations</span>
						<strong>{authState.user ? totalEquationCount : 'Local only'}</strong>
					</div>
				</div>
			</section>

			<section class="dashboard-sidebar-section dashboard-sidebar-note">
				{#if authState.user}
					<strong>{authState.user.displayName || authState.user.email}</strong>
					<p>
						{#if lastUpdatedWorkspace}
							Last opened: {lastUpdatedWorkspace.name}
						{:else}
							Your account is ready for synced workspaces.
						{/if}
					</p>
				{:else}
					<strong>Guest mode</strong>
					<p>Sign in to unlock multiple workspaces, duplication, thumbnails, and synced history.</p>
				{/if}
			</section>
		</aside>

		<main class="dashboard-main">
			<header class="dashboard-header dashboard-header-shell">
				<div>
					<h1>Every graph you've ever built, one click away.</h1>
					<p class="dashboard-copy">
						Create, rename, duplicate, or pick up where you left off. Workspaces sync
						automatically when you're signed in.
					</p>
				</div>
				<div class="dashboard-header-tools">
					<button
						type="button"
						class="dashboard-open-guest"
						onclick={() => goto(resolve('/workspace/[id]', { id: 'default' }))}
					>
						<Icon icon={FolderOpen} size="var(--icon-md)" class="inline-icon" />
						<span>Continue as guest</span>
					</button>
				</div>
			</header>

			{#if !authState.initialized || (authState.loading && authState.pendingAction === 'bootstrap')}
				<div class="dashboard-empty">
					<Icon icon={LoaderCircle} size="var(--icon-lg)" class="inline-icon spin-icon" />
					<p>Loading account…</p>
				</div>
			{:else if !authState.user}
				<section class="dashboard-guest">
					<div class="dashboard-hero-card">
						<div class="dashboard-hero-copy">
							<p class="dashboard-eyebrow">Account features</p>
							<strong>Sign in to unlock multi-workspace management.</strong>
							<p>
								Guest mode still gives you the full graph editor. Account mode adds synced project
								lists, duplication, workspace previews, and portable sessions.
							</p>
						</div>
						<div class="dashboard-hero-grid">
							<div class="dashboard-hero-tile">
								<Icon icon={LayoutPanelLeft} size="var(--icon-md)" class="inline-icon" />
								<span>Workspace dashboard</span>
							</div>
							<div class="dashboard-hero-tile">
								<Icon icon={Sparkles} size="var(--icon-md)" class="inline-icon" />
								<span>Realtime sync</span>
							</div>
							<div class="dashboard-hero-tile">
								<Icon icon={Settings2} size="var(--icon-md)" class="inline-icon" />
								<span>Project controls</span>
							</div>
						</div>
					</div>
					<AuthPanel auth={authState} sync={dashboardSync} />
				</section>
			{:else}
				{#if errorMessage}
					<p class="dashboard-error" role="alert">{errorMessage}</p>
				{/if}

				<div class="workspace-grid">
					<button
						type="button"
						class="workspace-card workspace-card-new"
						disabled={creatingWorkspace}
						onclick={createNewWorkspace}
					>
						<div class="workspace-thumb workspace-thumb-new">
							<Icon icon={Plus} size="var(--icon-xl)" class="inline-icon" />
						</div>
						<div class="workspace-card-copy">
							<strong>{creatingWorkspace ? 'Creating…' : 'New workspace'}</strong>
							<p>Blank canvas. Synced the moment you name it.</p>
						</div>
					</button>

					{#if loading}
						<div class="workspace-card workspace-card-placeholder">
							<div class="workspace-thumb workspace-thumb-placeholder"></div>
							<div class="workspace-card-copy">
								<strong>Loading workspaces…</strong>
								<p>Loading your workspaces.</p>
							</div>
						</div>
					{:else}
						{#each workspaces as workspace (workspace.id)}
							<article class="workspace-card">
								<button
									type="button"
									class="workspace-thumb-button"
									aria-label={`Open ${workspace.name}`}
									onclick={() => openWorkspace(workspace.id)}
								>
									{#if workspace.thumbnailDataUrl}
										<img
											class="workspace-thumb-image"
											src={workspace.thumbnailDataUrl}
											alt=""
											loading="lazy"
										/>
									{:else}
										<div class="workspace-thumb workspace-thumb-fallback">
											<span>{workspace.equationCount} equations</span>
										</div>
									{/if}
								</button>

								<div class="workspace-card-copy">
									<h2
										data-workspace-title={workspace.id}
										contenteditable={editingWorkspaceId === workspace.id}
										spellcheck="false"
										role={editingWorkspaceId === workspace.id ? 'textbox' : undefined}
										onblur={(event) =>
											void commitRename(workspace, event.currentTarget as HTMLElement)}
										onkeydown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												(event.currentTarget as HTMLElement).blur();
											}
										}}
										ondblclick={(event) => startRename(workspace, event)}
									>
										{workspace.name}
									</h2>
									<p>
										{dateFormatter.format(workspace.createdAt)} · {`${workspace.equationCount} equation${workspace.equationCount === 1 ? '' : 's'}`}
									</p>
								</div>

								<div class="workspace-card-actions">
									<button type="button" onclick={() => openWorkspace(workspace.id)}>
										<Icon icon={FolderOpen} size="var(--icon-sm)" class="inline-icon" />
										<span>Open</span>
									</button>
									<button
										type="button"
										disabled={busyWorkspaceId === workspace.id}
										onclick={() => triggerRename(workspace)}
									>
										<Icon icon={Pencil} size="var(--icon-sm)" class="inline-icon" />
										<span>Rename</span>
									</button>
									<button
										type="button"
										disabled={busyWorkspaceId === workspace.id}
										onclick={() => void duplicateExistingWorkspace(workspace)}
									>
										<Icon icon={Copy} size="var(--icon-sm)" class="inline-icon" />
										<span>Duplicate</span>
									</button>
									<button
										type="button"
										disabled={busyWorkspaceId === workspace.id}
										onclick={() => void removeWorkspace(workspace)}
									>
										<Icon icon={Trash2} size="var(--icon-sm)" class="inline-icon" />
										<span>Delete</span>
									</button>
								</div>
							</article>
						{/each}
					{/if}
				</div>
			{/if}
		</main>
	</div>
</div>
