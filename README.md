# @tappi-ai/common

The one implementation of the layer every Tappi web app shares with LatticeCast:
session, transport, and per-user table resolution.

It exists because that layer used to be copied into six repos
(`wellbeing`, `sleep`, `spin-to-win`, `jounery`, `daily-moment`,
`speak-english`) and had already drifted into four transport dialects and two
handoff behaviours. When LatticeCast 0.82 moved table creation to `table_name`
and table paths to the numeric `table_id`, all six apps needed the same fix.

## What is here (and what is not)

| Entry | Contents |
| --- | --- |
| `@tappi-ai/common/http` | `apiFetch`, `apiJson` / `requestJson`, `authHeaders`, `bearerHeaders`, `LatticeCastError` (`BackendError` alias), `describeError` |
| `@tappi-ai/common/auth` | auth types, `authStore` + `hydrateSession` / `setSession` / `logout`, `login` / `fetchMe` / `signInWithPassword`, `acceptNativeHandoff`, `validateUserName` |
| `@tappi-ai/common/latticecast` | `resolveTable` / `createTableResolver` (workspace → table → columns, idempotent), row CRUD, blob upload/download (`uploadBlob`, `uploadTextBlob`, `downloadBlob`, `downloadBlobText`, `downloadBlobFile`, `downloadBlobUrl`), `TableMissingError` |
| `@tappi-ai/common/config` | `configureBackend`, `apiUrl`, `sessionStorageKey` |

Deliberately **not** here: UI, components, themes, per-app domain logic, and
anything that reads `import.meta.env`. Each app owns its environment: its
`src/lib/backend/config.ts` resolves the build-time origin (development is
same-origin through the Vite proxy) and calls `configureBackend` once.

## Consuming it

```json
"dependencies": {
	"@tappi-ai/common": "github:Tappi-AI/tappi-common#0.1.0"
}
```

`dist/` is committed, so installing never runs a build. A release is: bump the
version, `npm run release` (check + test + build), commit, tag, push.

Each app keeps a thin shim so its own imports never change:

```ts
// src/lib/backend/http.ts
export * from '@tappi-ai/common/http';
```

```ts
// src/lib/stores/auth.store.ts
import { BACKEND_DOMAIN } from '$lib/backend/config';
import { authStore, configureBackend, hydrateSession, logout } from '@tappi-ai/common/auth';

configureBackend({ backendDomain: BACKEND_DOMAIN });
hydrateSession();

export { authStore, logout };
```

`configureBackend` must run before `hydrateSession`: the session slot is keyed by
origin (`loginInfo:<origin>`) so a stage token can never be replayed against
production.

## Table resolution contract

```ts
const table = await resolveTable({
	workspaceName: 'tappi',
	tableName: 'sleep-bracelets',
	noun: 'bracelet',
	columns: [
		{ name: 'Code', type: 'text' },
		{ name: 'Label', type: 'text' }
	]
});
// → { workspaceId, tableId: number, columns: { Code: 'c-uuid', ... } }
```

Concurrent callers share one resolution, a resolved table is cached per session,
`resetTables()` drops everything on sign-out, and a `create: false` contract
(read-only surfaces such as a customer's wheel) throws `TableMissingError`
instead of provisioning.

## Blob columns

Documents, transcripts, photos and audio live in selected blob columns — never
in the removed `/doc` routes. Resolve the column id at runtime, then:

```ts
// Upload: one file per cell, multipart, browser-owned content type.
await uploadBlob(table.tableId, rowId, columnId, webpFile);           // File → its own name
await uploadTextBlob(table.tableId, rowId, columnId, jsonlText);      // → row-<id>.jsonl (x-ndjson)

// Read: pick the shape the caller needs.
const text = await downloadBlobText(tableId, rowId, columnId, { missingOk: true }); // null if empty
const url = await downloadBlobUrl(tableId, rowId, columnId);          // object URL, caller revokes
const bytes = await downloadBlobFile(tableId, rowId, columnId);       // Blob
const raw = await downloadBlob(tableId, rowId, columnId);             // Response
```

`missingOk` only swallows 404 (an empty cell); an expired session still throws.
An upload answers with the descriptor LatticeCast persists in
`row_data[column_id]` — clients never build that descriptor themselves.
