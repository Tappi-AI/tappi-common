import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureBackend, resetBackendConfig } from '../src/config.js';
import {
	apiFetch,
	apiJson,
	authHeaders,
	bearerHeaders,
	describeError,
	LatticeCastError,
	SESSION_EXPIRED_MESSAGE
} from '../src/http.js';
import { setSession } from '../src/auth/session.js';

const session = {
	provider: 'none' as const,
	accessToken: 'tok-123',
	userInfo: { sub: 'u1', name: 'Ada' },
	role: 'user'
};

beforeEach(() => {
	configureBackend({ backendDomain: 'https://table.novasplit.ai' });
	setSession(session);
});

afterEach(() => {
	setSession(null);
	resetBackendConfig();
	vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
	const spy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
		handler(String(input), init)
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

describe('headers', () => {
	it('sends the cached session token with a JSON content type', () => {
		expect(authHeaders()).toEqual({ Authorization: `Bearer tok-123`, 'Content-Type': 'application/json' });
		expect(bearerHeaders()).toEqual({ Authorization: `Bearer tok-123` });
	});

	it('refuses to build headers without a session', () => {
		setSession(null);
		expect(() => authHeaders()).toThrowError(SESSION_EXPIRED_MESSAGE);
		let error: LatticeCastError | undefined;
		try {
			authHeaders();
		} catch (cause) {
			error = cause as LatticeCastError;
		}
		expect(error?.status).toBe(401);
	});
});

describe('apiJson', () => {
	it('calls the configured origin with the session token', async () => {
		const spy = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
		const body = await apiJson<{ ok: boolean }>('/api/v1/tables');
		expect(body).toEqual({ ok: true });
		const [url, init = {}] = spy.mock.calls[0]!;
		expect(url).toBe('https://table.novasplit.ai/api/v1/tables');
		expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer tok-123`);
	});

	it('omits the token for the unauthenticated login call', async () => {
		const spy = stubFetch(() => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }));
		await apiJson('/api/v1/login/password', { method: 'POST', body: '{}' }, { auth: false });
		const [, init = {}] = spy.mock.calls[0]!;
		expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('surfaces the backend detail and status', async () => {
		stubFetch(() => new Response(JSON.stringify({ detail: 'table not found' }), { status: 404 }));
		await expect(apiJson('/api/v1/tables/9')).rejects.toMatchObject({
			name: 'LatticeCastError',
			message: 'table not found',
			status: 404
		});
	});

	it('rewrites an expired session into the sign-in copy', async () => {
		stubFetch(() => new Response('', { status: 401 }));
		await expect(apiJson('/api/v1/tables')).rejects.toMatchObject({ message: SESSION_EXPIRED_MESSAGE });
	});

	it('keeps a 401 detail on a call that carried no token', async () => {
		stubFetch(() => new Response(JSON.stringify({ detail: 'bad credentials' }), { status: 401 }));
		await expect(apiJson('/api/v1/login/password', {}, { auth: false })).rejects.toMatchObject({
			message: 'bad credentials'
		});
	});

	it('reports an unreachable backend as status 0', async () => {
		stubFetch(() => {
			throw new TypeError('network down');
		});
		await expect(apiJson('/api/v1/tables')).rejects.toMatchObject({ status: 0 });
	});

	it('returns undefined for 204', async () => {
		stubFetch(() => new Response(null, { status: 204 }));
		await expect(apiJson('/api/v1/tables/1/rows/2', { method: 'DELETE' })).resolves.toBeUndefined();
	});

	it('does not decode the body of a raw fetch', async () => {
		stubFetch(() => new Response('bytes', { status: 200 }));
		const response = await apiFetch('/api/v1/tables/1/rows/2/blob/c3');
		expect(await response.text()).toBe('bytes');
	});
});

describe('describeError', () => {
	it('prefers the LatticeCast message, then any Error, then the fallback', () => {
		expect(describeError(new LatticeCastError('nope', 400))).toBe('nope');
		expect(describeError(new Error('boom'))).toBe('boom');
		expect(describeError('weird', 'fallback')).toBe('fallback');
	});
});
