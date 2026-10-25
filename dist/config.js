/**
 * The LatticeCast origin each app injects at start-up.
 *
 * Nothing here reads `import.meta.env`: an app resolves its own build-time
 * environment (development goes through the Vite proxy, so its base is the
 * empty string) and hands the result over once, from `$lib/backend/config`.
 */
let backendDomain = '';
/** Point the shared layer at one LatticeCast origin. Idempotent. */
export function configureBackend(input) {
    backendDomain = input.backendDomain.replace(/\/+$/, '');
}
/** The origin the shared layer currently talks to ('' means same-origin). */
export function currentBackendDomain() {
    return backendDomain;
}
/** Absolute URL for a LatticeCast path such as `/api/v1/tables`. */
export function apiUrl(path) {
    if (!path.startsWith('/')) {
        throw new Error(`LatticeCast paths start with "/" — got "${path}"`);
    }
    return `${backendDomain}${path}`;
}
/**
 * Sessions are stored per origin: a stage token must never be replayed against
 * production after a deploy changes the backend domain.
 */
export function sessionStorageKey() {
    return `loginInfo:${backendDomain}`;
}
/** Test/teardown hook: forget the configured origin. */
export function resetBackendConfig() {
    backendDomain = '';
}
//# sourceMappingURL=config.js.map