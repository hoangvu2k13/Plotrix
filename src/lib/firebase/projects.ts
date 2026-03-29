import {
	collection,
	doc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	writeBatch,
	type CollectionReference,
	type DocumentData,
	type Firestore
} from 'firebase/firestore';

import type { GraphSnapshot } from '$stores/graph.svelte';

export const DEFAULT_WORKSPACE_NAME = 'My Plotrix Workspace';
export const DEFAULT_WORKSPACE_ID = 'default';

export interface WorkspaceMetaDoc {
	name: string;
	ownerUid: string;
	schemaVersion: 1;
}

export interface WorkspaceStateDoc {
	annotations: GraphSnapshot['annotations'];
	regressionResults: GraphSnapshot['regressionResults'];
	settings: GraphSnapshot['settings'];
	variables: GraphSnapshot['variables'];
	version: 2;
	view: GraphSnapshot['view'];
}

export interface WorkspaceEquationDoc {
	color: string;
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

export interface WorkspaceRecord {
	exists: boolean;
	flatHash: string;
	hashes: WorkspaceHashes | null;
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
	name = DEFAULT_WORKSPACE_NAME
): WorkspacePayload {
	const state: WorkspaceStateDoc = {
		annotations: snapshot.annotations.map((annotation) => ({ ...annotation })),
		regressionResults: snapshot.regressionResults.map((result) => ({
			...result,
			coefficients: [...result.coefficients],
			metrics: { ...result.metrics },
			...(result.metadata ? { metadata: { ...result.metadata } } : {})
		})),
		settings: { ...snapshot.settings },
		variables: snapshot.variables.map((variable) => ({ ...variable })),
		version: 2,
		view: { ...snapshot.view }
	};

	const equations = new Map<string, WorkspaceEquationDoc>();

	for (const [index, equation] of snapshot.equations.entries()) {
		equations.set(equation.id, {
			color: equation.color,
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
			name,
			ownerUid: uid,
			schemaVersion: 1
		},
		snapshot,
		state
	};
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
				paramRange: [...data.paramRange] as [number, number]
			})),
		view: state?.view ?? {
			originX: 0,
			originY: 0,
			scaleX: 72,
			scaleY: 72
		},
		settings: (state?.settings ?? {}) as GraphSnapshot['settings'],
		variables: state?.variables ?? [],
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
				? createWorkspacePayload(snapshot, meta.ownerUid, meta.name)
				: snapshot
					? createWorkspacePayload(snapshot, uid, meta?.name ?? DEFAULT_WORKSPACE_NAME)
					: null;

		onRecord({
			exists: snapshot !== null,
			flatHash: payload?.flatHash ?? '',
			hashes: payload?.hashes ?? null,
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
	workspaceId = DEFAULT_WORKSPACE_ID
): Promise<boolean> {
	const refs = workspaceRefs(db, uid, workspaceId);
	let changed = false;
	const batch = writeBatch(db);

	const metaDoc: Record<string, unknown> = {
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
	await batch.commit();
	return true;
}
