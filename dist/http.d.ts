export declare const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";
/** A failed LatticeCast request; `status` is 0 when the network was unreachable. */
export declare class LatticeCastError extends Error {
    readonly status: number;
    readonly path: string;
    constructor(message: string, status: number, path?: string);
}
/** Older call sites in the apps use this name for the same error. */
export { LatticeCastError as BackendError };
/** The cached Bearer token, or a 401 error. */
export declare function accessToken(): string;
/** Auth + JSON headers for the signed-in user. */
export declare function authHeaders(): Record<string, string>;
/** Auth header only — for blobs, where the browser sets its own content type. */
export declare function bearerHeaders(): Record<string, string>;
/** Await-compatible aliases kept for the apps' original call sites. */
export declare const getAuthHeaders: () => Promise<Record<string, string>>;
export declare const getBearerHeader: () => Promise<Record<string, string>>;
export declare const bearerHeader: () => Promise<Record<string, string>>;
export declare const getAccessToken: () => Promise<string>;
export interface RequestOptions {
    /** Attach the cached session token. Default true. */
    auth?: boolean;
    /** Send the token without a JSON content type (blob payloads). */
    bearer?: boolean;
}
/**
 * Every authenticated call goes through here, so no component or route builds a
 * request or a session header by itself.
 */
export declare function apiFetch(path: string, init?: RequestInit, options?: RequestOptions): Promise<Response>;
/** `apiFetch` + JSON decode (204 answers with undefined). */
export declare function apiJson<T>(path: string, init?: RequestInit, options?: RequestOptions): Promise<T>;
/** Alias: the same authenticated JSON call under the apps' original name. */
export declare const requestJson: typeof apiJson;
/** Turn any thrown value into a message a signed-in human can act on. */
export declare function describeError(error: unknown, fallback?: string): string;
//# sourceMappingURL=http.d.ts.map