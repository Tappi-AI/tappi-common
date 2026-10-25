/**
 * Runtime resolution of the signed-in user's LatticeCast storage.
 *
 * LatticeCast is the single source of truth and storage is per user: every
 * account owns a `tappi` workspace holding its own copy of each app table, so
 * column ids are runtime values — only the account's own schema knows them, and
 * a first login has nothing to read. This module provisions whatever is missing,
 * idempotently: concurrent callers share one resolution (otherwise each would
 * see the columns as absent and create duplicates) and a re-run creates nothing.
 */
import { apiFetch, apiJson, LatticeCastError } from '../http.js';

export interface ColumnDefinition {
	name: string;
	type: string;
	options?: unknown;
}

/** Everything the resolver needs: which table, and what it has to hold. */
export interface TableContract {
	workspaceName: string;
	tableName: string;
	/** Columns the table must have. Missing ones are created. */
	columns?: readonly ColumnDefinition[];
	/** Readable noun used in failure copy ("bracelet", "photo album", ...). */
	noun: string;
	/**
	 * Create a missing workspace/table instead of failing. Default true; a
	 * read-only surface (a customer's wheel, a review page) sets false and gets
	 * `TableMissingError` until the owning surface has provisioned it.
	 */
	create?: boolean;
}

/** A table the caller can read and write, with this user's own column ids. */
export type TableId = string | number;

export interface ResolvedTable {
	workspaceId: string;
	tableId: TableId;
	columns: Record<string, string>;
}

export interface TableRow {
	row_id: number;
	row_data: Record<string, unknown>;
}

/** Which part of a read-only contract is not provisioned. */
export type MissingStage = 'workspace' | 'table' | 'columns';

/** The account has no provisioned storage for a read-only contract. */
export class TableMissingError extends Error {
	readonly stage: MissingStage;
	/** Column names the table is missing (only for `stage: 'columns'`). */
	readonly missing: readonly string[];
	readonly workspaceName: string;
	readonly tableName: string;

	constructor(
		message: string,
		missing: { stage: MissingStage; workspaceName: string; tableName: string; columns?: readonly string[] }
	) {
		super(message);
		this.name = 'TableMissingError';
		this.stage = missing.stage;
		this.missing = missing.columns ?? [];
		this.workspaceName = missing.workspaceName;
		this.tableName = missing.tableName;
	}
}

interface WorkspaceSummary {
	workspace_id: string;
	workspace_name: string;
}

interface TableSummary {
	table_id: TableId;
	/** LC 0.80+ returns this; older deployments use the string table_id as the name. */
	table_name?: string;
	workspace_id: string;
}

interface ColumnSummary {
	name: string;
	column_id: string;
}

const workspaces = new Map<string, string>();
const workspaceInflight = new Map<string, Promise<string>>();
const tables = new Map<string, ResolvedTable>();
const provisioned = new Map<string, Set<string>>();
const tableInflight = new Map<string, Promise<ResolvedTable>>();

function tableKey(contract: TableContract): string {
	return `${contract.workspaceName}\u0000${contract.tableName}`;
}

/** Drop every resolved workspace/schema so the next user re-resolves. */
export function resetTables(): void {
	workspaces.clear();
	workspaceInflight.clear();
	tables.clear();
	provisioned.clear();
	tableInflight.clear();
}

/** Drop one contract's resolved schema (the workspace is shared, so it stays). */
export function resetTable(contract: TableContract): void {
	const key = tableKey(contract);
	tables.delete(key);
	provisioned.delete(key);
	tableInflight.delete(key);
}

/**
 * The contract's table, provisioned if needed, with authoritative column ids.
 */
export async function resolveTable(contract: TableContract): Promise<ResolvedTable> {
	const key = tableKey(contract);
	const cached = tables.get(key);
	if (cached && contractIsCovered(contract, key)) return cached;

	let inflight = tableInflight.get(key);
	if (!inflight) {
		inflight = provision(contract, key);
		tableInflight.set(key, inflight);
	}
	try {
		const table = await inflight;
		tables.set(key, table);
		return table;
	} finally {
		tableInflight.delete(key);
	}
}

function contractIsCovered(contract: TableContract, key: string): boolean {
	const have = provisioned.get(key);
	if (!have) return false;
	return (contract.columns ?? []).every((column) => have.has(column.name));
}

/**
 * A resolver bound to one contract — what an app's `$lib/backend/*Table` module
 * exposes, so call sites never pass the contract around or key a cache by hand.
 */
export function createTableResolver(contract: TableContract): {
	resolve: () => Promise<ResolvedTable>;
	reset: () => void;
} {
	return {
		resolve: () => resolveTable(contract),
		reset: () => resetTable(contract)
	};
}

async function provision(contract: TableContract, key: string): Promise<ResolvedTable> {
	const owner = await ensureWorkspace(contract);
	let tableId: TableId | undefined = await findTable(contract, owner);

	if (tableId === undefined) {
		if (contract.create === false) {
			throw new TableMissingError(`This account has no ${contract.noun} table yet.`, {
				stage: 'table',
				workspaceName: contract.workspaceName,
				tableName: contract.tableName
			});
		}
		const created = await apiJson<TableSummary>('/api/v1/tables', {
			method: 'POST',
			body: JSON.stringify({
				table_id: contract.tableName,
				table_name: contract.tableName,
				workspace_id: owner
			})
		});
		tableId = created.table_id;
	}
	if (typeof tableId !== 'number' && !(typeof tableId === 'string' && tableId)) {
		throw new Error(`The ${contract.noun} table did not return an id.`);
	}

	let schema = await readSchema(tableId, owner);
	const have = new Set(schema.map((column) => column.name));
	let added = false;

	for (const needed of contract.columns ?? []) {
		if (have.has(needed.name)) continue;
		if (contract.create === false) {
			throw new TableMissingError(
				`This account's ${contract.noun} table is missing the ${needed.name} column.`,
				{
					stage: 'columns',
					workspaceName: contract.workspaceName,
					tableName: contract.tableName,
					columns: (contract.columns ?? [])
						.filter((column) => !have.has(column.name))
						.map((column) => column.name)
				}
			);
		}
		await apiJson<ColumnSummary>(`/api/v1/tables/${encodeURIComponent(tableId)}/columns`, {
			method: 'POST',
			body: JSON.stringify(needed)
		});
		added = true;
	}
	if (added) schema = await readSchema(tableId, owner);

	const columns: Record<string, string> = {};
	for (const column of schema) columns[column.name] = column.column_id;
	provisioned.set(key, new Set(Object.keys(columns)));

	return { workspaceId: owner, tableId, columns };
}

async function ensureWorkspace(contract: TableContract): Promise<string> {
	const known = workspaces.get(contract.workspaceName);
	if (known) return known;

	let inflight = workspaceInflight.get(contract.workspaceName);
	if (!inflight) {
		inflight = createOrFindWorkspace(contract);
		workspaceInflight.set(contract.workspaceName, inflight);
	}
	try {
		const resolved = await inflight;
		workspaces.set(contract.workspaceName, resolved);
		return resolved;
	} finally {
		workspaceInflight.delete(contract.workspaceName);
	}
}

async function createOrFindWorkspace(contract: TableContract): Promise<string> {
	const list = await apiJson<WorkspaceSummary[]>('/api/v1/workspaces');
	let found = list.find((workspace) => workspace.workspace_name === contract.workspaceName)?.workspace_id;

	if (!found) {
		if (contract.create === false) {
			throw new TableMissingError(`This account has no ${contract.workspaceName} workspace yet.`, {
				stage: 'workspace',
				workspaceName: contract.workspaceName,
				tableName: contract.tableName
			});
		}
		const created = await apiJson<WorkspaceSummary>('/api/v1/workspaces', {
			method: 'POST',
			body: JSON.stringify({ workspace_name: contract.workspaceName })
		});
		found = created.workspace_id;
	}
	if (!found) throw new Error('Your workspace did not return an identifier.');
	return found;
}

async function findTable(contract: TableContract, owner: string): Promise<TableId | undefined> {
	const list = await apiJson<TableSummary[]>('/api/v1/tables');
	return list.find(
		(table) =>
			(table.table_name ?? (typeof table.table_id === 'string' ? table.table_id : undefined)) === contract.tableName &&
			String(table.workspace_id) === String(owner)
	)?.table_id;
}

async function readSchema(tableId: TableId, owner: string): Promise<ColumnSummary[]> {
	const body = await apiJson<{ columns?: ColumnSummary[] }>(
		`/api/v1/tables/${encodeURIComponent(tableId)}?workspace_id=${encodeURIComponent(owner)}`
	);
	return body.columns ?? [];
}

/** Rows of a resolved table. */
export async function listRows(
	tableId: TableId,
	options: { limit?: number; offset?: number } = {}
): Promise<TableRow[]> {
	const query = new URLSearchParams();
	if (options.limit !== undefined) query.set('limit', String(options.limit));
	if (options.offset !== undefined) query.set('offset', String(options.offset));
	const suffix = query.size ? `?${query.toString()}` : '';
	return apiJson<TableRow[]>(`/api/v1/tables/${encodeURIComponent(tableId)}/rows${suffix}`);
}

export async function createRow(
	tableId: TableId,
	rowData: Record<string, unknown>
): Promise<TableRow> {
	return apiJson<TableRow>(`/api/v1/tables/${encodeURIComponent(tableId)}/rows`, {
		method: 'POST',
		body: JSON.stringify({ row_data: rowData })
	});
}

export async function updateRow(
	tableId: TableId,
	rowId: number,
	rowData: Record<string, unknown>
): Promise<TableRow> {
	return apiJson<TableRow>(`/api/v1/tables/${encodeURIComponent(tableId)}/rows/${rowId}`, {
		method: 'PUT',
		body: JSON.stringify({ row_data: rowData })
	});
}

export async function deleteRow(tableId: TableId, rowId: number): Promise<void> {
	await apiFetch(`/api/v1/tables/${encodeURIComponent(tableId)}/rows/${rowId}`, { method: 'DELETE' });
}

/** Path of the one file a blob column holds. */
function blobPath(tableId: TableId, rowId: number, columnId: string): string {
	return `/api/v1/tables/${encodeURIComponent(tableId)}/rows/${rowId}/blob/${columnId}`;
}

function formWith(field: string, file: Blob, filename?: string): FormData {
	const form = new FormData();
	const name =
		filename ?? (typeof File !== 'undefined' && file instanceof File ? file.name : 'file');
	form.append(field, file, name);
	return form;
}

/** The descriptor LatticeCast persists in `row_data[column_id]` after an upload. */
export interface BlobMetadata {
	row_id?: number;
	column_id?: string;
	size?: number;
	content_type?: string;
	[key: string]: unknown;
}

export interface BlobUploadOptions {
	/** Name the stored file; defaults to the File's own name. */
	filename?: string;
}

export interface BlobDownloadOptions {
	/** Treat a missing blob (404) as `null` instead of an error. */
	missingOk?: boolean;
}

/**
 * Upload one file into a blob column, as `multipart/form-data` with a bearer
 * header. The client never builds the `row_data` descriptor itself — LatticeCast
 * answers with it.
 */
export async function uploadBlob(
	tableId: TableId,
	rowId: number,
	columnId: string,
	file: Blob | FormData,
	options: BlobUploadOptions = {}
): Promise<BlobMetadata | null> {
	const body = file instanceof FormData ? file : formWith('file', file, options.filename);
	const response = await apiFetch(blobPath(tableId, rowId, columnId), { method: 'PUT', body }, { bearer: true });
	return readMetadata(response);
}

export interface TextBlobOptions {
	filename?: string;
	/** Defaults to `application/x-ndjson` (the JSONL transcripts). */
	contentType?: string;
}

/** A text payload (a JSONL transcript, a document) as one stored file. */
export async function uploadTextBlob(
	tableId: TableId,
	rowId: number,
	columnId: string,
	text: string,
	options: TextBlobOptions = {}
): Promise<BlobMetadata | null> {
	const blob = new Blob([text], { type: options.contentType ?? 'application/x-ndjson' });
	return uploadBlob(tableId, rowId, columnId, blob, {
		filename: options.filename ?? `row-${rowId}.jsonl`
	});
}

async function readMetadata(response: Response): Promise<BlobMetadata | null> {
	// A 204 means LatticeCast stored the file but sent no descriptor back.
	if (response.status === 204) return null;
	try {
		return (await response.json()) as BlobMetadata;
	} catch {
		return null;
	}
}

/** Read a blob column; the caller decides how to consume the body. */
export async function downloadBlob(
	tableId: TableId,
	rowId: number,
	columnId: string,
	options: BlobDownloadOptions = {}
): Promise<Response | null> {
	try {
		return await apiFetch(blobPath(tableId, rowId, columnId), {}, { bearer: true });
	} catch (error) {
		if (options.missingOk && error instanceof LatticeCastError && error.status === 404) return null;
		throw error;
	}
}

/** Text of a blob column — JSONL transcripts and documents. `null` when absent. */
export async function downloadBlobText(
	tableId: TableId,
	rowId: number,
	columnId: string,
	options: BlobDownloadOptions = {}
): Promise<string | null> {
	const response = await downloadBlob(tableId, rowId, columnId, options);
	return response ? response.text() : null;
}

/** Bytes of a blob column, for an image or audio pipeline. `null` when absent. */
export async function downloadBlobFile(
	tableId: TableId,
	rowId: number,
	columnId: string,
	options: BlobDownloadOptions = {}
): Promise<Blob | null> {
	const response = await downloadBlob(tableId, rowId, columnId, options);
	return response ? response.blob() : null;
}

/**
 * Object URL for a blob column, ready for `src`. `null` when absent; the caller
 * revokes the URL (`URL.revokeObjectURL`) when it unmounts.
 */
export async function downloadBlobUrl(
	tableId: TableId,
	rowId: number,
	columnId: string,
	options: BlobDownloadOptions = {}
): Promise<string | null> {
	const file = await downloadBlobFile(tableId, rowId, columnId, options);
	return file ? URL.createObjectURL(file) : null;
}
