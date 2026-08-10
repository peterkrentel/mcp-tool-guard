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
 * Look up the Auth0 resource server whose `identifier` matches `cfg.audience`.
 * Auth0's Management API does not consistently accept the identifier
 * (e.g. `https://mcp-tool-guard`) as the `{id}` path param on
 * `GET /api/v2/resource-servers/{id}` across all Auth0 API versions — the
 * documented-safe way to resolve it is list-then-filter, so that's what this
 * does, even though it's less efficient than a direct GET. (Unverified
 * against a live tenant in this environment — worth confirming Auth0's
 * actual behavior there; if `GET /api/v2/resource-servers/{identifier}` does
 * work directly in practice, this could be simplified to a single GET.)
 */
async function getResourceServerByAudience(
  cfg: Auth0MgmtConfig,
  headers: Record<string, string>,
): Promise<{ id: string; scopes: Array<{ value: string; description?: string }> }> {
  const res = await fetch(`https://${cfg.domain}/api/v2/resource-servers`, { headers });
  if (!res.ok) {
    throw new Error(`Auth0 resource-servers list failed: ${res.status} ${await res.text()}`);
  }
  const servers = (await res.json()) as Array<{
    id: string;
    identifier: string;
    scopes?: Array<{ value: string; description?: string }>;
  }>;
  const server = servers.find((s) => s.identifier === cfg.audience);
  if (!server) {
    throw new Error(`Auth0 resource server not found for audience '${cfg.audience}' — check AUTH0_AUDIENCE`);
  }
  return { id: server.id, scopes: server.scopes ?? [] };
}

/**
 * Ensure every requested scope is declared on the Auth0 resource server
 * identified by `cfg.audience`, auto-provisioning any that are missing
 * (`PATCH /api/v2/resource-servers/{id}` with the full updated `scopes`
 * array) instead of letting `/client-grants` reject the request — this is
 * what lets a vendor MCP server registered at runtime via `POST /servers`
 * actually get an agent granted its scopes, without a human adding the
 * permission in the Auth0 dashboard first.
 *
 * PATCH replaces the whole `scopes` array rather than merging, so this reads
 * the existing array and appends to it rather than PATCHing the missing
 * scopes alone — otherwise it would silently drop every already-declared
 * permission.
 */
async function ensureResourceServerScopesExist(
  cfg: Auth0MgmtConfig,
  headers: Record<string, string>,
  scopes: string[],
): Promise<void> {
  const resourceServer = await getResourceServerByAudience(cfg, headers);
  const missingScopes = scopes.filter(
    (scope) => !resourceServer.scopes.some((s) => s.value === scope),
  );
  if (missingScopes.length === 0) return;

  const updatedScopes = [
    ...resourceServer.scopes,
    ...missingScopes.map((scope) => ({
      value: scope,
      description: `Auto-provisioned scope for ${scope}`,
    })),
  ];
  const patchRes = await fetch(`https://${cfg.domain}/api/v2/resource-servers/${resourceServer.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ scopes: updatedScopes }),
  });
  if (!patchRes.ok) {
    throw new Error(
      `Auth0 resource-server scope auto-provisioning failed for scope(s) '${missingScopes.join(", ")}': ${patchRes.status} ${await patchRes.text()}`,
    );
  }
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

  // Read-then-patch, before creating anything client-specific — a failure
  // here has nothing agent-specific to roll back yet.
  await ensureResourceServerScopesExist(cfg, headers, scopes);

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
