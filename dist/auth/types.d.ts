/** LatticeCast password login is the only session authority. */
export type AuthProvider = 'none' | 'native-handoff';
export interface UserInfo {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
}
/**
 * Cached session. One token belongs to one LatticeCast origin.
 *
 * `refreshToken` / `idToken` / `expiresAt` are optional because only apps that
 * persist a refresh token fill them in.
 */
export interface LoginInfo {
    provider: AuthProvider;
    accessToken: string;
    userInfo: UserInfo;
    role: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
}
/** `POST /api/v1/login/password` */
export interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    userinfo?: UserInfo;
}
/** `GET /api/v1/login/me` */
export interface MeResponse {
    user_id: string;
    sub?: string;
    email: string;
    name?: string;
    picture?: string;
    provider?: string;
    role?: string;
    user_name?: string;
}
//# sourceMappingURL=types.d.ts.map