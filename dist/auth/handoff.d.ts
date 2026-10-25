export interface HandoffOptions {
    /** LatticeCast SSO client id registered for this web origin. */
    clientId: string;
    /** App surface of this build; only the mobile surface accepts a handoff. */
    surface?: 'pc' | 'mobile';
    /** Defaults to `window.location.hash`. */
    hash?: string;
}
/**
 * Consume the Android app's fragment-only LatticeCast ticket, if this launch is
 * an app handoff. Returns whether a session was created.
 */
export declare function acceptNativeHandoff(options: HandoffOptions): Promise<boolean>;
//# sourceMappingURL=handoff.d.ts.map