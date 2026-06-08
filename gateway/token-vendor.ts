/** Auth0 client_credentials token vending with in-memory cache. */

export interface VendedToken {
  token: string;
  expiresIn: number;
}

interface CacheEntry {
  token: string;
  expiresAt: number;
}

export class TokenVendor {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly auth0Domain: string) {}

  /**
   * POST /token — exchange M2M credentials for access token (server-side).
   * Auth required: no; body carries client credentials.
   */
  async vend(
    clientId: string,
    clientSecret: string,
    audience: string,
  ): Promise<VendedToken> {
    const cached = this.cache.get(clientId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return {
        token: cached.token,
        expiresIn: Math.floor((cached.expiresAt - now) / 1000),
      };
    }

    const res = await fetch(`https://${this.auth0Domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience,
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
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

export function tokenVendorFromEnv(): TokenVendor | null {
  const domain = process.env.AUTH0_DOMAIN?.trim();
  if (!domain) return null;
  return new TokenVendor(domain);
}

export function auth0AudienceFromEnv(): string | null {
  return process.env.AUTH0_AUDIENCE?.trim() ?? null;
}
