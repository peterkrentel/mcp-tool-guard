import { createM2mAgent, deleteM2mAgent, isAuth0MgmtConfigured } from "./auth0-mgmt.js";
import { auth0AudienceFromEnv, TokenVendor, tokenVendorFromEnv } from "./token-vendor.js";

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

  createAgent(name: string, scopes: string[]): Promise<CreatedAgentClient> {
    return createM2mAgent(name, scopes);
  }

  deleteAgent(clientId: string): Promise<void> {
    return deleteM2mAgent(clientId);
  }

  async vendToken(clientId: string, clientSecret: string): Promise<VendedToken> {
    if (!this.tokenVendor || !this.audience) {
      throw new Error("AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending");
    }
    return this.tokenVendor.vend(clientId, clientSecret, this.audience);
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
      throw new Error(
        "MCP_IDP_PROVIDER=entra is not yet implemented (tracked in BL-021)",
      );
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unhandled IdpProviderId: ${exhaustive as string}`);
    }
  }
}
