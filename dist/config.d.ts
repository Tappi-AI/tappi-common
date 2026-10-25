/** Point the shared layer at one LatticeCast origin. Idempotent. */
export declare function configureBackend(input: {
    backendDomain: string;
}): void;
/** The origin the shared layer currently talks to ('' means same-origin). */
export declare function currentBackendDomain(): string;
/** Absolute URL for a LatticeCast path such as `/api/v1/tables`. */
export declare function apiUrl(path: string): string;
/**
 * Sessions are stored per origin: a stage token must never be replayed against
 * production after a deploy changes the backend domain.
 */
export declare function sessionStorageKey(): string;
/** Test/teardown hook: forget the configured origin. */
export declare function resetBackendConfig(): void;
//# sourceMappingURL=config.d.ts.map