import { browser } from '$app/environment';
import { getFirestore, type Firestore } from 'firebase/firestore';

import { firebaseSetup, getFirebaseApp } from '$lib/firebase/config';
import type { AuthUser } from '$lib/firebase/auth.svelte';
import {
	createWorkspacePayload,
	DEFAULT_WORKSPACE_NAME,
	hasMeaningfulWorkspaceContent,
	setWorkspacePublic,
	subscribeToWorkspace,
	writeWorkspacePayload,
	type WorkspaceRecord
} from '$lib/firebase/projects';
import type { GraphState } from '$stores/graph.svelte';
import type { UiState } from '$stores/ui.svelte';

const LOCAL_SESSION_KEY = 'plotrix-session-local';
const LOCAL_SESSION_TOUCHED_KEY = 'plotrix-session-local-touched';
const LOCAL_SESSION_LIMIT = 512_000;
const THUMBNAIL_DATA_URL_LIMIT = 64 * 1024;

type SyncStatus = 'disabled' | 'error' | 'idle' | 'loading' | 'local' | 'synced' | 'syncing';
type WorkspaceSource = 'cloud' | 'local';

function normalizeSyncError(error: unknown): string {
	if (error instanceof Error) {
		if (/missing or insufficient permissions/i.test(error.message)) {
			return 'Sync paused because Firestore rejected this workspace request.';
		}

		return error.message || 'Workspace sync failed.';
	}

	return 'Workspace sync failed.';
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			if (typeof reader.result === 'string') {
				resolve(reader.result);
				return;
			}

			reject(new Error('Unable to read the workspace thumbnail.'));
		};
		reader.onerror = () =>
			reject(reader.error ?? new Error('Unable to read the workspace thumbnail.'));
		reader.readAsDataURL(blob);
	});
}

export function createWorkspaceSyncState(graph: GraphState, ui: UiState) {
	const state = $state({
		available: browser && firebaseSetup.configured,
		bootstrapped: false,
		configured: firebaseSetup.configured,
		error: null as string | null,
		isPublic: false,
		lastSyncedAt: null as number | null,
		pendingWrite: false,
		projectName: DEFAULT_WORKSPACE_NAME,
		remoteExists: false,
		source: 'local' as WorkspaceSource,
		status: (firebaseSetup.configured ? 'idle' : 'disabled') as SyncStatus,
		userUid: null as string | null,
		workspaceId: 'default'
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
	let currentWorkspaceId = 'default';
	let pendingSharedSnapshot: string | null = null;
	let queuedRemoteRecord: WorkspaceRecord | null = null;
	let lastThumbnailEquationHash = '';
	let lastThumbnailDataUrl: string | null = null;
	const handleOnline = () => {
		if (state.pendingWrite && currentUserUid) {
			void flushRemoteWrite();
			return;
		}

		void maybeApplyQueuedRemoteRecord();
	};

	if (browser) {
		window.addEventListener('online', handleOnline);
	}

	function persistGuestBackup(): void {
		if (!browser) {
			return;
		}

		try {
			const snapshot = graph.exportJSON(false);

			if (snapshot.length <= LOCAL_SESSION_LIMIT) {
				localStorage.setItem(LOCAL_SESSION_KEY, snapshot);
				localStorage.setItem(LOCAL_SESSION_TOUCHED_KEY, '1');
			}
		} catch {
			// Ignore backup failures and continue into auth/session setup.
		}
	}

	function hasLocalWorkspaceBeenTouched(): boolean {
		if (!browser) {
			return false;
		}

		return localStorage.getItem(LOCAL_SESSION_TOUCHED_KEY) === '1';
	}

	function markLocalWorkspaceTouched(): void {
		if (!browser) {
			return;
		}

		localStorage.setItem(LOCAL_SESSION_TOUCHED_KEY, '1');
	}

	function buildThumbnailEquationHash(snapshot: ReturnType<typeof graph.exportSnapshot>): string {
		return snapshot.equations
			.map(
				(equation) =>
					`${equation.id}:${equation.raw}:${equation.kind}:${equation.color}:${equation.lineWidth}:${equation.lineStyle}:${equation.opacity}:${equation.visible}:${equation.label}:${equation.showMarkers}:${equation.paramRange[0]}:${equation.paramRange[1]}:${equation.condition ?? ''}`
			)
			.join('|');
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
		queuedRemoteRecord = null;
	}

	function hasFocusedEditableElement(): boolean {
		if (!browser) {
			return false;
		}

		const active = document.activeElement as HTMLElement | null;

		if (!active) {
			return false;
		}

		return (
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement ||
			active.isContentEditable ||
			Boolean(active.closest('[contenteditable="true"]'))
		);
	}

	function shouldDeferSyncActivity(): boolean {
		return ui.isPanningOrZooming || hasFocusedEditableElement();
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
			if (source === 'local') {
				markLocalWorkspaceTouched();
			}
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
		state.isPublic = false;
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
			if (hasLocalWorkspaceBeenTouched()) {
				state.bootstrapped = true;
				state.source = 'local';
				state.status = 'local';
				state.error = null;
				return;
			}

			graph.seedStarterEquations();
			suppressPersistOnce();
			markLocalWorkspaceTouched();
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
		state.isPublic = record.isPublic;
		state.remoteExists = true;
	}

	async function maybeApplyQueuedRemoteRecord(): Promise<void> {
		if (!queuedRemoteRecord || shouldDeferSyncActivity() || state.pendingWrite) {
			return;
		}

		const record = queuedRemoteRecord;
		queuedRemoteRecord = null;

		if (!record.snapshot) {
			lastRemoteRecord = record;
			return;
		}

		const localPayload = createWorkspacePayload(
			graph.exportSnapshot(),
			currentUserUid ?? 'local',
			state.projectName,
			state.isPublic
		);

		if (record.flatHash === localPayload.flatHash) {
			lastRemoteRecord = record;
			state.pendingWrite = false;
			state.status = 'synced';
			state.lastSyncedAt = Date.now();
			return;
		}

		await applyRemoteRecord(record);
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
		const payload = createWorkspacePayload(
			snapshot,
			currentUserUid,
			state.projectName,
			state.isPublic
		);

		if (lastRemoteRecord?.flatHash === payload.flatHash) {
			state.pendingWrite = false;
			state.status = 'synced';
			state.lastSyncedAt = Date.now();
			return;
		}

		state.pendingWrite = true;
		state.status = 'syncing';

		if (!navigator.onLine) {
			state.error = null;
			return;
		}

		if (shouldDeferSyncActivity()) {
			pendingTimer = setTimeout(() => {
				void flushRemoteWrite();
			}, 700);
			return;
		}

		try {
			const thumbnailEquationHash = buildThumbnailEquationHash(snapshot);
			let thumbnailDataUrl = lastThumbnailDataUrl;

			if (graph.backgroundImages.length > 0) {
				thumbnailDataUrl = null;
				lastThumbnailDataUrl = null;
				lastThumbnailEquationHash = '';
			} else if (thumbnailEquationHash !== lastThumbnailEquationHash) {
				const thumbnailBlob = await graph.exportPNG(1);
				thumbnailDataUrl =
					thumbnailBlob && thumbnailBlob.size <= THUMBNAIL_DATA_URL_LIMIT
						? await blobToDataUrl(thumbnailBlob).catch(() => null)
						: null;
				lastThumbnailEquationHash = thumbnailEquationHash;
				lastThumbnailDataUrl =
					thumbnailDataUrl && thumbnailDataUrl.length <= THUMBNAIL_DATA_URL_LIMIT
						? thumbnailDataUrl
						: null;
			}
			const wrote = await writeWorkspacePayload(
				nextDb,
				currentUserUid,
				payload,
				lastRemoteRecord,
				currentWorkspaceId,
				{
					thumbnailDataUrl:
						thumbnailDataUrl && thumbnailDataUrl.length <= THUMBNAIL_DATA_URL_LIMIT
							? thumbnailDataUrl
							: null
				}
			);
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
				isPublic: payload.meta.isPublic,
				name: payload.meta.name,
				snapshot: payload.snapshot
			};
			state.status = 'synced';
			state.lastSyncedAt = Date.now();
			state.remoteExists = true;
			await maybeApplyQueuedRemoteRecord();
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
		const snapshotJson = currentUserUid ? null : graph.exportJSON(false);

		if (currentUserUid) {
			state.status = 'syncing';
			pendingTimer = setTimeout(
				() => {
					void flushRemoteWrite();
				},
				shouldDeferSyncActivity() ? Math.max(delay, 1400) : delay
			);
			return;
		}

		pendingTimer = setTimeout(() => {
			try {
				if (snapshotJson && snapshotJson.length <= LOCAL_SESSION_LIMIT) {
					localStorage.setItem(LOCAL_SESSION_KEY, snapshotJson);
					localStorage.setItem(LOCAL_SESSION_TOUCHED_KEY, '1');
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
				state.isPublic = record.isPublic;
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
					state.projectName,
					state.isPublic
				);

				lastRemoteRecord = record;

				if (!record.snapshot || record.flatHash === localPayload.flatHash) {
					queuedRemoteRecord = null;
					state.pendingWrite = false;
					state.status = 'synced';
					if (record.snapshot) {
						state.lastSyncedAt = Date.now();
					}
					return;
				}

				if (shouldDeferSyncActivity() || state.pendingWrite) {
					queuedRemoteRecord = record;
					return;
				}

				await applyRemoteRecord(record);
			},
			(error) => {
				state.pendingWrite = false;
				state.status = 'error';
				state.error = normalizeSyncError(error);
			},
			currentWorkspaceId
		);
	}

	async function configureSession(
		user: AuthUser | null,
		options: {
			preferCurrentGraph?: boolean;
			sharedSnapshot?: string | null;
			workspaceId?: string;
		} = {}
	): Promise<void> {
		if (!browser) {
			return;
		}

		state.error = null;
		pendingSharedSnapshot = options.sharedSnapshot ?? null;
		currentWorkspaceId = options.workspaceId?.trim() || 'default';
		state.workspaceId = currentWorkspaceId;
		queuedRemoteRecord = null;

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
		currentWorkspaceId = 'default';
		pendingSharedSnapshot = null;
		if (browser) {
			window.removeEventListener('online', handleOnline);
		}
	}

	return Object.assign(state, {
		configureSession,
		async setPublic(nextValue: boolean) {
			const nextDb = getDb();

			if (!nextDb || !currentUserUid) {
				return;
			}

			await setWorkspacePublic(nextDb, currentUserUid, currentWorkspaceId, nextValue);
			state.isPublic = nextValue;
			if (lastRemoteRecord) {
				lastRemoteRecord = {
					...lastRemoteRecord,
					isPublic: nextValue
				};
			}
		},
		destroy,
		schedulePersist
	});
}

export type WorkspaceSyncState = ReturnType<typeof createWorkspaceSyncState>;
