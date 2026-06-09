/** Auth0 Management API — M2M agent client lifecycle (server-side only). */

export interface Auth0MgmtConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}

export interface CreatedAgentClient {
  clientId: string;
  clientSecret: string;
  name: string;
}

function mgmtConfigFromEnv(): Auth0MgmtConfig | null {
  const domain = process.env.AUTH0_DOMAIN?.trim();
  const clientId = process.env.AUTH0_MGMT_CLIENT_ID?.trim();
  const clientSecret = process.env.AUTH0_MGMT_CLIENT_SECRET?.trim();
  const audience = process.env.AUTH0_AUDIENCE?.trim();
  if (!domain || !clientId || !clientSecret || !audience) return null;
  return { domain, clientId, clientSecret, audience };
}

export function isAuth0MgmtConfigured(): boolean {
  return mgmtConfigFromEnv() !== null;
}

async function getMgmtToken(cfg: Auth0MgmtConfig): Promise<string> {
  const res = await fetch(`https://${cfg.domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      audience: `https://${cfg.domain}/api/v2/`,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth0 mgmt token failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * POST /agents — create Auth0 M2M client with requested API scopes.
 * Auth required: no (demo); uses server-side mgmt credentials.
 */
export async function createM2mAgent(
  name: string,
  scopes: string[],
): Promise<CreatedAgentClient> {
  const cfg = mgmtConfigFromEnv();
  if (!cfg) {
    throw new Error(
      "Auth0 Management API not configured — set AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_AUDIENCE",
    );
  }

  const mgmtToken = await getMgmtToken(cfg);
  const headers = {
    Authorization: `Bearer ${mgmtToken}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`https://${cfg.domain}/api/v2/clients`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `mcp-agent-${name}`,
      app_type: "non_interactive",
      grant_types: ["client_credentials"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Auth0 create client failed: ${createRes.status} ${await createRes.text()}`);
  }

  const client = (await createRes.json()) as {
    client_id: string;
    client_secret: string;
  };

  const grantRes = await fetch(`https://${cfg.domain}/api/v2/client-grants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      client_id: client.client_id,
      audience: cfg.audience,
      scope: scopes,
    }),
  });

  if (!grantRes.ok) {
    await fetch(`https://${cfg.domain}/api/v2/clients/${client.client_id}`, {
      method: "DELETE",
      headers,
    });
    throw new Error(`Auth0 client grant failed: ${grantRes.status} ${await grantRes.text()}`);
  }

  return {
    clientId: client.client_id,
    clientSecret: client.client_secret,
    name,
  };
}

/**
 * DELETE /agents/:clientId — remove M2M client from Auth0.
 * Auth required: no (demo); uses server-side mgmt credentials.
 */
export async function deleteM2mAgent(clientId: string): Promise<void> {
  const cfg = mgmtConfigFromEnv();
  if (!cfg) {
    throw new Error("Auth0 Management API not configured");
  }

  const mgmtToken = await getMgmtToken(cfg);
  const res = await fetch(`https://${cfg.domain}/api/v2/clients/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${mgmtToken}` },
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`Auth0 delete client failed: ${res.status} ${await res.text()}`);
  }
}
