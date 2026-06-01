import { Auth0Client } from "@auth0/auth0-spa-js";

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
        redirect_uri: window.location.origin,
      },
      cacheLocation: "localstorage",
    });
  }
  return client;
}

export async function handleAuthRedirect(): Promise<void> {
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
