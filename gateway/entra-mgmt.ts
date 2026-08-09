/** Microsoft Graph API — Entra M2M agent app-registration lifecycle (server-side only). */

export interface EntraMgmtConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  apiAppId: string;
}

export interface CreatedAgentClient {
  clientId: string;
  clientSecret: string;
  name: string;
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function mgmtConfigFromEnv(): EntraMgmtConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID?.trim();
  const clientId = process.env.ENTRA_CLIENT_ID?.trim();
  const clientSecret = process.env.ENTRA_CLIENT_SECRET?.trim();
  const apiAppId = process.env.ENTRA_API_APP_ID?.trim();
  if (!tenantId || !clientId || !clientSecret || !apiAppId) return null;
  return { tenantId, clientId, clientSecret, apiAppId };
}

export function isEntraMgmtConfigured(): boolean {
  return mgmtConfigFromEnv() !== null;
}

async function getMgmtToken(cfg: EntraMgmtConfig): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Entra Graph mgmt token failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Resolve the protected API's own service principal — needed once per call to
 * get (a) its object id, used as `resourceId` in appRoleAssignments, and
 * (b) its `appRoles` array, used to map scope strings (e.g. "flights:read")
 * to the App Role GUIDs Graph actually requires as `appRoleId`.
 */
async function getApiServicePrincipal(
  cfg: EntraMgmtConfig,
  headers: Record<string, string>,
): Promise<{ id: string; appRoles: Array<{ id: string; value: string }> }> {
  const res = await fetch(
    `${GRAPH_BASE}/servicePrincipals?$filter=appId eq '${encodeURIComponent(cfg.apiAppId)}'`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Entra API servicePrincipal lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    value: Array<{ id: string; appRoles: Array<{ id: string; value: string }> }>;
  };
  const sp = data.value[0];
  if (!sp) {
    throw new Error(
      `Entra API servicePrincipal not found for appId '${cfg.apiAppId}' — check ENTRA_API_APP_ID`,
    );
  }
  return sp;
}

/**
 * POST /agents — create an Entra app registration + service principal for an
 * M2M agent, assign it the requested App Roles (named identically to the
 * scope strings ToolGuard already enforces, e.g. "flights:read"), and mint a
 * client secret. Auth required: no (demo); uses server-side mgmt credentials.
 */
export async function createEntraAgent(
  name: string,
  scopes: string[],
): Promise<CreatedAgentClient> {
  const cfg = mgmtConfigFromEnv();
  if (!cfg) {
    throw new Error(
      "Entra Management API not configured — set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_API_APP_ID",
    );
  }

  const mgmtToken = await getMgmtToken(cfg);
  const headers = {
    Authorization: `Bearer ${mgmtToken}`,
    "Content-Type": "application/json",
  };

  // Read-only lookup — nothing to roll back if this fails.
  const apiSp = await getApiServicePrincipal(cfg, headers);

  // Resolve every requested scope to its App Role GUID up front, before any
  // mutation happens, so a missing App Role fails fast with nothing to roll back.
  const roleIds = scopes.map((scope) => {
    const role = apiSp.appRoles.find((r) => r.value === scope);
    if (!role) {
      throw new Error(
        `Entra app role assignment failed for scope '${scope}': no App Role with value '${scope}' found on API servicePrincipal '${apiSp.id}'`,
      );
    }
    return { scope, id: role.id };
  });

  const appRes = await fetch(`${GRAPH_BASE}/applications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: `mcp-agent-${name}` }),
  });
  if (!appRes.ok) {
    throw new Error(`Entra create application failed: ${appRes.status} ${await appRes.text()}`);
  }
  const app = (await appRes.json()) as { appId: string; id: string };

  try {
    const spRes = await fetch(`${GRAPH_BASE}/servicePrincipals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId: app.appId }),
    });
    if (!spRes.ok) {
      throw new Error(`Entra create servicePrincipal failed: ${spRes.status} ${await spRes.text()}`);
    }
    const sp = (await spRes.json()) as { id: string };

    for (const { scope, id: appRoleId } of roleIds) {
      const assignRes = await fetch(
        `${GRAPH_BASE}/servicePrincipals/${sp.id}/appRoleAssignments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            principalId: sp.id,
            resourceId: apiSp.id,
            appRoleId,
          }),
        },
      );
      if (!assignRes.ok) {
        throw new Error(
          `Entra app role assignment failed for scope '${scope}': ${assignRes.status} ${await assignRes.text()}`,
        );
      }
    }

    const secretRes = await fetch(`${GRAPH_BASE}/applications/${app.id}/addPassword`, {
      method: "POST",
      headers,
      body: JSON.stringify({ passwordCredential: { displayName: "mcp-tool-guard-vended" } }),
    });
    if (!secretRes.ok) {
      throw new Error(`Entra add secret failed: ${secretRes.status} ${await secretRes.text()}`);
    }
    const secret = (await secretRes.json()) as { secretText: string };

    return {
      clientId: app.appId,
      clientSecret: secret.secretText,
      name,
    };
  } catch (err) {
    await fetch(`${GRAPH_BASE}/applications/${app.id}`, {
      method: "DELETE",
      headers,
    });
    throw err;
  }
}

/**
 * DELETE /agents/:clientId — remove an Entra app registration.
 * Auth required: no (demo); uses server-side mgmt credentials.
 * Note: `clientId` here is the Entra application's `appId` (client_id), not
 * its Graph object id — Graph delete requires resolving appId -> object id first.
 */
export async function deleteEntraAgent(clientId: string): Promise<void> {
  const cfg = mgmtConfigFromEnv();
  if (!cfg) {
    throw new Error("Entra Management API not configured");
  }

  const mgmtToken = await getMgmtToken(cfg);
  const headers = { Authorization: `Bearer ${mgmtToken}` };

  const lookupRes = await fetch(
    `${GRAPH_BASE}/applications?$filter=appId eq '${encodeURIComponent(clientId)}'`,
    { headers },
  );
  if (!lookupRes.ok) {
    throw new Error(`Entra application lookup failed: ${lookupRes.status} ${await lookupRes.text()}`);
  }
  const lookup = (await lookupRes.json()) as { value: Array<{ id: string }> };
  const objectId = lookup.value[0]?.id;
  if (!objectId) return; // already gone — treat like Auth0's 404-is-success

  const deleteRes = await fetch(`${GRAPH_BASE}/applications/${objectId}`, {
    method: "DELETE",
    headers,
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(`Entra delete application failed: ${deleteRes.status} ${await deleteRes.text()}`);
  }
}
