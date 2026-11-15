import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key)
	};
}

const storage = memoryStorage();

beforeEach(() => {
	vi.resetModules();
	storage.map.clear();
	vi.stubGlobal('localStorage', storage);
});

describe('session persistence', () => {
	it('reads and writes the slot of the configured origin', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		storage.map.set(
			'loginInfo:https://table.novasplit.ai',
			JSON.stringify({ provider: 'none', accessToken: 'persisted', userInfo: { sub: 'u' }, role: 'user' })
		);

		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)?.accessToken).toBe('persisted');
	});

	it('writes a new session and clears it on sign-out', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
		const session = await import('../src/auth/session.js');
		session.hydrateSession();

		session.setSession({ provider: 'none', accessToken: 'tok', userInfo: { sub: 'u' }, role: 'user' });
		expect(storage.map.get('loginInfo:https://stage-table.novasplit.ai')).toContain('tok');

		session.logout();
		expect(storage.map.has('loginInfo:https://stage-table.novasplit.ai')).toBe(false);
	});

	it('never reads another origin\'s slot', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		storage.map.set(
			'loginInfo:https://stage-table.novasplit.ai',
			JSON.stringify({ provider: 'none', accessToken: 'stage-token', userInfo: { sub: 'u' }, role: 'user' })
		);

		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)).toBeNull();
	});

	it('starts empty when stored JSON is corrupt', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://table.novasplit.ai' });
		storage.map.set('loginInfo:https://table.novasplit.ai', '{not json');

		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)).toBeNull();
	});

	it('drops a stored session whose access token has expired', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
		const key = 'loginInfo:https://stage-table.novasplit.ai';
		storage.map.set(key, JSON.stringify({
			provider: 'native-handoff', accessToken: 'stale', userInfo: { sub: 'u' }, role: 'user', expiresAt: Date.now() - 1000
		}));
		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)).toBeNull();
		expect(storage.map.has(key)).toBe(false);
	});

	it('drops an old session without expiresAt using the JWT exp', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
		const key = 'loginInfo:https://stage-table.novasplit.ai';
		const token = `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10 }))}.x`;
		storage.map.set(key, JSON.stringify({ provider: 'native-handoff', accessToken: token, userInfo: { sub: 'u' }, role: 'user' }));
		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)).toBeNull();
		expect(get(session.sessionNotice)).toBe(session.SESSION_EXPIRED_MESSAGE);
		expect(storage.map.has(key)).toBe(false);
	});

	it('adds expiry to a still-valid old JWT and rechecks after resume', async () => {
		const config = await import('../src/config.js');
		config.configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
		const key = 'loginInfo:https://stage-table.novasplit.ai';
		const token = `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 }))}.x`;
		storage.map.set(key, JSON.stringify({ provider: 'native-handoff', accessToken: token, userInfo: { sub: 'u' }, role: 'user' }));
		const session = await import('../src/auth/session.js');
		session.hydrateSession();
		const { get } = await import('svelte/store');
		expect(get(session.authStore)?.expiresAt).toBeGreaterThan(Date.now());
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
		session.checkSessionExpiry();
		expect(get(session.authStore)).toBeNull();
		vi.restoreAllMocks();
	});

	it('expires a live handoff and allows a new login to clear the notice', async () => {
		vi.useFakeTimers();
		try {
			const config = await import('../src/config.js');
			config.configureBackend({ backendDomain: 'https://stage-table.novasplit.ai' });
			const session = await import('../src/auth/session.js');
			session.hydrateSession();
			const { get } = await import('svelte/store');
			session.setSession({ provider: 'native-handoff', accessToken: 'short', userInfo: { sub: 'u' }, role: 'user', expiresAt: Date.now() + 1000 });
			vi.advanceTimersByTime(1001);
			expect(get(session.authStore)).toBeNull();
			expect(get(session.sessionNotice)).toBe(session.SESSION_EXPIRED_MESSAGE);
			session.setSession({ provider: 'none', accessToken: 'new', userInfo: { sub: 'u' }, role: 'user' });
			expect(get(session.sessionNotice)).toBe('');
		} finally { vi.useRealTimers(); }
	});
});
