import { get, writable, type Writable } from 'svelte/store';
import { sessionStorageKey } from '../config.js';
import type { LoginInfo } from './types.js';

const hasStorage = typeof localStorage !== 'undefined';
let bound = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to continue.';
export const sessionNotice = writable('');

function jwtExpiresAt(token: string): number | undefined {
	try {
		const payload = token.split('.')[1];
		if (!payload) return undefined;
		const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
		return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

function expiryOf(info: LoginInfo): number | undefined {
	return typeof info.expiresAt === 'number' && Number.isFinite(info.expiresAt)
		? info.expiresAt : jwtExpiresAt(info.accessToken);
}

function read(): LoginInfo | null {
	if (!hasStorage) return null;
	try {
		const raw = localStorage.getItem(sessionStorageKey());
		if (!raw) return null;
		const info = JSON.parse(raw) as LoginInfo;
		if (!info?.accessToken) return null;
		const expiresAt = expiryOf(info);
		if (expiresAt !== undefined && expiresAt <= Date.now()) {
			sessionNotice.set(SESSION_EXPIRED_MESSAGE);
			return null;
		}
		return expiresAt === undefined ? info : { ...info, expiresAt };
	} catch {
		return null;
	}
}

/**
 * Writable cache of the authenticated session. Only auth controllers write it,
 * and only `hydrateSession()` makes it survive a reload.
 */
export const authStore: Writable<LoginInfo | null> = writable<LoginInfo | null>(null);

export function checkSessionExpiry(): void {
	const current = get(authStore);
	const expiresAt = current ? expiryOf(current) : undefined;
	if (current && expiresAt !== undefined && expiresAt <= Date.now()) clearSession(SESSION_EXPIRED_MESSAGE);
}

function scheduleExpiry(info: LoginInfo | null): void {
	if (expiryTimer) clearTimeout(expiryTimer);
	expiryTimer = undefined;
	if (!info) return;
	const expiresAt = expiryOf(info);
	if (expiresAt === undefined) return;
	const remaining = expiresAt - Date.now();
	if (remaining <= 0) {
		checkSessionExpiry();
		return;
	}
	expiryTimer = setTimeout(() => {
		checkSessionExpiry();
		if (get(authStore) === info) scheduleExpiry(info);
	}, Math.min(remaining, 2_147_483_647));
}

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
		scheduleExpiry(value);
		const key = sessionStorageKey();
		if (value) localStorage.setItem(key, JSON.stringify(value));
		else localStorage.removeItem(key);
	});
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') checkSessionExpiry();
	});
}

export function setSession(info: LoginInfo | null): void {
	if (info) sessionNotice.set('');
	authStore.set(info);
	if (!bound) scheduleExpiry(info);
}

export function clearSession(reason = ''): void {
	sessionNotice.set(reason);
	authStore.set(null);
	if (!bound) scheduleExpiry(null);
}

/** A late 401 cannot log out a newer handoff or password login. */
export function clearSessionIfCurrent(requestSession: LoginInfo | null, reason = SESSION_EXPIRED_MESSAGE): boolean {
	if (!requestSession || get(authStore) !== requestSession) return false;
	clearSession(reason);
	return true;
}

export const logout = clearSession;
