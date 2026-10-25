import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { configureBackend, resetBackendConfig } from '../src/config.js';
import { fetchMe, login, signInWithPassword } from '../src/auth/login.js';
import { authStore, clearSession } from '../src/auth/session.js';

beforeEach(() => {
	configureBackend({ backendDomain: 'https://table.novasplit.ai' });
	clearSession();
});

afterEach(() => {
	clearSession();
	resetBackendConfig();
	vi.unstubAllGlobals();
});

const token = {
	access_token: 'tok-9',
	refresh_token: 'refresh-9',
	expires_in: 3600,
	userinfo: { sub: 'u-9', email: 'a@b.c', name: 'Ada', picture: 'p.png' }
};

type FetchArgs = [RequestInfo | URL, RequestInit?];

function stub(handler: (url: string, init: RequestInit) => Response) {
	const spy = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) =>
		handler(String(input), init)
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

describe('login', () => {
	it('posts the password grant to the configured origin', async () => {
		const spy = stub(() => new Response(JSON.stringify(token), { status: 200 }));
		const body = await login('  ada  ', 'secret');
		expect(body.access_token).toBe('tok-9');
		const [url, init = {}] = spy.mock.calls[0]! as FetchArgs as [string, RequestInit];
		expect(url).toBe('https://table.novasplit.ai/api/v1/login/password');
		expect(JSON.parse(String(init.body))).toEqual({ user_name: 'ada', password: 'secret' });
	});

	it('keeps the backend detail on a rejected sign-in', async () => {
		stub(() => new Response(JSON.stringify({ detail: 'bad credentials' }), { status: 401 }));
		await expect(login('ada', 'nope')).rejects.toMatchObject({ message: 'bad credentials', status: 401 });
	});

	it('uses the shared copy when the backend says nothing useful', async () => {
		stub(() => new Response('', { status: 500 }));
		await expect(login('ada', 'nope')).rejects.toMatchObject({
			message: 'Sign in failed. Check your user name and password.'
		});
	});
});

describe('signInWithPassword', () => {
	it('publishes the session, including refresh fields the app persists', async () => {
		stub(() => new Response(JSON.stringify(token), { status: 200 }));
		const info = await signInWithPassword('ada', 'secret');
		expect(info).toMatchObject({
			provider: 'none',
			accessToken: 'tok-9',
			refreshToken: 'refresh-9',
			role: 'user',
			userInfo: { sub: 'u-9', email: 'a@b.c', name: 'Ada' }
		});
		expect(info.expiresAt).toBeGreaterThan(Date.now());
		expect(get(authStore)?.accessToken).toBe('tok-9');
	});

	it('leaves the session untouched when the backend rejects the sign-in', async () => {
		stub(() => new Response('', { status: 401 }));
		await expect(signInWithPassword('ada', 'nope')).rejects.toBeTruthy();
		expect(get(authStore)).toBeNull();
	});
});

describe('fetchMe', () => {
	it('reads the identity behind an explicit token', async () => {
		const spy = stub(() =>
			new Response(JSON.stringify({ user_id: 'u-9', sub: 'u-9', email: 'a@b.c' }), { status: 200 })
		);
		const me = await fetchMe('tok-9');
		expect(me?.user_id).toBe('u-9');
		const [, init = {}] = spy.mock.calls[0]! as FetchArgs as [string, RequestInit];
		expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer tok-9`);
	});

	it('answers null instead of throwing for a dead token', async () => {
		stub(() => new Response('', { status: 401 }));
		await expect(fetchMe('dead')).resolves.toBeNull();
	});
});
