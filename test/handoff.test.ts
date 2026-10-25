import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { get } from 'svelte/store';
import { configureBackend, resetBackendConfig } from '../src/config.js';
import { acceptNativeHandoff } from '../src/auth/handoff.js';
import { authStore, clearSession } from '../src/auth/session.js';

function browserStub(hash: string) {
	const replaceState = vi.fn();
	vi.stubGlobal('window', { location: { hash, pathname: '/', search: '' } });
	vi.stubGlobal('location', { pathname: '/', search: '', hash });
	vi.stubGlobal('history', { state: { from: 'sveltekit' }, replaceState });
	vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
	return { replaceState };
}

beforeEach(() => {
	configureBackend({ backendDomain: 'https://table.novasplit.ai' });
	clearSession();
	vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
	clearSession();
	resetBackendConfig();
	vi.unstubAllGlobals();
});

describe('acceptNativeHandoff', () => {
	it('ignores a launch on the desktop surface', async () => {
		browserStub('#handoff=ticket-1');
		vi.stubGlobal('fetch', vi.fn());
		await expect(acceptNativeHandoff({ clientId: 'm-sleep.tappi.ai', surface: 'pc' })).resolves.toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('ignores a launch with no ticket', async () => {
		browserStub('');
		vi.stubGlobal('fetch', vi.fn());
		await expect(acceptNativeHandoff({ clientId: 'm-sleep.tappi.ai' })).resolves.toBe(false);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('exchanges the ticket for a PKCE-bound authorization code and long-lived token', async () => {
		const { replaceState } = browserStub('#handoff=ticket-1');
		const spy = vi.fn(async (url: string, _init: RequestInit) => {
			if (url.endsWith('/api/v1/sso/browser-code')) {
				return new Response(JSON.stringify({ code: 'authorization-code', redirect_uri: 'https://m-sleep.tappi.ai/' }), { status: 200 });
			}
			if (url.endsWith('/api/v1/sso/token')) {
				return new Response(JSON.stringify({ access_token: 'handoff-token', expires_in: 86400 }), { status: 200 });
			}
			return new Response(
				JSON.stringify({ user_id: 'u-1', sub: 'u-1', email: 'a@b.c', name: 'Ada', role: 'user' }),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', spy);

		await expect(
			acceptNativeHandoff({ clientId: 'm-sleep.tappi.ai', surface: 'mobile' })
		).resolves.toBe(true);

		const [url, init = {}] = spy.mock.calls[0]!;
		expect(String(url)).toBe('https://table.novasplit.ai/api/v1/sso/browser-code');
		const request = JSON.parse(String(init.body));
		expect(request).toMatchObject({ handoff_ticket: 'ticket-1', client_id: 'm-sleep.tappi.ai' });
		expect(request.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const [tokenUrl, tokenInit = {}] = spy.mock.calls[1]!;
		expect(String(tokenUrl)).toBe('https://table.novasplit.ai/api/v1/sso/token');
		const exchange = JSON.parse(String(tokenInit.body));
		expect(exchange).toMatchObject({ code: 'authorization-code', client_id: 'm-sleep.tappi.ai', redirect_uri: 'https://m-sleep.tappi.ai/' });
		const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(exchange.code_verifier));
		expect(Buffer.from(digest).toString('base64url')).toBe(request.code_challenge);
		expect(replaceState).toHaveBeenCalledWith({ from: 'sveltekit' }, '', '/');
		expect(get(authStore)).toMatchObject({
			provider: 'native-handoff',
			accessToken: 'handoff-token',
			userInfo: { sub: 'u-1', email: 'a@b.c', name: 'Ada' }
		});
		expect(get(authStore)?.expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
	});

	it('reports a spent link instead of the raw backend status', async () => {
		browserStub('#handoff=spent');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ detail: 'gone' }), { status: 410 }))
		);
		await expect(acceptNativeHandoff({ clientId: 'm-sleep.tappi.ai' })).rejects.toThrow(
			'App sign-in link expired or was already used.'
		);
		expect(get(authStore)).toBeNull();
	});
});
