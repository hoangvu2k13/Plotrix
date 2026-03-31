import {
	arrayUnion,
	collectionGroup,
	collection,
	deleteField,
	documentId,
	doc,
	getDoc,
	getDocs,
	limit,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	where,
	writeBatch,
	type CollectionReference,
	type DocumentData,
	type Firestore,
	type Timestamp
} from 'firebase/firestore';
import { nanoid } from 'nanoid';

import type { GraphSnapshot } from '$stores/graph.svelte';

export const DEFAULT_WORKSPACE_NAME = 'My Plotrix Workspace';
export const DEFAULT_WORKSPACE_ID = 'default';

export interface WorkspaceMetaDoc {
	createdAt?: Timestamp;
	isPublic: boolean;
	name: string;
	ownerUid: string;
	schemaVersion: 1;
	updatedAt?: Timestamp;
}

interface UserWorkspaceDirectoryItemDoc {
	createdAt: number;
	equationCount: number;
	name: string;
	thumbnailDataUrl?: string;
	updatedAt: number;
}

interface UserWorkspaceDirectoryDoc {
	defaultWorkspaceId: string;
	workspaceIds: string[];
	workspaces?: Record<string, UserWorkspaceDirectoryItemDoc>;
}

export interface WorkspaceListEntry {
	createdAt: number;
	equationCount: number;
	id: string;
	name: string;
	thumbnailDataUrl?: string;
	updatedAt: number;
}

export interface WorkspaceStateDoc {
	annotations: GraphSnapshot['annotations'];
	constrainedPoints: GraphSnapshot['constrainedPoints'];
	folders: GraphSnapshot['folders'];
	integralShadings: GraphSnapshot['integralShadings'];
	regressionResults: GraphSnapshot['regressionResults'];
	settings: GraphSnapshot['settings'];
	tangentLines: GraphSnapshot['tangentLines'];
	variables: GraphSnapshot['variables'];
	version: 2;
	view: GraphSnapshot['view'];
}

export interface WorkspaceEquationDoc {
	color: string;
	condition: string | null;
	index: number;
	kind: GraphSnapshot['equations'][number]['kind'];
	label: string;
	lineStyle: GraphSnapshot['equations'][number]['lineStyle'];
	lineWidth: number;
	opacity: number;
	paramRange: [number, number];
	raw: string;
	showMarkers: boolean;
	visible: boolean;
}

export interface WorkspaceDataSeriesDoc {
	columns: GraphSnapshot['dataSeries'][number]['columns'];
	index: number;
	name: string;
	plotted: boolean;
	rows: Array<{ values: string[] }>;
	style: GraphSnapshot['dataSeries'][number]['style'];
	visible: boolean;
}

export interface WorkspaceHashes {
	dataSeries: Map<string, string>;
	equations: Map<string, string>;
	state: string;
}

export interface WorkspacePayload {
	dataSeries: Map<string, WorkspaceDataSeriesDoc>;
	equations: Map<string, WorkspaceEquationDoc>;
	flatHash: string;
	hashes: WorkspaceHashes;
	meta: WorkspaceMetaDoc;
	snapshot: GraphSnapshot;
	state: WorkspaceStateDoc;
}

interface WorkspaceDirectoryWriteOptions {
	thumbnailDataUrl?: string | null;
}

export interface WorkspaceRecord {
	exists: boolean;
	flatHash: string;
	hashes: WorkspaceHashes | null;
	isPublic: boolean;
	name: string;
	snapshot: GraphSnapshot | null;
}

type WorkspaceDocEntry<T> = {
	data: T;
	id: string;
};

function serializeSeriesRows(
	rows: GraphSnapshot['dataSeries'][number]['rows']
): Array<{ values: string[] }> {
	return rows.map((row) => ({
		values: [...row]
	}));
}

function deserializeSeriesRows(
	rows: WorkspaceDataSeriesDoc['rows'] | GraphSnapshot['dataSeries'][number]['rows'] | unknown
): GraphSnapshot['dataSeries'][number]['rows'] {
	if (!Array.isArray(rows)) {
		return [];
	}

	return rows.map((row) => {
		if (Array.isArray(row)) {
			return row.map((cell) => (typeof cell === 'string' ? cell : ''));
		}

		if (row && typeof row === 'object' && Array.isArray((row as { values?: unknown }).values)) {
			return (row as { values: unknown[] }).values.map((cell) =>
				typeof cell === 'string' ? cell : ''
			);
		}

		return [];
	});
}

function stableStringify(value: unknown): string {
	return JSON.stringify(value);
}

function flattenHashes(hashes: WorkspaceHashes): string {
	const equationHash = [...hashes.equations.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, hash]) => `${id}:${hash}`)
		.join('|');
	const dataSeriesHash = [...hashes.dataSeries.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, hash]) => `${id}:${hash}`)
		.join('|');

	return [hashes.state, equationHash, dataSeriesHash].join('~');
}

function timestampToMillis(value: unknown): number | null {
	if (
		value &&
		typeof value === 'object' &&
		'toMillis' in value &&
		typeof value.toMillis === 'function'
	) {
		return value.toMillis();
	}

	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeWorkspaceName(name: string, fallback = DEFAULT_WORKSPACE_NAME): string {
	const trimmed = name.trim();
	return (trimmed || fallback).slice(0, 80);
}

function normalizeWorkspaceListEntry(
	id: string,
	value: unknown,
	fallbackName = DEFAULT_WORKSPACE_NAME
): WorkspaceListEntry | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const entry = value as Partial<UserWorkspaceDirectoryItemDoc>;
	const name =
		typeof entry.name === 'string' ? sanitizeWorkspaceName(entry.name, fallbackName) : fallbackName;
	const createdAt = timestampToMillis(entry.createdAt) ?? Date.now();
	const updatedAt = timestampToMillis(entry.updatedAt) ?? createdAt;
	const equationCount =
		typeof entry.equationCount === 'number' && Number.isFinite(entry.equationCount)
			? Math.max(0, Math.floor(entry.equationCount))
			: 0;

	return {
		id,
		name,
		createdAt,
		updatedAt,
		equationCount,
		...(typeof entry.thumbnailDataUrl === 'string' && entry.thumbnailDataUrl.length
			? { thumbnailDataUrl: entry.thumbnailDataUrl }
			: {})
	};
}

function normalizeWorkspaceDirectory(value: unknown): UserWorkspaceDirectoryDoc {
	if (!value || typeof value !== 'object') {
		return {
			defaultWorkspaceId: DEFAULT_WORKSPACE_ID,
			workspaceIds: [],
			workspaces: {}
		};
	}

	const doc = value as Partial<UserWorkspaceDirectoryDoc>;
	const workspaceIds = Array.isArray(doc.workspaceIds)
		? doc.workspaceIds.filter((entry): entry is string => typeof entry === 'string')
		: [];
	const workspaces =
		doc.workspaces && typeof doc.workspaces === 'object'
			? Object.fromEntries(
					Object.entries(doc.workspaces)
						.map(([id, entry]) => [id, normalizeWorkspaceListEntry(id, entry)])
						.filter((entry): entry is [string, WorkspaceListEntry] => entry[1] !== null)
						.map(([id, entry]) => [
							id,
							{
								name: entry.name,
								createdAt: entry.createdAt,
								updatedAt: entry.updatedAt,
								equationCount: entry.equationCount,
								...(entry.thumbnailDataUrl ? { thumbnailDataUrl: entry.thumbnailDataUrl } : {})
							}
						])
				)
			: {};

	return {
		defaultWorkspaceId:
			typeof doc.defaultWorkspaceId === 'string' && doc.defaultWorkspaceId.length
				? doc.defaultWorkspaceId
				: (workspaceIds[0] ?? DEFAULT_WORKSPACE_ID),
		workspaceIds,
		workspaces
	};
}

function workspaceDirectoryRef(db: Firestore, uid: string) {
	return doc(db, 'users', uid);
}

function workspaceRefs(db: Firestore, uid: string, workspaceId = DEFAULT_WORKSPACE_ID) {
	const projectDoc = doc(db, 'users', uid, 'projects', workspaceId);

	return {
		dataSeries: collection(projectDoc, 'dataSeries') as CollectionReference<DocumentData>,
		equations: collection(projectDoc, 'equations') as CollectionReference<DocumentData>,
		meta: projectDoc,
		state: doc(projectDoc, 'state', 'main')
	};
}

export function hasMeaningfulWorkspaceContent(snapshot: GraphSnapshot): boolean {
	return (
		snapshot.equations.length > 0 ||
		snapshot.annotations.length > 0 ||
		snapshot.regressionResults.length > 0 ||
		snapshot.dataSeries.some(
			(series) =>
				series.plotted || series.rows.some((row) => row.some((cell) => cell.trim().length > 0))
		)
	);
}

export function createWorkspacePayload(
	snapshot: GraphSnapshot,
	uid: string,
	name = DEFAULT_WORKSPACE_NAME,
	isPublic = false
): WorkspacePayload {
	const state: WorkspaceStateDoc = {
		annotations: snapshot.annotations.map((annotation) => ({ ...annotation })),
		constrainedPoints: snapshot.constrainedPoints.map((point) => ({ ...point })),
		folders: snapshot.folders.map((folder) => ({
			...folder,
			equationIds: [...folder.equationIds]
		})),
		integralShadings: snapshot.integralShadings.map((shading) => ({ ...shading })),
		regressionResults: snapshot.regressionResults.map((result) => ({
			...result,
			coefficients: [...result.coefficients],
			metrics: { ...result.metrics },
			...(result.metadata ? { metadata: { ...result.metadata } } : {})
		})),
		settings: { ...snapshot.settings },
		tangentLines: snapshot.tangentLines.map((tangent) => ({ ...tangent })),
		variables: snapshot.variables.map((variable) => ({ ...variable })),
		version: 2,
		view: { ...snapshot.view }
	};

	const equations = new Map<string, WorkspaceEquationDoc>();

	for (const [index, equation] of snapshot.equations.entries()) {
		equations.set(equation.id, {
			color: equation.color,
			condition: equation.condition,
			index,
			kind: equation.kind,
			label: equation.label,
			lineStyle: equation.lineStyle,
			lineWidth: equation.lineWidth,
			opacity: equation.opacity,
			paramRange: [...equation.paramRange] as [number, number],
			raw: equation.raw,
			showMarkers: equation.showMarkers,
			visible: equation.visible
		});
	}

	const dataSeries = new Map<string, WorkspaceDataSeriesDoc>();

	for (const [index, series] of snapshot.dataSeries.entries()) {
		dataSeries.set(series.id, {
			columns: series.columns.map((column) => ({ ...column })),
			index,
			name: series.name,
			plotted: series.plotted,
			rows: serializeSeriesRows(series.rows),
			style: { ...series.style },
			visible: series.visible
		});
	}

	const hashes: WorkspaceHashes = {
		dataSeries: new Map(
			[...dataSeries.entries()].map(([id, entry]) => [id, stableStringify(entry)])
		),
		equations: new Map([...equations.entries()].map(([id, entry]) => [id, stableStringify(entry)])),
		state: stableStringify(state)
	};

	return {
		dataSeries,
		equations,
		flatHash: flattenHashes(hashes),
		hashes,
		meta: {
			isPublic,
			name,
			ownerUid: uid,
			schemaVersion: 1
		},
		snapshot,
		state
	};
}

function sortWorkspaceList(entries: WorkspaceListEntry[]): WorkspaceListEntry[] {
	return [...entries].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function listUserWorkspaces(
	db: Firestore,
	uid: string
): Promise<WorkspaceListEntry[]> {
	const directorySnapshot = await getDoc(workspaceDirectoryRef(db, uid));
	const directory = normalizeWorkspaceDirectory(directorySnapshot.data());
	const fromDirectory = directory.workspaceIds
		.map((id) => normalizeWorkspaceListEntry(id, directory.workspaces?.[id]))
		.filter((entry): entry is WorkspaceListEntry => entry !== null);

	if (fromDirectory.length) {
		return sortWorkspaceList(fromDirectory);
	}

	const metaSnapshot = await getDocs(
		query(collection(workspaceDirectoryRef(db, uid), 'projects'), orderBy('updatedAt', 'desc'))
	);

	return metaSnapshot.docs.map((entry) => {
		const data = entry.data() as WorkspaceMetaDoc;
		const createdAt = timestampToMillis(data.createdAt) ?? Date.now();
		const updatedAt = timestampToMillis(data.updatedAt) ?? createdAt;

		return {
			id: entry.id,
			name: sanitizeWorkspaceName(data.name),
			createdAt,
			updatedAt,
			equationCount: 0
		};
	});
}

export async function createWorkspace(db: Firestore, uid: string, name: string): Promise<string> {
	const workspaceId = nanoid();
	const safeName = sanitizeWorkspaceName(name, 'Untitled');
	const now = Date.now();
	const userRef = workspaceDirectoryRef(db, uid);
	const directory = normalizeWorkspaceDirectory((await getDoc(userRef)).data());
	const defaultWorkspaceId =
		directory.workspaceIds.length === 0 ? workspaceId : directory.defaultWorkspaceId || workspaceId;
	const nextWorkspaceIds = Array.from(new Set([...directory.workspaceIds, workspaceId]));
	const refs = workspaceRefs(db, uid, workspaceId);
	const batch = writeBatch(db);

	batch.set(
		userRef,
		{
			defaultWorkspaceId,
			workspaceIds: nextWorkspaceIds,
			workspaces: {
				[workspaceId]: {
					name: safeName,
					createdAt: now,
					updatedAt: now,
					equationCount: 0
				}
			}
		},
		{ merge: true }
	);
	batch.set(
		refs.meta,
		{
			isPublic: false,
			name: safeName,
			ownerUid: uid,
			schemaVersion: 1,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
	await batch.commit();
	return workspaceId;
}

export async function renameWorkspace(
	db: Firestore,
	uid: string,
	workspaceId: string,
	name: string
): Promise<void> {
	const safeName = sanitizeWorkspaceName(name);
	const refs = workspaceRefs(db, uid, workspaceId);
	const batch = writeBatch(db);

	batch.set(refs.meta, { name: safeName, updatedAt: serverTimestamp() }, { merge: true });
	batch.set(
		workspaceDirectoryRef(db, uid),
		{
			workspaces: {
				[workspaceId]: {
					name: safeName,
					updatedAt: Date.now()
				}
			}
		},
		{ merge: true }
	);

	await batch.commit();
}

export async function deleteWorkspace(
	db: Firestore,
	uid: string,
	workspaceId: string
): Promise<void> {
	const userRef = workspaceDirectoryRef(db, uid);
	const refs = workspaceRefs(db, uid, workspaceId);
	const [directorySnapshot, equationsSnapshot, dataSeriesSnapshot] = await Promise.all([
		getDoc(userRef),
		getDocs(refs.equations),
		getDocs(refs.dataSeries)
	]);
	const directory = normalizeWorkspaceDirectory(directorySnapshot.data());
	const remainingWorkspaceIds = directory.workspaceIds.filter((entry) => entry !== workspaceId);
	const nextDefaultWorkspaceId =
		directory.defaultWorkspaceId === workspaceId
			? (remainingWorkspaceIds[0] ?? DEFAULT_WORKSPACE_ID)
			: directory.defaultWorkspaceId || remainingWorkspaceIds[0] || DEFAULT_WORKSPACE_ID;
	const batch = writeBatch(db);

	for (const entry of equationsSnapshot.docs) {
		batch.delete(entry.ref);
	}

	for (const entry of dataSeriesSnapshot.docs) {
		batch.delete(entry.ref);
	}

	batch.delete(refs.state);
	batch.delete(refs.meta);
	batch.set(
		userRef,
		{
			defaultWorkspaceId: nextDefaultWorkspaceId,
			workspaceIds: remainingWorkspaceIds
		},
		{ merge: true }
	);

	if (directorySnapshot.exists()) {
		batch.update(userRef, {
			[`workspaces.${workspaceId}`]: deleteField()
		});
	}

	await batch.commit();
}

export async function loadWorkspaceRecord(
	db: Firestore,
	uid: string,
	workspaceId = DEFAULT_WORKSPACE_ID
): Promise<WorkspaceRecord> {
	const refs = workspaceRefs(db, uid, workspaceId);
	const [metaSnapshot, stateSnapshot, equationsSnapshot, dataSeriesSnapshot] = await Promise.all([
		getDoc(refs.meta),
		getDoc(refs.state),
		getDocs(query(refs.equations, orderBy('index', 'asc'))),
		getDocs(query(refs.dataSeries, orderBy('index', 'asc')))
	]);
	const meta = metaSnapshot.exists() ? (metaSnapshot.data() as WorkspaceMetaDoc) : null;
	const state = stateSnapshot.exists() ? (stateSnapshot.data() as WorkspaceStateDoc) : null;
	const equations = equationsSnapshot.docs.map((entry) => ({
		id: entry.id,
		data: entry.data() as WorkspaceEquationDoc
	}));
	const dataSeries = dataSeriesSnapshot.docs.map((entry) => ({
		id: entry.id,
		data: entry.data() as WorkspaceDataSeriesDoc
	}));
	const snapshot = buildWorkspaceSnapshot(state, equations, dataSeries);
	const payload =
		snapshot && meta
			? createWorkspacePayload(snapshot, meta.ownerUid, meta.name, meta.isPublic)
			: snapshot
				? createWorkspacePayload(snapshot, uid, meta?.name ?? DEFAULT_WORKSPACE_NAME, false)
				: null;

	return {
		exists: snapshot !== null,
		flatHash: payload?.flatHash ?? '',
		hashes: payload?.hashes ?? null,
		isPublic: Boolean(meta?.isPublic ?? false),
		name: sanitizeWorkspaceName(meta?.name ?? DEFAULT_WORKSPACE_NAME),
		snapshot
	};
}

export async function duplicateWorkspace(
	db: Firestore,
	uid: string,
	sourceWorkspaceId: string,
	name: string
): Promise<string> {
	const source = await loadWorkspaceRecord(db, uid, sourceWorkspaceId);
	const workspaceId = await createWorkspace(db, uid, name);

	if (!source.snapshot) {
		return workspaceId;
	}

	const payload = createWorkspacePayload(source.snapshot, uid, name, source.isPublic);
	await writeWorkspacePayload(db, uid, payload, null, workspaceId);
	return workspaceId;
}

export async function setWorkspacePublic(
	db: Firestore,
	uid: string,
	workspaceId: string,
	isPublic: boolean
): Promise<void> {
	await writeBatch(db)
		.set(
			workspaceRefs(db, uid, workspaceId).meta,
			{
				isPublic,
				updatedAt: serverTimestamp()
			},
			{ merge: true }
		)
		.commit();
}

export async function loadPublicWorkspaceRecord(
	db: Firestore,
	workspaceId: string
): Promise<WorkspaceRecord> {
	const publicMetaSnapshot = await getDocs(
		query(
			collectionGroup(db, 'projects'),
			where(documentId(), '==', workspaceId),
			where('isPublic', '==', true),
			limit(1)
		)
	);
	const publicMeta = publicMetaSnapshot.docs[0];

	if (!publicMeta) {
		return {
			exists: false,
			flatHash: '',
			hashes: null,
			isPublic: false,
			name: DEFAULT_WORKSPACE_NAME,
			snapshot: null
		};
	}

	if (publicMeta.data()?.isPublic !== true) {
		return {
			exists: false,
			flatHash: '',
			hashes: null,
			isPublic: false,
			name: DEFAULT_WORKSPACE_NAME,
			snapshot: null
		};
	}

	const [, uid] = publicMeta.ref.path.split('/');

	if (!uid) {
		return {
			exists: false,
			flatHash: '',
			hashes: null,
			isPublic: false,
			name: DEFAULT_WORKSPACE_NAME,
			snapshot: null
		};
	}

	return loadWorkspaceRecord(db, uid, workspaceId);
}

function buildWorkspaceSnapshot(
	state: WorkspaceStateDoc | null,
	equations: Array<WorkspaceDocEntry<WorkspaceEquationDoc>>,
	dataSeries: Array<WorkspaceDocEntry<WorkspaceDataSeriesDoc>>
): GraphSnapshot | null {
	if (!state && equations.length === 0 && dataSeries.length === 0) {
		return null;
	}

	return {
		version: 2,
		equations: equations
			.sort((left, right) => left.data.index - right.data.index)
			.map(({ data, id }) => ({
				id,
				raw: data.raw,
				kind: data.kind,
				color: data.color,
				lineWidth: data.lineWidth,
				lineStyle: data.lineStyle,
				opacity: data.opacity,
				visible: data.visible,
				label: data.label,
				showMarkers: data.showMarkers,
				paramRange: [...data.paramRange] as [number, number],
				condition: typeof data.condition === 'string' ? data.condition : null
			})),
		view: state?.view ?? {
			originX: 0,
			originY: 0,
			scaleX: 72,
			scaleY: 72
		},
		settings: (state?.settings ?? {}) as GraphSnapshot['settings'],
		variables: state?.variables ?? [],
		tangentLines: state?.tangentLines ?? [],
		integralShadings: state?.integralShadings ?? [],
		constrainedPoints: state?.constrainedPoints ?? [],
		folders: state?.folders ?? [],
		dataSeries: dataSeries
			.sort((left, right) => left.data.index - right.data.index)
			.map(({ data, id }) => ({
				id,
				name: data.name,
				columns: data.columns.map((column) => ({ ...column })),
				rows: deserializeSeriesRows(data.rows),
				style: { ...data.style },
				visible: data.visible,
				plotted: data.plotted
			})),
		regressionResults: state?.regressionResults ?? [],
		annotations: state?.annotations ?? []
	};
}

export function subscribeToWorkspace(
	db: Firestore,
	uid: string,
	onRecord: (record: WorkspaceRecord) => void,
	onError: (error: unknown) => void,
	workspaceId = DEFAULT_WORKSPACE_ID
): () => void {
	const refs = workspaceRefs(db, uid, workspaceId);
	let meta: WorkspaceMetaDoc | null = null;
	let state: WorkspaceStateDoc | null = null;
	let equations: Array<WorkspaceDocEntry<WorkspaceEquationDoc>> = [];
	let dataSeries: Array<WorkspaceDocEntry<WorkspaceDataSeriesDoc>> = [];
	const ready = {
		dataSeries: false,
		equations: false,
		meta: false,
		state: false
	};

	const emit = (): void => {
		if (!ready.meta || !ready.state || !ready.equations || !ready.dataSeries) {
			return;
		}

		const snapshot = buildWorkspaceSnapshot(state, equations, dataSeries);
		const payload =
			snapshot && meta
				? createWorkspacePayload(snapshot, meta.ownerUid, meta.name, meta.isPublic)
				: snapshot
					? createWorkspacePayload(snapshot, uid, meta?.name ?? DEFAULT_WORKSPACE_NAME, false)
					: null;

		onRecord({
			exists: snapshot !== null,
			flatHash: payload?.flatHash ?? '',
			hashes: payload?.hashes ?? null,
			isPublic: Boolean(meta?.isPublic ?? false),
			name: meta?.name ?? DEFAULT_WORKSPACE_NAME,
			snapshot
		});
	};

	const unsubscribeMeta = onSnapshot(
		refs.meta,
		(snapshot) => {
			meta = snapshot.exists() ? (snapshot.data() as WorkspaceMetaDoc) : null;
			ready.meta = true;
			emit();
		},
		onError
	);

	const unsubscribeState = onSnapshot(
		refs.state,
		(snapshot) => {
			state = snapshot.exists() ? (snapshot.data() as WorkspaceStateDoc) : null;
			ready.state = true;
			emit();
		},
		onError
	);

	const unsubscribeEquations = onSnapshot(
		query(refs.equations, orderBy('index', 'asc')),
		(snapshot) => {
			equations = snapshot.docs.map((entry) => ({
				data: entry.data() as WorkspaceEquationDoc,
				id: entry.id
			}));
			ready.equations = true;
			emit();
		},
		onError
	);

	const unsubscribeDataSeries = onSnapshot(
		query(refs.dataSeries, orderBy('index', 'asc')),
		(snapshot) => {
			dataSeries = snapshot.docs.map((entry) => ({
				data: entry.data() as WorkspaceDataSeriesDoc,
				id: entry.id
			}));
			ready.dataSeries = true;
			emit();
		},
		onError
	);

	return () => {
		unsubscribeMeta();
		unsubscribeState();
		unsubscribeEquations();
		unsubscribeDataSeries();
	};
}

export async function writeWorkspacePayload(
	db: Firestore,
	uid: string,
	payload: WorkspacePayload,
	previous: WorkspaceRecord | null,
	workspaceId = DEFAULT_WORKSPACE_ID,
	options: WorkspaceDirectoryWriteOptions = {}
): Promise<boolean> {
	const refs = workspaceRefs(db, uid, workspaceId);
	let changed = false;
	const batch = writeBatch(db);

	const metaDoc: Record<string, unknown> = {
		isPublic: payload.meta.isPublic,
		name: payload.meta.name,
		ownerUid: payload.meta.ownerUid,
		schemaVersion: payload.meta.schemaVersion,
		updatedAt: serverTimestamp()
	};

	if (!previous?.exists) {
		metaDoc.createdAt = serverTimestamp();
	}

	const previousHashes = previous?.hashes;
	const stateChanged = !previousHashes || previousHashes.state !== payload.hashes.state;

	if (stateChanged) {
		changed = true;
		batch.set(refs.state, { ...payload.state, updatedAt: serverTimestamp() }, { merge: true });
	}

	for (const [id, entry] of payload.equations) {
		const nextHash = payload.hashes.equations.get(id);
		const previousHash = previousHashes?.equations.get(id);

		if (nextHash === previousHash) {
			continue;
		}

		changed = true;
		batch.set(doc(refs.equations, id), { ...entry, updatedAt: serverTimestamp() });
	}

	for (const id of previousHashes?.equations.keys() ?? []) {
		if (payload.equations.has(id)) {
			continue;
		}

		changed = true;
		batch.delete(doc(refs.equations, id));
	}

	for (const [id, entry] of payload.dataSeries) {
		const nextHash = payload.hashes.dataSeries.get(id);
		const previousHash = previousHashes?.dataSeries.get(id);

		if (nextHash === previousHash) {
			continue;
		}

		changed = true;
		batch.set(doc(refs.dataSeries, id), { ...entry, updatedAt: serverTimestamp() });
	}

	for (const id of previousHashes?.dataSeries.keys() ?? []) {
		if (payload.dataSeries.has(id)) {
			continue;
		}

		changed = true;
		batch.delete(doc(refs.dataSeries, id));
	}

	if (!changed) {
		return false;
	}

	batch.set(refs.meta, metaDoc, { merge: true });
	batch.set(
		workspaceDirectoryRef(db, uid),
		{
			workspaceIds: arrayUnion(workspaceId),
			workspaces: {
				[workspaceId]: {
					name: sanitizeWorkspaceName(payload.meta.name),
					updatedAt: Date.now(),
					equationCount: payload.snapshot.equations.length,
					...(options.thumbnailDataUrl ? { thumbnailDataUrl: options.thumbnailDataUrl } : {}),
					...(!previous?.exists ? { createdAt: Date.now() } : {})
				}
			}
		},
		{ merge: true }
	);
	await batch.commit();
	return true;
}
