/** Entra ID client_credentials token vending with in-memory cache. */

export interface VendedToken {
  token: string;
  expiresIn: number;
}

interface CacheEntry {
  token: string;
  expiresAt: number;
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

    const res = await fetch(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: `api://${apiAppId}/.default`,
          grant_type: "client_credentials",
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`Entra token request failed: ${res.status} ${await res.text()}`);
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
