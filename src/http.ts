import { get } from 'svelte/store';
import { apiUrl } from './config.js';
import { authStore } from './auth/session.js';

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to continue.';

/** A failed LatticeCast request; `status` is 0 when the network was unreachable. */
export class LatticeCastError extends Error {
	readonly status: number;
	readonly path: string;

	constructor(message: string, status: number, path = '') {
		super(message);
		this.name = 'LatticeCastError';
		this.status = status;
		this.path = path;
	}
}

/** Older call sites in the apps use this name for the same error. */
export { LatticeCastError as BackendError };

/** The cached Bearer token, or a 401 error. */
export function accessToken(): string {
	const token = get(authStore)?.accessToken;
	if (!token) throw new LatticeCastError(SESSION_EXPIRED_MESSAGE, 401);
	return token;
}

/** Auth + JSON headers for the signed-in user. */
export function authHeaders(): Record<string, string> {
	return { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' };
}

/** Auth header only — for blobs, where the browser sets its own content type. */
export function bearerHeaders(): Record<string, string> {
	return { Authorization: `Bearer ${accessToken()}` };
}

/** Await-compatible aliases kept for the apps' original call sites. */
export const getAuthHeaders = async (): Promise<Record<string, string>> => authHeaders();
export const getBearerHeader = async (): Promise<Record<string, string>> => bearerHeaders();
export const bearerHeader = getBearerHeader;
export const getAccessToken = async (): Promise<string> => accessToken();

export interface RequestOptions {
	/** Attach the cached session token. Default true. */
	auth?: boolean;
	/** Send the token without a JSON content type (blob payloads). */
	bearer?: boolean;
}

async function readDetail(response: Response, authenticated: boolean): Promise<string> {
	// A 401 on a call that carried a token means the session died; on the login
	// call it only means the credentials were rejected.
	if (response.status === 401 && authenticated) return SESSION_EXPIRED_MESSAGE;
	try {
		const body = (await response.json()) as { detail?: unknown };
		if (typeof body.detail === 'string' && body.detail.trim()) return body.detail;
	} catch {
		// Non-JSON error body — fall through to the status copy.
	}
	return `LatticeCast request failed (HTTP ${response.status}).`;
}

/**
 * Every authenticated call goes through here, so no component or route builds a
 * request or a session header by itself.
 */
export async function apiFetch(
	path: string,
	init: RequestInit = {},
	options: RequestOptions = {}
): Promise<Response> {
	const { auth = true, bearer = false } = options;
	const headers: Record<string, string> = {};

	if (auth) Object.assign(headers, bearer ? bearerHeaders() : authHeaders());
	if (init.body && !(init.body instanceof FormData) && !bearer) {
		headers['Content-Type'] = 'application/json';
	}
	Object.assign(headers, (init.headers as Record<string, string> | undefined) ?? {});

	let response: Response;
	try {
		response = await fetch(apiUrl(path), { ...init, headers });
	} catch {
		throw new LatticeCastError('Could not reach LatticeCast. Check your connection and try again.', 0, path);
	}

	if (!response.ok) throw new LatticeCastError(await readDetail(response, auth), response.status, path);
	return response;
}

/** `apiFetch` + JSON decode (204 answers with undefined). */
export async function apiJson<T>(
	path: string,
	init: RequestInit = {},
	options: RequestOptions = {}
): Promise<T> {
	const response = await apiFetch(path, init, options);
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

/** Alias: the same authenticated JSON call under the apps' original name. */
export const requestJson = apiJson;

/** Turn any thrown value into a message a signed-in human can act on. */
export function describeError(error: unknown, fallback = 'The request failed.'): string {
	if (error instanceof LatticeCastError) return error.message;
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}
