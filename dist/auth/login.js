import { get } from 'svelte/store';
import { apiJson, LatticeCastError } from '../http.js';
import { authStore, setSession } from './session.js';
const SIGN_IN_FAILED = 'Sign in failed. Check your user name and password.';
/** Password sign-in. Unauthenticated: it is what creates the session. */
export async function login(userName, password) {
    try {
        return await apiJson('/api/v1/login/password', { method: 'POST', body: JSON.stringify({ user_name: userName.trim(), password }) }, { auth: false });
    }
    catch (error) {
        if (error instanceof LatticeCastError) {
            const informative = !error.message.startsWith('LatticeCast request failed');
            throw new LatticeCastError(informative ? error.message : SIGN_IN_FAILED, error.status, error.path);
        }
        throw error;
    }
}
/** The account behind a session token. `null` means the token is not valid. */
export async function fetchMe(accessToken) {
    try {
        if (!accessToken)
            return await apiJson('/api/v1/login/me');
        return await apiJson('/api/v1/login/me', { headers: { Authorization: `Bearer ${accessToken}` } }, { auth: false });
    }
    catch {
        return null;
    }
}
/**
 * Controller: password sign-in that also publishes the session.
 *
 * Only the LatticeCast response enters the cache, so callers just await this
 * and then reset their own domain caches.
 */
export async function signInWithPassword(userName, password) {
    const name = userName.trim();
    const tokens = await login(name, password);
    if (!tokens?.access_token) {
        throw new LatticeCastError('Sign in response did not include an access token.', 0, '/api/v1/login/password');
    }
    const info = {
        provider: 'none',
        accessToken: tokens.access_token,
        userInfo: {
            sub: tokens.userinfo?.sub ?? name,
            email: tokens.userinfo?.email,
            name: tokens.userinfo?.name ?? name,
            picture: tokens.userinfo?.picture
        },
        role: 'user'
    };
    if (tokens.refresh_token)
        info.refreshToken = tokens.refresh_token;
    if (tokens.id_token)
        info.idToken = tokens.id_token;
    if (tokens.expires_in)
        info.expiresAt = Date.now() + tokens.expires_in * 1000;
    setSession(info);
    return info;
}
/** The session this tab is currently acting as. */
export function currentSession() {
    return get(authStore);
}
/** Alias: Speak's controller publishes the session under this name. */
export const signIn = signInWithPassword;
//# sourceMappingURL=login.js.map