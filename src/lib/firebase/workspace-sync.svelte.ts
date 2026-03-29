import { browser } from '$app/environment';
import { getFirestore, type Firestore } from 'firebase/firestore';

import { firebaseSetup, getFirebaseApp } from '$lib/firebase/config';
import type { AuthUser } from '$lib/firebase/auth.svelte';
import {
	createWorkspacePayload,
	DEFAULT_WORKSPACE_NAME,
	hasMeaningfulWorkspaceContent,
	subscribeToWorkspace,
	writeWorkspacePayload,
	type WorkspaceRecord
} from '$lib/firebase/projects';
import type { GraphState } from '$stores/graph.svelte';
import type { UiState } from '$stores/ui.svelte';

const LOCAL_SESSION_KEY = 'plotrix-session-local';
const LOCAL_SESSION_LIMIT = 512_000;

type SyncStatus = 'disabled' | 'error' | 'idle' | 'loading' | 'local' | 'synced' | 'syncing';
type WorkspaceSource = 'cloud' | 'local';

function normalizeSyncError(error: unknown): string {
	if (error instanceof Error) {
		return error.message || 'Workspace sync failed.';
	}

	return 'Workspace sync failed.';
}

export function createWorkspaceSyncState(graph: GraphState, ui: UiState) {
	const state = $state({
		available: browser && firebaseSetup.configured,
		bootstrapped: false,
		configured: firebaseSetup.configured,
		error: null as string | null,
		lastSyncedAt: null as number | null,
		pendingWrite: false,
		projectName: DEFAULT_WORKSPACE_NAME,
		remoteExists: false,
		source: 'local' as WorkspaceSource,
		status: (firebaseSetup.configured ? 'idle' : 'disabled') as SyncStatus,
		userUid: null as string | null
	});

	let db: Firestore | null = null;
	let unsubscribeWorkspace: (() => void) | null = null;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	let lastRemoteRecord: WorkspaceRecord | null = null;
	let handlingRemote = false;
	let suppressNextPersist = false;
	let initialRemoteHandled = false;
	let ignoreInitialRemote = false;
	let currentUserUid: string | null = null;
	let pendingSharedSnapshot: string | null = null;

	function persistGuestBackup(): void {
		if (!browser) {
			return;
		}

		try {
			const snapshot = graph.exportJSON(false);

			if (snapshot.length <= LOCAL_SESSION_LIMIT) {
				localStorage.setItem(LOCAL_SESSION_KEY, snapshot);
			}
		} catch {
			// Ignore backup failures and continue into auth/session setup.
		}
	}

	function clearPendingTimer(): void {
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
	}

	function clearWorkspaceSubscription(): void {
		unsubscribeWorkspace?.();
		unsubscribeWorkspace = null;
		initialRemoteHandled = false;
	}

	function getDb(): Firestore | null {
		if (!browser) {
			return null;
		}

		const app = getFirebaseApp();

		if (!app) {
			return null;
		}

		db ??= getFirestore(app);
		return db;
	}

	function suppressPersistOnce(): void {
		suppressNextPersist = true;
	}

	async function importSnapshot(json: string, source: WorkspaceSource): Promise<boolean> {
		try {
			handlingRemote = source === 'cloud';
			suppressPersistOnce();
			await graph.importJSON(json, { commitHistory: false, resetHistory: true });
			state.bootstrapped = true;
			state.source = source;
			state.status = source === 'cloud' ? 'synced' : 'local';
			state.error = null;
			return true;
		} catch (error) {
			state.error = normalizeSyncError(error);
			state.status = 'error';
			return false;
		} finally {
			handlingRemote = false;
		}
	}

	async function restoreLocalWorkspace(sharedSnapshot: string | null): Promise<void> {
		clearPendingTimer();
		clearWorkspaceSubscription();
		lastRemoteRecord = null;
		currentUserUid = null;
		state.pendingWrite = false;
		state.remoteExists = false;
		state.userUid = null;
		state.projectName = DEFAULT_WORKSPACE_NAME;
		state.lastSyncedAt = null;

		if (sharedSnapshot) {
			if (await importSnapshot(sharedSnapshot, 'local')) {
				return;
			}

			ui.pushToast({
				title: 'Shared workspace skipped',
				description: 'The Plotrix share payload was invalid or exceeded the safe import limit.',
				tone: 'warning'
			});
		}

		const stored = localStorage.getItem(LOCAL_SESSION_KEY);

		if (stored && (await importSnapshot(stored, 'local'))) {
			return;
		}

		if (stored) {
			localStorage.removeItem(LOCAL_SESSION_KEY);
			ui.pushToast({
				title: 'Local workspace skipped',
				description: 'The saved local workspace was invalid and was cleared safely.',
				tone: 'warning'
			});
		}

		if (!graph.equations.length) {
			graph.seedStarterEquations();
			suppressPersistOnce();
		}

		state.bootstrapped = true;
		state.source = 'local';
		state.status = 'local';
		state.error = null;
	}

	async function applyRemoteRecord(record: WorkspaceRecord): Promise<void> {
		if (!record.snapshot) {
			return;
		}

		const imported = await importSnapshot(JSON.stringify(record.snapshot), 'cloud');

		if (!imported) {
			return;
		}

		lastRemoteRecord = record;
		state.lastSyncedAt = Date.now();
		state.remoteExists = true;
	}

	async function flushRemoteWrite(): Promise<void> {
		clearPendingTimer();

		if (!browser || !currentUserUid || handlingRemote) {
			state.pendingWrite = false;
			return;
		}

		const nextDb = getDb();

		if (!nextDb) {
			state.pendingWrite = false;
			state.status = 'error';
			state.error = 'Firebase Firestore is unavailable in this environment.';
			return;
		}

		const snapshot = graph.exportSnapshot();
		const payload = createWorkspacePayload(snapshot, currentUserUid, state.projectName);

		if (lastRemoteRecord?.flatHash === payload.flatHash) {
			state.pendingWrite = false;
			state.status = 'synced';
			state.lastSyncedAt = Date.now();
			return;
		}

		state.pendingWrite = true;
		state.status = 'syncing';

		try {
			const wrote = await writeWorkspacePayload(nextDb, currentUserUid, payload, lastRemoteRecord);
			state.pendingWrite = false;

			if (!wrote) {
				state.status = 'synced';
				state.lastSyncedAt = Date.now();
				return;
			}

			lastRemoteRecord = {
				exists: true,
				flatHash: payload.flatHash,
				hashes: payload.hashes,
				name: payload.meta.name,
				snapshot: payload.snapshot
			};
			state.status = 'synced';
			state.lastSyncedAt = Date.now();
			state.remoteExists = true;
		} catch (error) {
			state.pendingWrite = false;
			state.status = 'error';
			state.error = normalizeSyncError(error);
		}
	}

	function schedulePersist(delay = 900): void {
		if (!browser || !state.bootstrapped) {
			return;
		}

		if (suppressNextPersist) {
			suppressNextPersist = false;
			return;
		}

		if (handlingRemote) {
			return;
		}

		clearPendingTimer();
		state.pendingWrite = true;

		if (currentUserUid) {
			state.status = 'syncing';
			pendingTimer = setTimeout(() => {
				void flushRemoteWrite();
			}, delay);
			return;
		}

		pendingTimer = setTimeout(() => {
			try {
				const snapshot = graph.exportJSON(false);

				if (snapshot.length <= LOCAL_SESSION_LIMIT) {
					localStorage.setItem(LOCAL_SESSION_KEY, snapshot);
				}

				state.status = 'local';
				state.error = null;
			} catch (error) {
				state.status = 'error';
				state.error = normalizeSyncError(error);
			} finally {
				state.pendingWrite = false;
				pendingTimer = null;
			}
		}, 1200);
	}

	function attachRealtimeWorkspace(uid: string): void {
		const nextDb = getDb();

		if (!nextDb) {
			state.bootstrapped = true;
			state.pendingWrite = false;
			state.status = 'error';
			state.error = 'Firebase Firestore is unavailable in this environment.';
			return;
		}

		clearWorkspaceSubscription();

		unsubscribeWorkspace = subscribeToWorkspace(
			nextDb,
			uid,
			async (record) => {
				state.projectName = record.name;
				state.remoteExists = record.exists;

				if (!initialRemoteHandled) {
					initialRemoteHandled = true;
					lastRemoteRecord = record;

					if (ignoreInitialRemote) {
						ignoreInitialRemote = false;

						if (!record.snapshot) {
							state.bootstrapped = true;
							state.source = 'cloud';
							state.status = 'syncing';
							await flushRemoteWrite();
							return;
						}
					}

					if (pendingSharedSnapshot) {
						const shared = pendingSharedSnapshot;
						pendingSharedSnapshot = null;

						if (await importSnapshot(shared, 'cloud')) {
							await flushRemoteWrite();
							return;
						}

						ui.pushToast({
							title: 'Shared workspace skipped',
							description:
								'The Plotrix share payload could not be restored into the signed-in workspace.',
							tone: 'warning'
						});
					}

					if (record.snapshot) {
						await applyRemoteRecord(record);
						return;
					}

					if (!graph.equations.length) {
						graph.seedStarterEquations();
						suppressPersistOnce();
					}

					state.bootstrapped = true;
					state.source = 'cloud';
					state.status = 'syncing';
					await flushRemoteWrite();
					return;
				}

				const localPayload = createWorkspacePayload(
					graph.exportSnapshot(),
					currentUserUid ?? uid,
					state.projectName
				);

				lastRemoteRecord = record;

				if (!record.snapshot || record.flatHash === localPayload.flatHash) {
					state.pendingWrite = false;
					state.status = 'synced';
					if (record.snapshot) {
						state.lastSyncedAt = Date.now();
					}
					return;
				}

				await applyRemoteRecord(record);
			},
			(error) => {
				state.pendingWrite = false;
				state.status = 'error';
				state.error = normalizeSyncError(error);
			}
		);
	}

	async function configureSession(
		user: AuthUser | null,
		options: {
			preferCurrentGraph?: boolean;
			sharedSnapshot?: string | null;
		} = {}
	): Promise<void> {
		if (!browser) {
			return;
		}

		state.error = null;
		pendingSharedSnapshot = options.sharedSnapshot ?? null;

		if (!user) {
			await restoreLocalWorkspace(options.sharedSnapshot ?? null);
			return;
		}

		if (!currentUserUid && hasMeaningfulWorkspaceContent(graph.exportSnapshot())) {
			persistGuestBackup();
		}

		currentUserUid = user.uid;
		state.userUid = user.uid;
		state.source = 'cloud';
		state.status = 'loading';
		state.bootstrapped = false;
		state.pendingWrite = false;
		state.lastSyncedAt = null;
		ignoreInitialRemote = Boolean(options.preferCurrentGraph);

		if (options.preferCurrentGraph && hasMeaningfulWorkspaceContent(graph.exportSnapshot())) {
			state.bootstrapped = true;
			state.status = 'syncing';
		}

		attachRealtimeWorkspace(user.uid);
	}

	function destroy(): void {
		clearPendingTimer();
		clearWorkspaceSubscription();
		currentUserUid = null;
		pendingSharedSnapshot = null;
	}

	return Object.assign(state, {
		configureSession,
		destroy,
		schedulePersist
	});
}

export type WorkspaceSyncState = ReturnType<typeof createWorkspaceSyncState>;
