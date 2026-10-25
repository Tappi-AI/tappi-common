import type { LoginInfo, MeResponse, TokenResponse } from './types.js';
/** Password sign-in. Unauthenticated: it is what creates the session. */
export declare function login(userName: string, password: string): Promise<TokenResponse>;
/** The account behind a session token. `null` means the token is not valid. */
export declare function fetchMe(accessToken?: string): Promise<MeResponse | null>;
/**
 * Controller: password sign-in that also publishes the session.
 *
 * Only the LatticeCast response enters the cache, so callers just await this
 * and then reset their own domain caches.
 */
export declare function signInWithPassword(userName: string, password: string): Promise<LoginInfo>;
/** The session this tab is currently acting as. */
export declare function currentSession(): LoginInfo | null;
/** Alias: Speak's controller publishes the session under this name. */
export declare const signIn: typeof signInWithPassword;
//# sourceMappingURL=login.d.ts.map