export interface HandoffOptions {
    /** LatticeCast SSO client id registered for this web origin. */
    clientId: string;
    /** App surface of this build; only the mobile surface accepts a handoff. */
    surface?: 'pc' | 'mobile';
    /** Defaults to `window.location.hash`. */
    hash?: string;
}
/**
 * Consume the Android app's fragment-only LatticeCast ticket, bind it to this
 * browser with PKCE, then exchange its code for LC's normal OAuth SSO token.
 * Returns whether a session was created.
 */
export declare function acceptNativeHandoff(options: HandoffOptions): Promise<boolean>;
//# sourceMappingURL=handoff.d.ts.map