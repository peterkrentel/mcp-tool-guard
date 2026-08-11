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

/**
 * Escape a value for safe interpolation inside an OData `$filter` string
 * literal (e.g. `appId eq '<value>'`). Per OData string-literal escaping
 * rules, a single quote is escaped by doubling it. `encodeURIComponent`
 * alone does NOT do this — it percent-encodes URL-reserved characters but
 * leaves a literal `'` untouched, which would let a value containing a quote
 * break out of the intended string literal and broaden the filter to match
 * unintended resources. Always combine with `encodeURIComponent` for the
 * rest of the URL; this only handles the OData-level escaping.
 */
function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

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
    `${GRAPH_BASE}/servicePrincipals?$filter=appId eq '${encodeURIComponent(escapeODataString(cfg.apiAppId))}'`,
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
 * Resolve the protected API application's own Graph *object id* — distinct
 * from `apiSp.id` (the servicePrincipal object id) and from `cfg.apiAppId`
 * (the `appId`/client id). Appending to `appRoles` requires PATCHing
 * `/applications/{id}` with this object id specifically; Graph does not
 * accept the `appId` there. Mirrors the `az ad app show --id "$API_APP_ID"
 * --query id` lookup `scripts/entra-setup.sh` already does for the same
 * reason.
 */
async function getApiApplicationObjectId(
  cfg: EntraMgmtConfig,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch(
    `${GRAPH_BASE}/applications?$filter=appId eq '${encodeURIComponent(escapeODataString(cfg.apiAppId))}'`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Entra API application lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { value: Array<{ id: string }> };
  const objectId = data.value[0]?.id;
  if (!objectId) {
    throw new Error(
      `Entra API application not found for appId '${cfg.apiAppId}' — check ENTRA_API_APP_ID`,
    );
  }
  return objectId;
}

/**
 * Resolves the management app's own service principal object id (by its own
 * client id, `cfg.clientId`) — needed so newly-created agent applications can
 * be owned by the management app at creation time. `Application.ReadWrite.OwnedBy`
 * restricts every operation to objects the caller owns; an app-only `POST
 * /applications` call does not automatically assign an owner the way
 * interactive/user-context creation does, so without this a freshly-created
 * agent application has no owner at all, and the immediately-following `POST
 * /servicePrincipals` for it fails (confirmed live: "the backing application
 * of the service principal being created must [be] in the local tenant" —
 * a confusingly-worded ownership check, not a real cross-tenant issue).
 */
async function getMgmtServicePrincipalId(
  cfg: EntraMgmtConfig,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetch(
    `${GRAPH_BASE}/servicePrincipals?$filter=appId eq '${encodeURIComponent(escapeODataString(cfg.clientId))}'`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Entra management servicePrincipal lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { value: Array<{ id: string }> };
  const spId = data.value[0]?.id;
  if (!spId) {
    throw new Error(
      `Entra management servicePrincipal not found for appId '${cfg.clientId}' — check ENTRA_CLIENT_ID`,
    );
  }
  return spId;
}

// Live-verified against a real tenant: creating an application via app-only
// (client_credentials) auth and immediately creating its service principal
// is subject to real Microsoft Graph eventual-consistency lag — 5s wasn't
// enough, 30s was. Graph reports this inconsistently depending on exactly
// which validation path is hit: sometimes a 403 ("the backing application of
// the service principal being created must [be] in the local tenant" —
// despite the app genuinely being local-tenant and owned correctly),
// sometimes a 400 with code "NoBackingApplicationObject". Both are the same
// underlying condition, not a real authorization or ownership problem
// (confirmed by isolated testing outside this codebase entirely). Retry with
// backoff rather than a flat sleep on every single agent creation, since the
// actual delay varies and is often much shorter than the worst case.
const SERVICE_PRINCIPAL_CONSISTENCY_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

function isConsistencyLagError(status: number, body: string): boolean {
  if (status !== 400 && status !== 403) return false;
  return (
    body.includes("NoBackingApplicationObject") ||
    body.includes("must in the local tenant") ||
    body.includes("must be in the local tenant")
  );
}

async function createServicePrincipalWithRetry(
  appId: string,
  headers: Record<string, string>,
): Promise<{ id: string }> {
  for (let attempt = 0; ; attempt++) {
    const spRes = await fetch(`${GRAPH_BASE}/servicePrincipals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId }),
    });
    if (spRes.ok) {
      return (await spRes.json()) as { id: string };
    }
    const body = await spRes.text();
    const canRetry =
      isConsistencyLagError(spRes.status, body) &&
      attempt < SERVICE_PRINCIPAL_CONSISTENCY_RETRY_DELAYS_MS.length;
    if (!canRetry) {
      throw new Error(`Entra create servicePrincipal failed: ${spRes.status} ${body}`);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SERVICE_PRINCIPAL_CONSISTENCY_RETRY_DELAYS_MS[attempt]),
    );
  }
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

  // Dedupe up front — the UI's create-agent form is a free-text
  // comma-separated field, so e.g. "flights:read, flights:read" arrives here
  // as two identical array elements. Without this, the missing-scope
  // computation below would treat both as "missing" independently and the
  // batched PATCH would write two App Role objects with the same `value` but
  // different generated GUIDs — a duplicate that, once the PATCH succeeds,
  // has no rollback path (see the batched-PATCH note below). Every
  // downstream step (missing-scope computation, role-GUID resolution, the
  // assignment calls) must use this deduplicated array, not the raw param.
  const uniqueScopes = [...new Set(scopes)];

  // Read-only lookup — nothing to roll back if this fails.
  const apiSp = await getApiServicePrincipal(cfg, headers);

  // Resolve every requested scope to its App Role GUID up front. Scopes that
  // already have a matching App Role resolve immediately; any that don't get
  // auto-provisioned first, in a single batched PATCH covering every missing
  // scope at once — not one PATCH per missing scope. This mutation replaces
  // the old "resolve everything before any mutation, so a missing App Role
  // fails fast with nothing to roll back" property (a missing App Role is no
  // longer a hard failure at all, it's the trigger for provisioning it), but
  // the batched-single-PATCH shape preserves an equivalent safety property:
  // the PATCH carries the fully-assembled `appRoles` array (existing +
  // every newly-generated role) and either succeeds atomically or fails
  // atomically from Graph's perspective — there is no partial-write state to
  // roll back, and nothing agent-specific (App/servicePrincipal) has been
  // created yet when it runs.
  let appRoles = apiSp.appRoles;
  const missingScopes = uniqueScopes.filter((scope) => !appRoles.some((r) => r.value === scope));
  if (missingScopes.length > 0) {
    const apiObjectId = await getApiApplicationObjectId(cfg, headers);
    const newRoles = missingScopes.map((scope) => ({
      allowedMemberTypes: ["User", "Application"],
      description: `Auto-provisioned scope for ${scope}`,
      displayName: scope,
      // Global Web Crypto API (crypto.randomUUID()), not "node:crypto" — this
      // module is transitively bundled into the browser UI via the gateway
      // package's index.ts barrel export (ToolGuard is imported client-side
      // for its pre-check, which pulls in this whole module graph regardless
      // of whether Entra-specific code actually runs there). "node:crypto"
      // gets externalized by Vite for browser builds and throws at runtime;
      // the global `crypto` object is natively available in both modern
      // Node.js and every browser, so this works in both without an import.
      id: crypto.randomUUID(),
      isEnabled: true,
      value: scope,
    }));
    const updatedAppRoles = [...appRoles, ...newRoles];
    const patchRes = await fetch(`${GRAPH_BASE}/applications/${apiObjectId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ appRoles: updatedAppRoles }),
    });
    if (!patchRes.ok) {
      throw new Error(
        `Entra App Role auto-provisioning failed for scope(s) '${missingScopes.join(", ")}': ${patchRes.status} ${await patchRes.text()}`,
      );
    }
    appRoles = updatedAppRoles;
  }

  const roleIds = uniqueScopes.map((scope) => {
    const role = appRoles.find((r) => r.value === scope);
    if (!role) {
      // Should be unreachable — every scope was either already present or
      // just appended above — but keep this as a defensive fail-fast rather
      // than silently proceeding without a role id.
      throw new Error(
        `Entra app role assignment failed for scope '${scope}': no App Role with value '${scope}' found on API servicePrincipal '${apiSp.id}' after auto-provisioning`,
      );
    }
    return { scope, id: role.id };
  });

  const mgmtSpId = await getMgmtServicePrincipalId(cfg, headers);
  const appRes = await fetch(`${GRAPH_BASE}/applications`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      displayName: `mcp-agent-${name}`,
      "owners@odata.bind": [`${GRAPH_BASE}/directoryObjects/${mgmtSpId}`],
    }),
  });
  if (!appRes.ok) {
    throw new Error(`Entra create application failed: ${appRes.status} ${await appRes.text()}`);
  }
  const app = (await appRes.json()) as { appId: string; id: string };

  try {
    const sp = await createServicePrincipalWithRetry(app.appId, headers);

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
    `${GRAPH_BASE}/applications?$filter=appId eq '${encodeURIComponent(escapeODataString(clientId))}'`,
    { headers },
  );
  if (!lookupRes.ok) {
    throw new Error(`Entra application lookup failed: ${lookupRes.status} ${await lookupRes.text()}`);
  }
  const lookup = (await lookupRes.json()) as { value: Array<{ id: string }> };
  const objectId = lookup.value[0]?.id;
  if (!objectId) return; // already gone — treat like Auth0's 404-is-success

  // Deleting the application also deletes its home-tenant service principal —
  // no separate servicePrincipal cleanup needed. Confirmed in Microsoft's own
  // docs: "deleting an application object will also delete its home tenant
  // service principal object" (learn.microsoft.com/entra/identity-platform/
  // app-objects-and-service-principals#consequences-of-modifying-and-deleting-applications).
  // Every app this project creates is single-tenant in its own home tenant,
  // so that cascade always applies here.
  const deleteRes = await fetch(`${GRAPH_BASE}/applications/${objectId}`, {
    method: "DELETE",
    headers,
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(`Entra delete application failed: ${deleteRes.status} ${await deleteRes.text()}`);
  }
}
