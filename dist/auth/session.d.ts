import { type Writable } from 'svelte/store';
import type { LoginInfo } from './types.js';
export declare const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";
export declare const sessionNotice: Writable<string>;
/**
 * Writable cache of the authenticated session. Only auth controllers write it,
 * and only `hydrateSession()` makes it survive a reload.
 */
export declare const authStore: Writable<LoginInfo | null>;
export declare function checkSessionExpiry(): void;
/**
 * Load the persisted session for the configured origin and start persisting it.
 *
 * Called once from the app's `$lib/stores/auth.store` shim, after
 * `configureBackend`, so the storage key carries the right origin.
 */
export declare function hydrateSession(): void;
export declare function setSession(info: LoginInfo | null): void;
export declare function clearSession(reason?: string): void;
/** A late 401 cannot log out a newer handoff or password login. */
export declare function clearSessionIfCurrent(requestSession: LoginInfo | null, reason?: string): boolean;
export declare const logout: typeof clearSession;
//# sourceMappingURL=session.d.ts.map