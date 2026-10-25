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
});
