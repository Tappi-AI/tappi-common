import { writable, type Writable } from 'svelte/store';
import { sessionStorageKey } from '../config.js';
import type { LoginInfo } from './types.js';

const hasStorage = typeof localStorage !== 'undefined';
let bound = false;

function read(): LoginInfo | null {
	if (!hasStorage) return null;
	try {
		const raw = localStorage.getItem(sessionStorageKey());
		return raw ? (JSON.parse(raw) as LoginInfo) : null;
	} catch {
		return null;
	}
}

/**
 * Writable cache of the authenticated session. Only auth controllers write it,
 * and only `hydrateSession()` makes it survive a reload.
 */
export const authStore: Writable<LoginInfo | null> = writable<LoginInfo | null>(null);

/**
 * Load the persisted session for the configured origin and start persisting it.
 *
 * Called once from the app's `$lib/stores/auth.store` shim, after
 * `configureBackend`, so the storage key carries the right origin.
 */
export function hydrateSession(): void {
	if (bound) return;
	bound = true;
	authStore.set(read());
	if (!hasStorage) return;
	authStore.subscribe((value) => {
		const key = sessionStorageKey();
		if (value) localStorage.setItem(key, JSON.stringify(value));
		else localStorage.removeItem(key);
	});
}

export function setSession(info: LoginInfo | null): void {
	authStore.set(info);
}

/** Sign out clears the cached session; callers also reset the domain caches. */
export function clearSession(): void {
	authStore.set(null);
}

export const logout = clearSession;
