/** Entra ID client_credentials token vending with in-memory cache. */

export interface VendedToken {
  token: string;
  expiresIn: number;
}

interface CacheEntry {
  token: string;
  expiresAt: number;
}

// Live-verified: a freshly-minted client secret (createEntraAgent()'s
// addPassword call) is sometimes not yet valid for authentication at the
// token endpoint, even though the secret value itself is correct — same
// family of Microsoft eventual-consistency lag as every other step in agent
// creation, just at the identity-platform (STS) layer instead of Graph.
// Surfaces as AADSTS7000215 ("Invalid client secret provided") — Microsoft's
// generic error for both a genuinely wrong secret AND a not-yet-propagated
// correct one, so this can't be distinguished by error text alone. Retrying
// a handful of times with backoff costs nothing extra in the genuinely-wrong
// case (the caller just sees the same failure ~15s later instead of
// immediately) but resolves the propagation-lag case, which has now
// reproduced twice on a real tenant.
const TOKEN_CONSISTENCY_RETRY_DELAYS_MS = [2000, 4000, 8000];

function isInvalidClientSecretError(status: number, body: string): boolean {
  return status === 401 && body.includes("AADSTS7000215");
}

export class EntraTokenVendor {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly tenantId: string) {}

  /**
   * POST /token — exchange M2M credentials for an Entra access token (server-side).
   * Auth required: no; body carries client credentials.
   */
  async vend(
    clientId: string,
    clientSecret: string,
    apiAppId: string,
  ): Promise<VendedToken> {
    const cached = this.cache.get(clientId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return {
        token: cached.token,
        expiresIn: Math.floor((cached.expiresAt - now) / 1000),
      };
    }

    const requestToken = () =>
      fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: `api://${apiAppId}/.default`,
          grant_type: "client_credentials",
        }),
      });

    let res = await requestToken();
    for (let attempt = 0; !res.ok; attempt++) {
      const body = await res.text();
      if (!isInvalidClientSecretError(res.status, body) || attempt >= TOKEN_CONSISTENCY_RETRY_DELAYS_MS.length) {
        throw new Error(`Entra token request failed: ${res.status} ${body}`);
      }
      await new Promise((resolve) => setTimeout(resolve, TOKEN_CONSISTENCY_RETRY_DELAYS_MS[attempt]));
      res = await requestToken();
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const skewSec = 60;
    const expiresAt = now + Math.max(0, (data.expires_in - skewSec) * 1000);
    this.cache.set(clientId, { token: data.access_token, expiresAt });

    return {
      token: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  invalidate(clientId: string): void {
    this.cache.delete(clientId);
  }
}

export function entraTokenVendorFromEnv(): EntraTokenVendor | null {
  const tenantId = process.env.ENTRA_TENANT_ID?.trim();
  if (!tenantId) return null;
  return new EntraTokenVendor(tenantId);
}

export function entraApiAppIdFromEnv(): string | null {
  return process.env.ENTRA_API_APP_ID?.trim() ?? null;
}
