import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { kvEnabled } from "./kv.js";

function gatewayRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith(`${sep}dist`) ? resolve(here, "..") : here;
}

const gatewayDir = gatewayRoot();
const repoRoot = resolve(gatewayDir, "..");

export function readPublicKeyPem(): string {
  const inline = process.env.MCP_GUARD_PUBLIC_KEY_PEM?.trim();
  if (inline) {
    return inline.replace(/\\n/g, "\n");
  }

  const candidates = [
    resolve(repoRoot, "ui/public/demo-public.pem"),
    resolve(repoRoot, "keys/demo-public.pem"),
  ];

  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // try next
    }
  }

  throw new Error(
    "No JWT public key found. Set MCP_GUARD_PUBLIC_KEY_PEM or run `make keys`.",
  );
}

export function guardEnabled(): boolean {
  return process.env.MCP_GUARD_ENABLED?.toLowerCase() !== "false";
}

/**
 * M2M immediate revocation enforcement.
 *
 * Defaults to `true` only when KV persistence is enabled because the revocation
 * check depends on server-side agent records.
 */
export function m2mRevocationEnabled(): boolean {
  const override = process.env.MCP_M2M_REVOCATION?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return kvEnabled();
}

/** Explicit demo-mode escape hatch for browser audit ingest. */
export function auditAgentTrustedMode(): boolean {
  return process.env.MCP_AUDIT_AGENT_TRUSTED_MODE?.toLowerCase() === "true";
}

/**
 * Derives the (issuer, audience, jwksUrl) implied by the active IdP provider's
 * own management/token-vending env vars, so operators don't have to duplicate
 * that info into MCP_JWT_* by hand. Returns undefined for any field that
 * can't be derived (missing provider vars, or a provider with no derivation
 * defined, e.g. "keycloak" — BL-041 deferred, no real support yet).
 */
function deriveJwtTrustFromProvider(provider: IdpProviderId): {
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
} {
  if (provider === "auth0") {
    const domain = process.env.AUTH0_DOMAIN?.trim();
    const audience = process.env.AUTH0_AUDIENCE?.trim();
    if (!domain) return {};
    const issuer = `https://${domain}/`.replace(/\/$/, "");
    return {
      issuer,
      audience,
      jwksUrl: `${issuer}/.well-known/jwks.json`,
    };
  }
  if (provider === "entra") {
    const tenantId = process.env.ENTRA_TENANT_ID?.trim();
    const apiAppId = process.env.ENTRA_API_APP_ID?.trim();
    if (!tenantId) return {};
    return {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: apiAppId,
      jwksUrl: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    };
  }
  // "keycloak": no derivation exists yet — fields fall through to "not set".
  return {};
}

/**
 * JWT trust config (issuer/audience/jwksUrl) used by the guard proxy to
 * validate incoming tokens.
 *
 * Precedence, per field independently:
 *   1. An explicit MCP_JWT_ISSUER / MCP_JWT_AUDIENCE / MCP_JWT_JWKS_URL wins,
 *      verbatim — today's exact behavior, preserved as an escape hatch.
 *   2. Otherwise, derive it from the active provider (MCP_IDP_PROVIDER) and
 *      that provider's own vars (AUTH0_DOMAIN/AUTH0_AUDIENCE or
 *      ENTRA_TENANT_ID/ENTRA_API_APP_ID). See deriveJwtTrustFromProvider().
 *
 * Note this is gateway-only: servers/flight/guard.py's JwtTrustConfig.from_env()
 * intentionally stays fully manual — the flight server never receives
 * MCP_IDP_PROVIDER or any provider-specific vars.
 *
 * Contract preserved: returns {} unless issuer+audience+jwksUrl all resolve
 * (explicit or derived) — never throws for incomplete config.
 */
export function jwtTrustFromEnv(): {
  jwtIssuer?: string;
  jwtAudience?: string;
  jwksUrl?: string;
} {
  const derived = deriveJwtTrustFromProvider(idpProviderIdFromEnv());

  const issuer =
    process.env.MCP_JWT_ISSUER?.trim().replace(/\/$/, "") || derived.issuer;
  const audience = process.env.MCP_JWT_AUDIENCE?.trim() || derived.audience;
  let jwksUrl = process.env.MCP_JWT_JWKS_URL?.trim() || derived.jwksUrl;
  if (issuer && !jwksUrl) {
    jwksUrl = `${issuer}/.well-known/jwks.json`;
  }
  if (issuer && audience && jwksUrl) {
    return { jwtIssuer: issuer, jwtAudience: audience, jwksUrl };
  }
  return {};
}

export function pendingLongPollMaxMs(): number {
  const raw = process.env.MCP_PENDING_LONGPOLL_MAX_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

export function corsAllowOrigins(): string[] {
  const raw = process.env.MCP_CORS_ORIGINS?.trim();
  if (raw === "*") return ["*"];
  if (raw) {
    return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
  }
  return [
    "https://mcp-tool-guard-ui.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

import type { IdpProviderId } from "./idp-adapter.js";

const KNOWN_IDP_PROVIDERS: IdpProviderId[] = ["auth0", "keycloak", "entra"];

/**
 * Selects the single active IdP provider for this deployment.
 * Defaults to "auth0" when unset — matches today's behavior, where the
 * Auth0 management/token-vending code paths are always attempted
 * unconditionally regardless of any other config.
 */
export function idpProviderIdFromEnv(): IdpProviderId {
  const raw = process.env.MCP_IDP_PROVIDER?.trim().toLowerCase();
  if (!raw) return "auth0";
  if (!KNOWN_IDP_PROVIDERS.includes(raw as IdpProviderId)) {
    throw new Error(
      `Unrecognized MCP_IDP_PROVIDER '${raw}' — expected one of: ${KNOWN_IDP_PROVIDERS.join(", ")}`,
    );
  }
  return raw as IdpProviderId;
}
