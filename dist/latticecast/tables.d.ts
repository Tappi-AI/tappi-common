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
export declare class TableMissingError extends Error {
    readonly stage: MissingStage;
    /** Column names the table is missing (only for `stage: 'columns'`). */
    readonly missing: readonly string[];
    readonly workspaceName: string;
    readonly tableName: string;
    constructor(message: string, missing: {
        stage: MissingStage;
        workspaceName: string;
        tableName: string;
        columns?: readonly string[];
    });
}
/** Drop every resolved workspace/schema so the next user re-resolves. */
export declare function resetTables(): void;
/** Drop one contract's resolved schema (the workspace is shared, so it stays). */
export declare function resetTable(contract: TableContract): void;
/**
 * The contract's table, provisioned if needed, with authoritative column ids.
 */
export declare function resolveTable(contract: TableContract): Promise<ResolvedTable>;
/**
 * A resolver bound to one contract — what an app's `$lib/backend/*Table` module
 * exposes, so call sites never pass the contract around or key a cache by hand.
 */
export declare function createTableResolver(contract: TableContract): {
    resolve: () => Promise<ResolvedTable>;
    reset: () => void;
};
/** Rows of a resolved table. */
export declare function listRows(tableId: TableId, options?: {
    limit?: number;
    offset?: number;
}): Promise<TableRow[]>;
export declare function createRow(tableId: TableId, rowData: Record<string, unknown>): Promise<TableRow>;
export declare function updateRow(tableId: TableId, rowId: number, rowData: Record<string, unknown>): Promise<TableRow>;
export declare function deleteRow(tableId: TableId, rowId: number): Promise<void>;
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
export declare function uploadBlob(tableId: TableId, rowId: number, columnId: string, file: Blob | FormData, options?: BlobUploadOptions): Promise<BlobMetadata | null>;
export interface TextBlobOptions {
    filename?: string;
    /** Defaults to `application/x-ndjson` (the JSONL transcripts). */
    contentType?: string;
}
/** A text payload (a JSONL transcript, a document) as one stored file. */
export declare function uploadTextBlob(tableId: TableId, rowId: number, columnId: string, text: string, options?: TextBlobOptions): Promise<BlobMetadata | null>;
/** Read a blob column; the caller decides how to consume the body. */
export declare function downloadBlob(tableId: TableId, rowId: number, columnId: string, options?: BlobDownloadOptions): Promise<Response | null>;
/** Text of a blob column — JSONL transcripts and documents. `null` when absent. */
export declare function downloadBlobText(tableId: TableId, rowId: number, columnId: string, options?: BlobDownloadOptions): Promise<string | null>;
/** Bytes of a blob column, for an image or audio pipeline. `null` when absent. */
export declare function downloadBlobFile(tableId: TableId, rowId: number, columnId: string, options?: BlobDownloadOptions): Promise<Blob | null>;
/**
 * Object URL for a blob column, ready for `src`. `null` when absent; the caller
 * revokes the URL (`URL.revokeObjectURL`) when it unmounts.
 */
export declare function downloadBlobUrl(tableId: TableId, rowId: number, columnId: string, options?: BlobDownloadOptions): Promise<string | null>;
//# sourceMappingURL=tables.d.ts.map