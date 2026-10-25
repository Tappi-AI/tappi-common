import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureBackend, resetBackendConfig } from '../src/config.js';
import { setSession, clearSession } from '../src/auth/session.js';
import {
	downloadBlob,
	downloadBlobFile,
	downloadBlobText,
	downloadBlobUrl,
	resetTables,
	uploadBlob,
	uploadTextBlob
} from '../src/latticecast/tables.js';

const BLOB_URL = 'https://table.novasplit.ai/api/v1/tables/100/rows/7/blob/c-history';

type Call = [string, RequestInit];

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
	const spy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
		handler(String(input), init)
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

beforeEach(() => {
	configureBackend({ backendDomain: 'https://table.novasplit.ai' });
	setSession({ provider: 'none', accessToken: 'tok', userInfo: { sub: 'u' }, role: 'user' });
	resetTables();
});

afterEach(() => {
	clearSession();
	resetTables();
	resetBackendConfig();
	vi.unstubAllGlobals();
});

describe('uploadBlob', () => {
	it('posts a multipart file named after the File, with only the session header', async () => {
		const spy = stubFetch(
			() => new Response(JSON.stringify({ row_id: 7, column_id: 'c-history', size: 12 }), { status: 200 })
		);
		const file = new File(['{"a":1}\n'], 'chat-7.jsonl', { type: 'application/x-ndjson' });
		const meta = await uploadBlob(100, 7, 'c-history', file);

		expect(meta).toMatchObject({ row_id: 7, size: 12 });
		const [url, init] = spy.mock.calls[0]! as unknown as Call;
		expect(url).toBe(BLOB_URL);
		expect(init.method).toBe('PUT');
		const body = init.body as FormData;
		expect(body).toBeInstanceOf(FormData);
		const sent = body.get('file') as File;
		expect(sent.name).toBe('chat-7.jsonl');
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer tok`);
		// The browser owns the multipart content type, with its boundary.
		expect(headers['Content-Type']).toBeUndefined();
	});

	it('lets the caller name the stored file', async () => {
		const spy = stubFetch(() => new Response(null, { status: 204 }));
		await uploadBlob(100, 7, 'c-history', new Blob(['x']), { filename: 'capture.webp' });
		const body = (spy.mock.calls[0]! as unknown as Call)[1].body as FormData;
		expect((body.get('file') as File).name).toBe('capture.webp');
	});

	it('wraps text as an NDJSON file by default', async () => {
		const spy = stubFetch(() => new Response('{}', { status: 200 }));
		await uploadTextBlob(100, 7, 'c-history', '{"role":"user"}\n');
		const body = (spy.mock.calls[0]! as unknown as Call)[1].body as FormData;
		const file = body.get('file') as File;
		expect(file.name).toBe('row-7.jsonl');
		expect(file.type).toBe('application/x-ndjson');
		expect(await file.text()).toBe('{"role":"user"}\n');
	});

	it('answers null when LatticeCast returns no descriptor', async () => {
		stubFetch(() => new Response(null, { status: 204 }));
		expect(await uploadBlob(100, 7, 'c-history', new Blob(['x']))).toBeNull();
	});
});

describe('downloads', () => {
	it('reads a JSONL transcript as text', async () => {
		stubFetch(() => new Response('{"role":"user"}\n', { status: 200 }));
		expect(await downloadBlobText(100, 7, 'c-history')).toBe('{"role":"user"}\n');
	});

	it('treats a missing blob as null when asked', async () => {
		stubFetch(() => new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }));
		expect(await downloadBlobText(100, 7, 'c-history', { missingOk: true })).toBeNull();
		expect(await downloadBlobFile(100, 7, 'c-history', { missingOk: true })).toBeNull();
	});

	it('still throws a genuine failure (expired session)', async () => {
		stubFetch(() => new Response('', { status: 401 }));
		await expect(downloadBlob(100, 7, 'c-history', { missingOk: true })).rejects.toMatchObject({
			status: 401
		});
	});

	it('turns an image blob into an object URL', async () => {
		stubFetch(() => new Response(new Blob(['webp-bytes'], { type: 'image/webp' }), { status: 200 }));
		const create = vi.fn(() => 'blob:mock-url');
		vi.stubGlobal('URL', { ...URL, createObjectURL: create });

		await expect(downloadBlobUrl(100, 7, 'c-photo')).resolves.toBe('blob:mock-url');
		expect(create).toHaveBeenCalledOnce();
	});
});
