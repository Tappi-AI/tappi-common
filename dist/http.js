import { get } from 'svelte/store';
import { apiUrl } from './config.js';
import { authStore } from './auth/session.js';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to continue.';
/** A failed LatticeCast request; `status` is 0 when the network was unreachable. */
export class LatticeCastError extends Error {
    status;
    path;
    constructor(message, status, path = '') {
        super(message);
        this.name = 'LatticeCastError';
        this.status = status;
        this.path = path;
    }
}
/** Older call sites in the apps use this name for the same error. */
export { LatticeCastError as BackendError };
/** The cached Bearer token, or a 401 error. */
export function accessToken() {
    const token = get(authStore)?.accessToken;
    if (!token)
        throw new LatticeCastError(SESSION_EXPIRED_MESSAGE, 401);
    return token;
}
/** Auth + JSON headers for the signed-in user. */
export function authHeaders() {
    return { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' };
}
/** Auth header only — for blobs, where the browser sets its own content type. */
export function bearerHeaders() {
    return { Authorization: `Bearer ${accessToken()}` };
}
/** Await-compatible aliases kept for the apps' original call sites. */
export const getAuthHeaders = async () => authHeaders();
export const getBearerHeader = async () => bearerHeaders();
export const bearerHeader = getBearerHeader;
export const getAccessToken = async () => accessToken();
async function readDetail(response, authenticated) {
    // A 401 on a call that carried a token means the session died; on the login
    // call it only means the credentials were rejected.
    if (response.status === 401 && authenticated)
        return SESSION_EXPIRED_MESSAGE;
    try {
        const body = (await response.json());
        if (typeof body.detail === 'string' && body.detail.trim())
            return body.detail;
    }
    catch {
        // Non-JSON error body — fall through to the status copy.
    }
    return `LatticeCast request failed (HTTP ${response.status}).`;
}
/**
 * Every authenticated call goes through here, so no component or route builds a
 * request or a session header by itself.
 */
export async function apiFetch(path, init = {}, options = {}) {
    const { auth = true, bearer = false } = options;
    const headers = {};
    if (auth)
        Object.assign(headers, bearer ? bearerHeaders() : authHeaders());
    if (init.body && !(init.body instanceof FormData) && !bearer) {
        headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, init.headers ?? {});
    let response;
    try {
        response = await fetch(apiUrl(path), { ...init, headers });
    }
    catch {
        throw new LatticeCastError('Could not reach LatticeCast. Check your connection and try again.', 0, path);
    }
    if (!response.ok)
        throw new LatticeCastError(await readDetail(response, auth), response.status, path);
    return response;
}
/** `apiFetch` + JSON decode (204 answers with undefined). */
export async function apiJson(path, init = {}, options = {}) {
    const response = await apiFetch(path, init, options);
    if (response.status === 204)
        return undefined;
    return (await response.json());
}
/** Alias: the same authenticated JSON call under the apps' original name. */
export const requestJson = apiJson;
/** Turn any thrown value into a message a signed-in human can act on. */
export function describeError(error, fallback = 'The request failed.') {
    if (error instanceof LatticeCastError)
        return error.message;
    if (error instanceof Error && error.message)
        return error.message;
    return fallback;
}
//# sourceMappingURL=http.js.map