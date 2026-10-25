import { type Writable } from 'svelte/store';
import type { LoginInfo } from './types.js';
/**
 * Writable cache of the authenticated session. Only auth controllers write it,
 * and only `hydrateSession()` makes it survive a reload.
 */
export declare const authStore: Writable<LoginInfo | null>;
/**
 * Load the persisted session for the configured origin and start persisting it.
 *
 * Called once from the app's `$lib/stores/auth.store` shim, after
 * `configureBackend`, so the storage key carries the right origin.
 */
export declare function hydrateSession(): void;
export declare function setSession(info: LoginInfo | null): void;
/** Sign out clears the cached session; callers also reset the domain caches. */
export declare function clearSession(): void;
export declare const logout: typeof clearSession;
//# sourceMappingURL=session.d.ts.map