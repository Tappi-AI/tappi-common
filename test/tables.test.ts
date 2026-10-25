import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureBackend, resetBackendConfig } from '../src/config.js';
import { setSession, clearSession } from '../src/auth/session.js';
import {
	createTableResolver,
	listRows,
	resolveTable,
	resetTables,
	TableMissingError,
	type TableContract
} from '../src/latticecast/tables.js';

interface FakeTable {
	table_id: number | string;
	table_name?: string;
	workspace_id: string;
	columns: { name: string; column_id: string; type: string }[];
}

/** A LatticeCast stand-in that records every write it is asked to perform. */
function fakeBackend() {
	const workspaces: { workspace_id: string; workspace_name: string }[] = [];
	const tables: FakeTable[] = [];
	const writes: string[] = [];
	let failColumnCreate = false;
	const bodies: { path: string; body: Record<string, unknown> }[] = [];
	let nextTable = 100;
	let nextColumn = 1;

	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	const handler = async (url: string, init: RequestInit): Promise<Response> => {
		const method = init.method ?? 'GET';
		const path = new URL(url, 'https://x').pathname;
		if (method !== 'GET') writes.push(`${method} ${path}`);
		if (method !== 'GET' && init.body) bodies.push({ path, body: JSON.parse(String(init.body)) });

		if (path === '/api/v1/workspaces' && method === 'GET') return json(workspaces);
		if (path === '/api/v1/workspaces' && method === 'POST') {
			const workspace = { workspace_id: 'w1', workspace_name: JSON.parse(String(init.body)).workspace_name };
			workspaces.push(workspace);
			return json(workspace, 201);
		}

		if (path === '/api/v1/tables' && method === 'GET') return json(tables.map(({ columns, ...rest }) => rest));
		if (path === '/api/v1/tables' && method === 'POST') {
			const body = JSON.parse(String(init.body));
			const table: FakeTable = {
				table_id: nextTable++,
				table_name: body.table_name,
				workspace_id: body.workspace_id,
				columns: []
			};
			tables.push(table);
			return json({ table_id: table.table_id, table_name: table.table_name, workspace_id: table.workspace_id }, 201);
		}

		const columnMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/columns$/);
		if (columnMatch && method === 'POST' && failColumnCreate) {
			return json({ detail: 'column rejected' }, 500);
		}
		if (columnMatch && method === 'POST') {
			const table = tables.find((item) => String(item.table_id) === decodeURIComponent(columnMatch[1]))!;
			const body = JSON.parse(String(init.body));
			table.columns.push({ name: body.name, type: body.type, column_id: `c${nextColumn++}` });
			return json(table.columns.at(-1), 201);
		}

		const schemaMatch = path.match(/^\/api\/v1\/tables\/([^/]+)$/);
		if (schemaMatch && method === 'GET') {
			const table = tables.find((item) => String(item.table_id) === decodeURIComponent(schemaMatch[1]))!;
			return json({ ...table, columns: table.columns });
		}

		const rowsMatch = path.match(/^\/api\/v1\/tables\/([^/]+)\/rows$/);
		if (rowsMatch && method === 'GET') return json([{ row_id: 1, row_data: {} }]);

		return json({ detail: `unhandled ${method} ${path}` }, 404);
	};

	return {
		workspaces,
		tables,
		writes,
		bodies,
		handler,
		set failColumnCreate(value: boolean) {
			failColumnCreate = value;
		}
	};
}

const CONTRACT: TableContract = {
	workspaceName: 'tappi',
	tableName: 'sleep-bracelets',
	noun: 'bracelet',
	columns: [
		{ name: 'Code', type: 'text' },
		{ name: 'Label', type: 'text' }
	]
};

let backend: ReturnType<typeof fakeBackend>;

beforeEach(() => {
	configureBackend({ backendDomain: 'https://table.novasplit.ai' });
	setSession({ provider: 'none', accessToken: 'tok', userInfo: { sub: 'u' }, role: 'user' });
	resetTables();
	backend = fakeBackend();
	vi.stubGlobal('fetch', vi.fn(backend.handler));
});

afterEach(() => {
	clearSession();
	resetTables();
	resetBackendConfig();
	vi.unstubAllGlobals();
});

describe('resolveTable', () => {
	it('provisions workspace, table and columns, then returns their ids', async () => {
		const table = await resolveTable(CONTRACT);
		expect(table.workspaceId).toBe('w1');
		expect(table.tableId).toBe(100);
		expect(Object.keys(table.columns).sort()).toEqual(['Code', 'Label']);
		expect(backend.writes).toEqual([
			'POST /api/v1/workspaces',
			'POST /api/v1/tables',
			'POST /api/v1/tables/100/columns',
			'POST /api/v1/tables/100/columns'
		]);
	});

	it('carries both contract spellings when it creates a table', async () => {
		// Production keys a table by name (`table_id`), stage by name
		// (`table_name`); sending the pair is what lets one package serve both.
		await resolveTable(CONTRACT);
		const created = backend.bodies.find((call) => call.path === '/api/v1/tables');
		expect(created?.body).toMatchObject({
			table_id: 'sleep-bracelets',
			table_name: 'sleep-bracelets',
			workspace_id: 'w1'
		});
	});

	it('resolves an existing legacy table whose response has no table_name', async () => {
		backend.workspaces.push({ workspace_id: 'w1', workspace_name: 'tappi' });
		backend.tables.push({
			table_id: 'sleep-bracelets',
			workspace_id: 'w1',
			columns: [
				{ name: 'Code', column_id: 'c1', type: 'text' },
				{ name: 'Label', column_id: 'c2', type: 'text' }
			]
		});

		const table = await resolveTable(CONTRACT);
		expect(table.tableId).toBe('sleep-bracelets');
		expect(backend.writes).toEqual([]);
		const rows = await listRows(table.tableId, { limit: 5 });
		expect(rows).toHaveLength(1);
	});

	it('reuses the account\'s existing workspace, table and columns', async () => {
		backend.workspaces.push({ workspace_id: 'w1', workspace_name: 'tappi' });
		backend.tables.push({
			table_id: 55,
			table_name: 'sleep-bracelets',
			workspace_id: 'w1',
			columns: [
				{ name: 'Code', column_id: 'c1', type: 'text' },
				{ name: 'Label', column_id: 'c2', type: 'text' }
			]
		});

		const table = await resolveTable(CONTRACT);
		expect(table.tableId).toBe(55);
		expect(table.columns).toEqual({ Code: 'c1', Label: 'c2' });
		expect(backend.writes).toEqual([]);
	});

	it('caches one resolution and de-duplicates concurrent callers', async () => {
		const [first, second, third] = await Promise.all([
			resolveTable(CONTRACT),
			resolveTable(CONTRACT),
			resolveTable(CONTRACT)
		]);
		expect(first.tableId).toBe(second.tableId);
		expect(first.tableId).toBe(third.tableId);
		// One workspace read, one table read, one schema read — not three.
		const reads = (vi.mocked(fetch).mock.calls as [string, RequestInit][]).filter(
			([, init]) => (init?.method ?? 'GET') === 'GET'
		);
		expect(reads).toHaveLength(4);
		expect(backend.writes.filter((w) => w === 'POST /api/v1/tables')).toHaveLength(1);
	});

	it('resolves again after a reset (sign-out)', async () => {
		await resolveTable(CONTRACT);
		resetTables();
		await resolveTable(CONTRACT);
		expect(backend.writes.filter((w) => w === 'POST /api/v1/tables')).toHaveLength(1);
	});

	it('names the column when adding one fails', async () => {
		backend.workspaces.push({ workspace_id: 'w1', workspace_name: 'tappi' });
		backend.tables.push({
			table_id: 77,
			table_name: 'sleep-bracelets',
			workspace_id: 'w1',
			columns: [{ name: 'Code', column_id: 'c1', type: 'text' }]
		});
		backend.failColumnCreate = true;

		await expect(resolveTable(CONTRACT)).rejects.toThrow(
			'Could not add the Label column to the bracelet table. column rejected'
		);
	});

	it('adds only the columns the existing table is missing', async () => {
		backend.workspaces.push({ workspace_id: 'w1', workspace_name: 'tappi' });
		backend.tables.push({
			table_id: 77,
			table_name: 'sleep-bracelets',
			workspace_id: 'w1',
			columns: [{ name: 'Code', column_id: 'c1', type: 'text' }]
		});

		const table = await createTableResolver(CONTRACT).resolve();
		expect(table.tableId).toBe(77);
		expect(table.columns.Code).toBe('c1');
		expect(table.columns.Label).toBeTruthy();
		expect(backend.writes).toEqual(['POST /api/v1/tables/77/columns']);
	});

	it('refuses to create storage for a read-only contract', async () => {
		const attempt = resolveTable({ ...CONTRACT, create: false });
		await expect(attempt).rejects.toBeInstanceOf(TableMissingError);
		expect(backend.writes).toEqual([]);

		const failure = (await attempt.catch((error: unknown) => error)) as TableMissingError;
		expect(failure.stage).toBe('workspace');
		expect(failure.workspaceName).toBe('tappi');
		expect(failure.tableName).toBe('sleep-bracelets');
	});

	it('names the columns a read-only table is missing', async () => {
		backend.workspaces.push({ workspace_id: 'w1', workspace_name: 'tappi' });
		backend.tables.push({
			table_id: 55,
			table_name: 'sleep-bracelets',
			workspace_id: 'w1',
			columns: [{ name: 'Code', column_id: 'c1', type: 'text' }]
		});

		const attempt = resolveTable({ ...CONTRACT, create: false });
		await expect(attempt).rejects.toBeInstanceOf(TableMissingError);
		const failure = (await attempt.catch((error: unknown) => error)) as TableMissingError;
		expect(failure.stage).toBe('columns');
		expect(failure.missing).toEqual(['Label']);
	});
});

describe('rows', () => {
	it('lists rows from the resolved numeric table id', async () => {
		const rows = await listRows(100, { limit: 5 });
		expect(rows).toHaveLength(1);
		const [url] = vi.mocked(fetch).mock.calls.at(-1)!;
		expect(String(url)).toBe('https://table.novasplit.ai/api/v1/tables/100/rows?limit=5');
	});
});
