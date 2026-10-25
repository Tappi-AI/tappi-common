import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

	it('exchanges the ticket at its own client id and clears the fragment', async () => {
		const { replaceState } = browserStub('#handoff=ticket-1');
		const spy = vi.fn(async (url: string, _init: RequestInit) => {
			if (url.endsWith('/api/v1/sso/browser-token')) {
				return new Response(JSON.stringify({ access_token: 'handoff-token' }), { status: 200 });
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
		expect(String(url)).toBe('https://table.novasplit.ai/api/v1/sso/browser-token');
		expect(JSON.parse(String(init.body))).toEqual({ handoff_ticket: 'ticket-1', client_id: 'm-sleep.tappi.ai' });
		expect(replaceState).toHaveBeenCalledWith({ from: 'sveltekit' }, '', '/');
		expect(get(authStore)).toMatchObject({
			provider: 'native-handoff',
			accessToken: 'handoff-token',
			userInfo: { sub: 'u-1', email: 'a@b.c', name: 'Ada' }
		});
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
