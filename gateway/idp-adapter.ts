import { createM2mAgent, deleteM2mAgent, isAuth0MgmtConfigured } from "./auth0-mgmt.js";
import { auth0AudienceFromEnv, TokenVendor, tokenVendorFromEnv } from "./token-vendor.js";
import { entraTokenVendorFromEnv, entraApiAppIdFromEnv } from "./entra-token-vendor.js";
import { isEntraMgmtConfigured, createEntraAgent, deleteEntraAgent } from "./entra-mgmt.js";

export type IdpProviderId = "auth0" | "keycloak" | "entra";

export interface CreatedAgentClient {
  clientId: string;
  clientSecret: string;
  name: string;
}

export interface VendedToken {
  token: string;
  expiresIn: number;
}

/**
 * Translates the gateway's generic agent-lifecycle/token-vending operations
 * into the active IdP's own management API. Exactly one implementation is
 * constructed per deployment — see docs/superpowers/specs/2026-07-18-idp-trust-model-design.md.
 */
export interface IdpAdapter {
  readonly providerId: IdpProviderId;
  /** Whether agent create/delete (management API) has its required config. */
  isManagementConfigured(): boolean;
  /** Whether client_credentials token vending has its required config. */
  isVendingConfigured(): boolean;
  /** Provider-specific description of the env vars missing when isVendingConfigured() is false. */
  vendingConfigError(): string;
  createAgent(name: string, scopes: string[]): Promise<CreatedAgentClient>;
  deleteAgent(clientId: string): Promise<void>;
  vendToken(clientId: string, clientSecret: string): Promise<VendedToken>;
  invalidateToken(clientId: string): void;
}

/**
 * Auth0 implementation — wraps the existing auth0-mgmt.ts / token-vendor.ts
 * functions unchanged so behavior (status codes, error message strings) is
 * preserved exactly; this class is purely a seam for injection.
 */
export class Auth0IdpAdapter implements IdpAdapter {
  readonly providerId: IdpProviderId = "auth0";
  private readonly tokenVendor: TokenVendor | null;
  private readonly audience: string | null;

  constructor() {
    this.tokenVendor = tokenVendorFromEnv();
    this.audience = auth0AudienceFromEnv();
  }

  isManagementConfigured(): boolean {
    return isAuth0MgmtConfigured();
  }

  isVendingConfigured(): boolean {
    return Boolean(this.tokenVendor && this.audience);
  }

  vendingConfigError(): string {
    return "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending";
  }

  createAgent(name: string, scopes: string[]): Promise<CreatedAgentClient> {
    return createM2mAgent(name, scopes);
  }

  deleteAgent(clientId: string): Promise<void> {
    return deleteM2mAgent(clientId);
  }

  async vendToken(clientId: string, clientSecret: string): Promise<VendedToken> {
    if (!this.tokenVendor || !this.audience) {
      throw new Error(this.vendingConfigError());
    }
    return this.tokenVendor.vend(clientId, clientSecret, this.audience);
  }

  invalidateToken(clientId: string): void {
    this.tokenVendor?.invalidate(clientId);
  }
}

/**
 * Entra ID implementation — wraps the existing entra-mgmt.ts / entra-token-vendor.ts
 * functions unchanged so behavior (status codes, error message strings) is
 * preserved exactly; this class is purely a seam for injection.
 */
export class EntraIdpAdapter implements IdpAdapter {
  readonly providerId: IdpProviderId = "entra";
  private readonly tokenVendor: ReturnType<typeof entraTokenVendorFromEnv>;
  private readonly apiAppId: string | null;

  constructor() {
    this.tokenVendor = entraTokenVendorFromEnv();
    this.apiAppId = entraApiAppIdFromEnv();
  }

  isManagementConfigured(): boolean {
    return isEntraMgmtConfigured();
  }

  isVendingConfigured(): boolean {
    return Boolean(this.tokenVendor && this.apiAppId);
  }

  vendingConfigError(): string {
    return "ENTRA_TENANT_ID and ENTRA_API_APP_ID required for token vending";
  }

  createAgent(name: string, scopes: string[]): Promise<CreatedAgentClient> {
    return createEntraAgent(name, scopes);
  }

  deleteAgent(clientId: string): Promise<void> {
    return deleteEntraAgent(clientId);
  }

  async vendToken(clientId: string, clientSecret: string): Promise<VendedToken> {
    if (!this.tokenVendor || !this.apiAppId) {
      throw new Error(this.vendingConfigError());
    }
    return this.tokenVendor.vend(clientId, clientSecret, this.apiAppId);
  }

  invalidateToken(clientId: string): void {
    this.tokenVendor?.invalidate(clientId);
  }
}

/**
 * Constructs the single active IdP adapter. Fails loudly (throws) rather
 * than silently falling back when the requested provider has no
 * implementation yet — see docs/superpowers/specs/2026-07-18-idp-trust-model-design.md.
 */
export function buildIdpAdapter(providerId: IdpProviderId): IdpAdapter {
  switch (providerId) {
    case "auth0":
      return new Auth0IdpAdapter();
    case "keycloak":
      throw new Error(
        "MCP_IDP_PROVIDER=keycloak is not yet implemented (tracked in BL-041)",
      );
    case "entra":
      return new EntraIdpAdapter();
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unhandled IdpProviderId: ${exhaustive as string}`);
    }
  }
}
