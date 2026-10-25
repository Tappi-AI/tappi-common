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
/** The account has no provisioned storage for a read-only contract. */
export class TableMissingError extends Error {
    stage;
    /** Column names the table is missing (only for `stage: 'columns'`). */
    missing;
    workspaceName;
    tableName;
    constructor(message, missing) {
        super(message);
        this.name = 'TableMissingError';
        this.stage = missing.stage;
        this.missing = missing.columns ?? [];
        this.workspaceName = missing.workspaceName;
        this.tableName = missing.tableName;
    }
}
const workspaces = new Map();
const workspaceInflight = new Map();
const tables = new Map();
const provisioned = new Map();
const tableInflight = new Map();
function tableKey(contract) {
    return `${contract.workspaceName}\u0000${contract.tableName}`;
}
/** Drop every resolved workspace/schema so the next user re-resolves. */
export function resetTables() {
    workspaces.clear();
    workspaceInflight.clear();
    tables.clear();
    provisioned.clear();
    tableInflight.clear();
}
/** Drop one contract's resolved schema (the workspace is shared, so it stays). */
export function resetTable(contract) {
    const key = tableKey(contract);
    tables.delete(key);
    provisioned.delete(key);
    tableInflight.delete(key);
}
/**
 * The contract's table, provisioned if needed, with authoritative column ids.
 */
export async function resolveTable(contract) {
    const key = tableKey(contract);
    const cached = tables.get(key);
    if (cached && contractIsCovered(contract, key))
        return cached;
    let inflight = tableInflight.get(key);
    if (!inflight) {
        inflight = provision(contract, key);
        tableInflight.set(key, inflight);
    }
    try {
        const table = await inflight;
        tables.set(key, table);
        return table;
    }
    finally {
        tableInflight.delete(key);
    }
}
function contractIsCovered(contract, key) {
    const have = provisioned.get(key);
    if (!have)
        return false;
    return (contract.columns ?? []).every((column) => have.has(column.name));
}
/**
 * A resolver bound to one contract — what an app's `$lib/backend/*Table` module
 * exposes, so call sites never pass the contract around or key a cache by hand.
 */
export function createTableResolver(contract) {
    return {
        resolve: () => resolveTable(contract),
        reset: () => resetTable(contract)
    };
}
async function provision(contract, key) {
    const owner = await ensureWorkspace(contract);
    let tableId = await findTable(contract, owner);
    if (tableId === undefined) {
        if (contract.create === false) {
            throw new TableMissingError(`This account has no ${contract.noun} table yet.`, {
                stage: 'table',
                workspaceName: contract.workspaceName,
                tableName: contract.tableName
            });
        }
        const created = await apiJson('/api/v1/tables', {
            method: 'POST',
            body: JSON.stringify({ table_name: contract.tableName, workspace_id: owner })
        });
        tableId = created.table_id;
    }
    if (typeof tableId !== 'number')
        throw new Error(`The ${contract.noun} table did not return an id.`);
    let schema = await readSchema(tableId, owner);
    const have = new Set(schema.map((column) => column.name));
    let added = false;
    for (const needed of contract.columns ?? []) {
        if (have.has(needed.name))
            continue;
        if (contract.create === false) {
            throw new TableMissingError(`This account's ${contract.noun} table is missing the ${needed.name} column.`, {
                stage: 'columns',
                workspaceName: contract.workspaceName,
                tableName: contract.tableName,
                columns: (contract.columns ?? [])
                    .filter((column) => !have.has(column.name))
                    .map((column) => column.name)
            });
        }
        await apiJson(`/api/v1/tables/${tableId}/columns`, {
            method: 'POST',
            body: JSON.stringify(needed)
        });
        added = true;
    }
    if (added)
        schema = await readSchema(tableId, owner);
    const columns = {};
    for (const column of schema)
        columns[column.name] = column.column_id;
    provisioned.set(key, new Set(Object.keys(columns)));
    return { workspaceId: owner, tableId, columns };
}
async function ensureWorkspace(contract) {
    const known = workspaces.get(contract.workspaceName);
    if (known)
        return known;
    let inflight = workspaceInflight.get(contract.workspaceName);
    if (!inflight) {
        inflight = createOrFindWorkspace(contract);
        workspaceInflight.set(contract.workspaceName, inflight);
    }
    try {
        const resolved = await inflight;
        workspaces.set(contract.workspaceName, resolved);
        return resolved;
    }
    finally {
        workspaceInflight.delete(contract.workspaceName);
    }
}
async function createOrFindWorkspace(contract) {
    const list = await apiJson('/api/v1/workspaces');
    let found = list.find((workspace) => workspace.workspace_name === contract.workspaceName)?.workspace_id;
    if (!found) {
        if (contract.create === false) {
            throw new TableMissingError(`This account has no ${contract.workspaceName} workspace yet.`, {
                stage: 'workspace',
                workspaceName: contract.workspaceName,
                tableName: contract.tableName
            });
        }
        const created = await apiJson('/api/v1/workspaces', {
            method: 'POST',
            body: JSON.stringify({ workspace_name: contract.workspaceName })
        });
        found = created.workspace_id;
    }
    if (!found)
        throw new Error('Your workspace did not return an identifier.');
    return found;
}
async function findTable(contract, owner) {
    const list = await apiJson('/api/v1/tables');
    return list.find((table) => table.table_name === contract.tableName && String(table.workspace_id) === String(owner))?.table_id;
}
async function readSchema(tableId, owner) {
    const body = await apiJson(`/api/v1/tables/${tableId}?workspace_id=${encodeURIComponent(owner)}`);
    return body.columns ?? [];
}
/** Rows of a resolved table. */
export async function listRows(tableId, options = {}) {
    const query = new URLSearchParams();
    if (options.limit !== undefined)
        query.set('limit', String(options.limit));
    if (options.offset !== undefined)
        query.set('offset', String(options.offset));
    const suffix = query.size ? `?${query.toString()}` : '';
    return apiJson(`/api/v1/tables/${tableId}/rows${suffix}`);
}
export async function createRow(tableId, rowData) {
    return apiJson(`/api/v1/tables/${tableId}/rows`, {
        method: 'POST',
        body: JSON.stringify({ row_data: rowData })
    });
}
export async function updateRow(tableId, rowId, rowData) {
    return apiJson(`/api/v1/tables/${tableId}/rows/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({ row_data: rowData })
    });
}
export async function deleteRow(tableId, rowId) {
    await apiFetch(`/api/v1/tables/${tableId}/rows/${rowId}`, { method: 'DELETE' });
}
/** Path of the one file a blob column holds. */
function blobPath(tableId, rowId, columnId) {
    return `/api/v1/tables/${tableId}/rows/${rowId}/blob/${columnId}`;
}
function formWith(field, file, filename) {
    const form = new FormData();
    const name = filename ?? (typeof File !== 'undefined' && file instanceof File ? file.name : 'file');
    form.append(field, file, name);
    return form;
}
/**
 * Upload one file into a blob column, as `multipart/form-data` with a bearer
 * header. The client never builds the `row_data` descriptor itself — LatticeCast
 * answers with it.
 */
export async function uploadBlob(tableId, rowId, columnId, file, options = {}) {
    const body = file instanceof FormData ? file : formWith('file', file, options.filename);
    const response = await apiFetch(blobPath(tableId, rowId, columnId), { method: 'PUT', body }, { bearer: true });
    return readMetadata(response);
}
/** A text payload (a JSONL transcript, a document) as one stored file. */
export async function uploadTextBlob(tableId, rowId, columnId, text, options = {}) {
    const blob = new Blob([text], { type: options.contentType ?? 'application/x-ndjson' });
    return uploadBlob(tableId, rowId, columnId, blob, {
        filename: options.filename ?? `row-${rowId}.jsonl`
    });
}
async function readMetadata(response) {
    // A 204 means LatticeCast stored the file but sent no descriptor back.
    if (response.status === 204)
        return null;
    try {
        return (await response.json());
    }
    catch {
        return null;
    }
}
/** Read a blob column; the caller decides how to consume the body. */
export async function downloadBlob(tableId, rowId, columnId, options = {}) {
    try {
        return await apiFetch(blobPath(tableId, rowId, columnId), {}, { bearer: true });
    }
    catch (error) {
        if (options.missingOk && error instanceof LatticeCastError && error.status === 404)
            return null;
        throw error;
    }
}
/** Text of a blob column — JSONL transcripts and documents. `null` when absent. */
export async function downloadBlobText(tableId, rowId, columnId, options = {}) {
    const response = await downloadBlob(tableId, rowId, columnId, options);
    return response ? response.text() : null;
}
/** Bytes of a blob column, for an image or audio pipeline. `null` when absent. */
export async function downloadBlobFile(tableId, rowId, columnId, options = {}) {
    const response = await downloadBlob(tableId, rowId, columnId, options);
    return response ? response.blob() : null;
}
/**
 * Object URL for a blob column, ready for `src`. `null` when absent; the caller
 * revokes the URL (`URL.revokeObjectURL`) when it unmounts.
 */
export async function downloadBlobUrl(tableId, rowId, columnId, options = {}) {
    const file = await downloadBlobFile(tableId, rowId, columnId, options);
    return file ? URL.createObjectURL(file) : null;
}
//# sourceMappingURL=tables.js.map