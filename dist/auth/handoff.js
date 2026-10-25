import { apiJson, LatticeCastError } from '../http.js';
import { fetchMe } from './login.js';
import { setSession } from './session.js';
const EXPIRED = 'App sign-in link expired or was already used.';
/**
 * Consume the Android app's fragment-only LatticeCast ticket, bind it to this
 * browser with PKCE, then exchange its code for LC's normal OAuth SSO token.
 * Returns whether a session was created.
 */
export async function acceptNativeHandoff(options) {
    const { clientId } = options;
    const surface = options.surface ?? 'mobile';
    if (surface !== 'mobile')
        return false;
    if (typeof window === 'undefined')
        return false;
    const hash = options.hash ?? window.location.hash;
    const ticket = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : '').get('handoff');
    if (!ticket)
        return false;
    await nextFrame();
    clearFragment();
    let body;
    try {
        const verifier = randomVerifier();
        const challenge = await pkceChallenge(verifier);
        const authorization = await apiJson('/api/v1/sso/browser-code', { method: 'POST', body: JSON.stringify({ handoff_ticket: ticket, client_id: clientId, code_challenge: challenge }) }, { auth: false });
        body = await apiJson('/api/v1/sso/token', { method: 'POST', body: JSON.stringify({ code: authorization.code, client_id: clientId, redirect_uri: authorization.redirect_uri, code_verifier: verifier }) }, { auth: false });
    }
    catch (error) {
        if (error instanceof LatticeCastError && error.status >= 400 && error.status < 500)
            throw new Error(EXPIRED);
        throw error;
    }
    const accessToken = body?.access_token;
    if (!accessToken)
        throw new Error('App sign-in returned no access token.');
    const identity = await fetchMe(accessToken);
    if (!identity)
        throw new Error('App sign-in could not resolve your account.');
    setSession({
        provider: 'native-handoff',
        accessToken,
        userInfo: {
            sub: identity.sub ?? identity.user_id,
            email: identity.email,
            name: identity.name ?? identity.user_name
        },
        role: identity.role ?? 'user',
        expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : undefined
    });
    return true;
}
function randomVerifier() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return base64Url(bytes);
}
async function pkceChallenge(verifier) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
}
function base64Url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function clearFragment() {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}
function nextFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function')
            requestAnimationFrame(() => resolve());
        else
            resolve();
    });
}
//# sourceMappingURL=handoff.js.map