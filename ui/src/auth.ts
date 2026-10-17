import { Auth0Client } from "@auth0/auth0-spa-js";
import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from "@azure/msal-browser";
import { normalizeIdpProvider, type IdpProviderId } from "./auth-provider.js";

export function getIdpProvider(): IdpProviderId {
  return normalizeIdpProvider(import.meta.env.VITE_IDP_PROVIDER);
}

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  apiAppId: string;
}

export function getEntraConfig(): EntraConfig | null {
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID?.trim();
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID?.trim();
  const apiAppId = import.meta.env.VITE_ENTRA_API_APP_ID?.trim();
  if (!tenantId || !clientId || !apiAppId) return null;
  return { tenantId, clientId, apiAppId };
}

export function jwtTrustFromEntra(config: EntraConfig): JwtTrustOptions {
  return {
    jwtIssuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    // Bare GUID, not `api://<guid>`: scripts/entra-setup.sh sets
    // api.requestedAccessTokenVersion: 2 on the API app, so Entra mints v2
    // access tokens whose `aud` claim is the bare API app ID. The `api://`
    // form is only correct for the *scope request* syntax (see
    // loginWithEntra()/getEntraAccessToken() below), not the resulting `aud`.
    jwtAudience: config.apiAppId,
    jwksUrl: `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
  };
}

let msalClient: PublicClientApplication | null = null;
let msalAccount: AccountInfo | null = null;

async function getMsalClient(): Promise<PublicClientApplication> {
  const config = getEntraConfig();
  if (!config) {
    throw new Error("Entra is not configured (set VITE_ENTRA_* env vars)");
  }
  if (!msalClient) {
    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: "localStorage" },
    };
    msalClient = new PublicClientApplication(msalConfig);
    await msalClient.initialize();
    const redirectResult = await msalClient.handleRedirectPromise();
    if (redirectResult?.account) msalAccount = redirectResult.account;
  }
  return msalClient;
}

export async function isEntraAuthenticated(): Promise<boolean> {
  if (!getEntraConfig()) return false;
  const client = await getMsalClient();
  const accounts = client.getAllAccounts();
  if (accounts.length > 0) msalAccount = accounts[0];
  return msalAccount !== null;
}

export async function loginWithEntra(): Promise<void> {
  const client = await getMsalClient();
  const config = getEntraConfig();
  if (!config) throw new Error("Entra is not configured");
  // `api://<apiAppId>/access_as_user` — the delegated scope registered by
  // scripts/entra-setup.sh (oauth2PermissionScopes) and pre-consented for
  // this SPA app. The `api://` prefix is the correct *scope request* syntax
  // here regardless of token version; it does not affect the resulting
  // `aud` claim shape (see jwtTrustFromEntra() above, which is bare-GUID).
  await client.loginRedirect({ scopes: [`api://${config.apiAppId}/access_as_user`] });
}

export async function logoutEntra(): Promise<void> {
  const client = await getMsalClient();
  await client.logoutRedirect();
}

export async function getEntraAccessToken(): Promise<string> {
  const client = await getMsalClient();
  const config = getEntraConfig();
  if (!config || !msalAccount) throw new Error("Not signed in with Entra");
  const scopes = [`api://${config.apiAppId}/access_as_user`];
  try {
    const result = await client.acquireTokenSilent({ scopes, account: msalAccount });
    return result.accessToken;
  } catch (err) {
    if (!(err instanceof InteractionRequiredAuthError)) throw err;
    // Cached session is stale/expired. Fall back to the same redirect-based
    // flow loginWithEntra() uses (this app never uses MSAL's popup flow) so
    // the operator is routed back through sign-in instead of hitting a
    // silent, unexplained failure on every subsequent admin action.
    await client.acquireTokenRedirect({ scopes, account: msalAccount });
    // acquireTokenRedirect() navigates the page away; this is unreachable
    // in practice, but keeps the return type honest if it isn't.
    throw err;
  }
}

export async function getEntraUserLabel(): Promise<string> {
  return msalAccount?.username ?? msalAccount?.name ?? "Signed in";
}

export interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
}

export interface JwtTrustOptions {
  jwtIssuer: string;
  jwtAudience: string;
  jwksUrl: string;
}

function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function getAuth0Config(): Auth0Config | null {
  const domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim();
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim();
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE?.trim();
  if (!domain || !clientId || !audience) return null;
  return { domain: normalizeDomain(domain), clientId, audience };
}

export function isGuestDemoEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_GUEST_DEMO;
  if (raw === undefined || raw === "") return true;
  return raw.toLowerCase() !== "false";
}

export function jwtTrustFromAuth0(config: Auth0Config): JwtTrustOptions {
  const host = normalizeDomain(config.domain);
  return {
    jwtIssuer: `https://${host}`,
    jwtAudience: config.audience,
    jwksUrl: `https://${host}/.well-known/jwks.json`,
  };
}

let client: Auth0Client | null = null;

export async function getAuth0Client(): Promise<Auth0Client> {
  const config = getAuth0Config();
  if (!config) {
    throw new Error("Auth0 is not configured (set VITE_AUTH0_* env vars)");
  }
  if (!client) {
    client = new Auth0Client({
      domain: config.domain,
      clientId: config.clientId,
      authorizationParams: {
        audience: config.audience,
        redirect_uri: window.location.origin + window.location.pathname,
      },
      cacheLocation: "localstorage",
    });
  }
  return client;
}

export async function handleAuthRedirect(): Promise<void> {
  if (getIdpProvider() === "entra") {
    await getMsalClient(); // handleRedirectPromise() runs inside its lazy init, see getMsalClient() above
    return;
  }
  const config = getAuth0Config();
  if (!config) return;

  const query = window.location.search;
  if (!query.includes("code=") && !query.includes("state=")) return;

  const auth0 = await getAuth0Client();
  await auth0.handleRedirectCallback();
  window.history.replaceState({}, document.title, window.location.pathname);
}

export async function isAuth0Authenticated(): Promise<boolean> {
  if (!getAuth0Config()) return false;
  const auth0 = await getAuth0Client();
  return auth0.isAuthenticated();
}

export async function loginWithAuth0(): Promise<void> {
  const auth0 = await getAuth0Client();
  await auth0.loginWithRedirect();
}

export async function logoutAuth0(): Promise<void> {
  const auth0 = await getAuth0Client();
  await auth0.logout({ logoutParams: { returnTo: window.location.origin } });
}

export async function getAuth0AccessToken(): Promise<string> {
  const auth0 = await getAuth0Client();
  return auth0.getTokenSilently();
}

export async function getAuth0UserLabel(): Promise<string> {
  const auth0 = await getAuth0Client();
  const user = await auth0.getUser();
  return user?.email ?? user?.name ?? "Signed in";
}

export const GATEWAY_ADMIN_PERMISSION = "gateway:admin";

export function permissionsFromAccessToken(token: string): string[] {
  try {
    const segment = token.split(".")[1];
    if (!segment) return [];
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded)) as { permissions?: string[] };
    return Array.isArray(payload.permissions) ? payload.permissions.map(String) : [];
  } catch {
    return [];
  }
}

export function tokenHasPermission(token: string, permission: string): boolean {
  const perms = permissionsFromAccessToken(token);
  if (perms.includes(permission)) return true;
  const [resource] = permission.split(":");
  return perms.includes(`${resource}:*`) || perms.includes("*");
}

export async function hasGatewayAdminPermission(): Promise<boolean> {
  if (!getAuth0Config()) return false;
  if (!(await isAuth0Authenticated())) return false;
  const token = await getAuth0AccessToken();
  return tokenHasPermission(token, GATEWAY_ADMIN_PERMISSION);
}

// --- Generic, provider-dispatching functions used by the rest of the UI ---

export function getIdpConfig(): Auth0Config | EntraConfig | null {
  return getIdpProvider() === "entra" ? getEntraConfig() : getAuth0Config();
}

export function getSignInLabel(): string {
  return getIdpProvider() === "entra" ? "Sign in with Microsoft" : "Sign in with Auth0";
}

export async function isSignedIn(): Promise<boolean> {
  return getIdpProvider() === "entra" ? isEntraAuthenticated() : isAuth0Authenticated();
}

export async function login(): Promise<void> {
  if (getIdpProvider() === "entra") await loginWithEntra();
  else await loginWithAuth0();
}

export async function logout(): Promise<void> {
  if (getIdpProvider() === "entra") await logoutEntra();
  else await logoutAuth0();
}

export async function getAccessToken(): Promise<string> {
  return getIdpProvider() === "entra" ? getEntraAccessToken() : getAuth0AccessToken();
}

export async function getUserLabel(): Promise<string> {
  return getIdpProvider() === "entra" ? getEntraUserLabel() : getAuth0UserLabel();
}

export async function hasGatewayAdminAccess(): Promise<boolean> {
  if (!getIdpConfig()) return false;
  if (!(await isSignedIn())) return false;
  const token = await getAccessToken();
  if (getIdpProvider() === "entra") {
    return tokenHasEntraRole(token, GATEWAY_ADMIN_PERMISSION);
  }
  return tokenHasPermission(token, GATEWAY_ADMIN_PERMISSION);
}

export function jwtTrustFromIdpConfig(): JwtTrustOptions | Record<string, never> {
  if (getIdpProvider() === "entra") {
    const entraConfig = getEntraConfig();
    return entraConfig ? jwtTrustFromEntra(entraConfig) : {};
  }
  const auth0Config = getAuth0Config();
  return auth0Config ? jwtTrustFromAuth0(auth0Config) : {};
}

export function rolesFromAccessToken(token: string): string[] {
  try {
    const segment = token.split(".")[1];
    if (!segment) return [];
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded)) as { roles?: string[] };
    return Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  } catch {
    return [];
  }
}

export function tokenHasEntraRole(token: string, role: string): boolean {
  const roles = rolesFromAccessToken(token);
  if (roles.includes(role)) return true;
  const [resource] = role.split(":");
  return roles.includes(`${resource}:*`) || roles.includes("*");
}
