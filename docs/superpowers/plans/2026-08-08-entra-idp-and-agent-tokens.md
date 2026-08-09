# Entra IdP Adapter + Agent Token Self-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Entra ID as a second, single-active IdP for mcp-tool-guard (`MCP_IDP_PROVIDER=entra`), give agents (Claude Code included) their own Entra M2M identity via `client_credentials`, and retire the copy-a-static-JWT workaround by finally surfacing the M2M `client_secret` from `/agents.html`.

**Architecture:** Mirror the existing Auth0 implementation file-for-file (`auth0-mgmt.ts` → `entra-mgmt.ts`, `token-vendor.ts` → `entra-token-vendor.ts`) against the already-shipped `JwtValidator`/`IdpAdapter` interfaces — no new interfaces, no new server-side architecture. `DefaultJwtValidator` is already provider-agnostic (JWKS/issuer/audience are just config); it only needs `extractScopes()` extended to read Entra's `roles` claim. Entra App Roles are named identically to existing scope strings (e.g. `flights:read`), so no separate scope-translation layer is needed.

**Tech Stack:** TypeScript (gateway), raw `fetch` for Graph API + Entra token endpoint (no Azure SDK, matching the existing Auth0 zero-SDK convention), `@azure/msal-browser` for the UI login flow, Node's built-in test runner (`node --test`), bash + `az` CLI for the setup script.

## Global Constraints

- Never commit to `main` directly — this work happens on a new feature branch, and only after `docs/mcp-authorization-research` has merged (avoids repeat merge conflicts on `backlog.md`/`CHANGELOG.md`, per project convention).
- Every PR must update `CHANGELOG.md` under `[Unreleased]` (CI-enforced).
- `MCP_IDP_PROVIDER` is single-active-provider — no concurrent Auth0+Entra trust in one deployment (BL-034, already decided, do not re-litigate).
- Client secret (not certificate) credentials for the Entra management app — matches existing Auth0 M2M pattern.
- No changes to Claude Code's own `.mcp.json`/settings at any point in this plan — only mcp-tool-guard-side scripts/config/UI change.
- Follow the existing zero-SDK, raw-`fetch` convention server-side (do not add `@azure/msal-node` or the Graph SDK as a new gateway dependency).
- Gateway tests import from compiled `../dist/*.js`, not `.ts` sources directly — every gateway task's test-run step must `npm run build -w @mcp-tool-guard/gateway` first.

---

### Task 0: Create the feature branch

**Files:** none (git operation only)

- [ ] **Step 1: Verify `docs/mcp-authorization-research` has merged to `main`**

Run: `git fetch origin && git log origin/main --oneline -1 && git branch --merged origin/main | grep -c "docs/mcp-authorization-research"`
Expected: the branch shows as merged (count `1`). If not merged yet, stop here and wait — do not proceed with Task 1 until it is.

- [ ] **Step 2: Create and switch to the new feature branch from up-to-date `main`**

```bash
git checkout main
git pull origin main
git checkout -b feature/entra-idp-adapter
```

---

### Task 1: Extend `extractScopes()` to read Entra's `roles` claim

**Files:**
- Modify: `gateway/guard.ts:90-101`
- Test: `gateway/tests/guard-entra-scopes.test.mjs` (new)

**Interfaces:**
- Consumes: `DefaultJwtValidator` (existing class, `gateway/guard.ts:60`)
- Produces: `extractScopes()` now also collects `payload.roles` (array of strings) — later tasks (Task 3's `EntraIdpAdapter`, Task 4's tests) rely on Entra App Role names flowing straight through as scope strings with no translation layer.

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/guard-entra-scopes.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { DefaultJwtValidator } from "../dist/index.js";

test("extractScopes() reads Entra 'roles' claim as scopes", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({ roles: ["flights:read", "flights:write"] });
  assert.deepEqual(new Set(scopes), new Set(["flights:read", "flights:write"]));
});

test("extractScopes() merges 'roles' with 'permissions' and 'scp' without duplicates", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({
    roles: ["flights:read"],
    permissions: ["flights:write"],
    scp: "flights:read gateway:admin",
  });
  assert.deepEqual(
    new Set(scopes),
    new Set(["flights:read", "flights:write", "gateway:admin"]),
  );
});

test("extractScopes() tolerates a token with no 'roles' claim (Auth0 shape unaffected)", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({ permissions: ["flights:read"] });
  assert.deepEqual(scopes, ["flights:read"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/guard-entra-scopes.test.mjs`
Expected: first two tests FAIL (roles not collected), third PASSES already.

- [ ] **Step 3: Implement — extend `extractScopes()`**

In `gateway/guard.ts`, replace lines 90-101:

```ts
  extractScopes(payload: JwtPayload): string[] {
    const scopes: string[] = [];
    const raw = payload.scope ?? payload.scopes ?? payload.scp;
    if (raw) {
      if (Array.isArray(raw)) scopes.push(...raw.map(String));
      else scopes.push(...String(raw).split(/[\s,]+/).filter(Boolean));
    }
    if (Array.isArray(payload.permissions)) {
      scopes.push(...payload.permissions.map(String));
    }
    if (Array.isArray(payload.roles)) {
      scopes.push(...payload.roles.map(String));
    }
    return [...new Set(scopes)];
  }
```

You'll also need to add `roles?: unknown` to the `JwtPayload` type — find its definition:

Run: `grep -n "roles\|permissions" gateway/types.ts`

Add `roles?: unknown[];` alongside the existing `permissions?: unknown[];` field in the `JwtPayload` interface in `gateway/types.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/guard-entra-scopes.test.mjs`
Expected: all 3 PASS

- [ ] **Step 5: Run full gateway suite to check no regression**

Run: `npm run test -w @mcp-tool-guard/gateway`
Expected: all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/guard.ts gateway/types.ts gateway/tests/guard-entra-scopes.test.mjs
git commit -m "feat(guard): extract scopes from Entra 'roles' claim"
```

---

### Task 2: `gateway/entra-token-vendor.ts` — client_credentials token vending

**Files:**
- Create: `gateway/entra-token-vendor.ts`
- Test: `gateway/tests/entra-token-vendor.test.mjs` (new)

**Interfaces:**
- Consumes: none new (mirrors `gateway/token-vendor.ts`'s shape)
- Produces: `EntraTokenVendor` class with `vend(clientId, clientSecret, apiAppId): Promise<VendedToken>` and `invalidate(clientId): void`; `entraTokenVendorFromEnv(): EntraTokenVendor | null`; `entraApiAppIdFromEnv(): string | null`. Task 3's `EntraIdpAdapter` imports these directly.

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/entra-token-vendor.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EntraTokenVendor,
  entraTokenVendorFromEnv,
  entraApiAppIdFromEnv,
} from "../dist/entra-token-vendor.js";

function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

test("entraTokenVendorFromEnv() returns null when ENTRA_TENANT_ID unset", () => {
  withEnv("ENTRA_TENANT_ID", undefined, () => {
    assert.equal(entraTokenVendorFromEnv(), null);
  });
});

test("entraTokenVendorFromEnv() returns an EntraTokenVendor when ENTRA_TENANT_ID set", () => {
  withEnv("ENTRA_TENANT_ID", "test-tenant-id", () => {
    const vendor = entraTokenVendorFromEnv();
    assert.ok(vendor instanceof EntraTokenVendor);
  });
});

test("entraApiAppIdFromEnv() returns null when ENTRA_API_APP_ID unset", () => {
  withEnv("ENTRA_API_APP_ID", undefined, () => {
    assert.equal(entraApiAppIdFromEnv(), null);
  });
});

test("entraApiAppIdFromEnv() returns trimmed value when set", () => {
  withEnv("ENTRA_API_APP_ID", "  api-app-id  ", () => {
    assert.equal(entraApiAppIdFromEnv(), "api-app-id");
  });
});

test("EntraTokenVendor.vend() caches token until expiry skew", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ access_token: `token-${callCount}`, expires_in: 3600 }),
    };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    const first = await vendor.vend("client-id", "client-secret", "api-app-id");
    const second = await vendor.vend("client-id", "client-secret", "api-app-id");
    assert.equal(first.token, "token-1");
    assert.equal(second.token, "token-1");
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("EntraTokenVendor.invalidate() forces a re-fetch on next vend()", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ access_token: `token-${callCount}`, expires_in: 3600 }),
    };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    await vendor.vend("client-id", "client-secret", "api-app-id");
    vendor.invalidate("client-id");
    const second = await vendor.vend("client-id", "client-secret", "api-app-id");
    assert.equal(second.token, "token-2");
    assert.equal(callCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("EntraTokenVendor.vend() throws with response body on non-ok response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid_client",
  });
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    await assert.rejects(
      vendor.vend("client-id", "client-secret", "api-app-id"),
      /Entra token request failed: 401 invalid_client/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/entra-token-vendor.test.mjs`
Expected: FAIL — `Cannot find module '../dist/entra-token-vendor.js'`

- [ ] **Step 3: Implement `gateway/entra-token-vendor.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/entra-token-vendor.test.mjs`
Expected: all 6 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/entra-token-vendor.ts gateway/tests/entra-token-vendor.test.mjs
git commit -m "feat(gateway): add EntraTokenVendor for client_credentials token vending"
```

---

### Task 3: `gateway/entra-mgmt.ts` — Graph API agent lifecycle

**Files:**
- Create: `gateway/entra-mgmt.ts`
- Test: `gateway/tests/entra-mgmt.test.mjs` (new)

**Interfaces:**
- Consumes: none new
- Produces: `isEntraMgmtConfigured(): boolean`, `createEntraAgent(name: string, scopes: string[]): Promise<CreatedAgentClient>`, `deleteEntraAgent(clientId: string): Promise<void>` — same `CreatedAgentClient` shape (`{clientId, clientSecret, name}`) already defined in `gateway/idp-adapter.ts`. Task 4's `EntraIdpAdapter` imports these directly.

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/entra-mgmt.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isEntraMgmtConfigured,
  createEntraAgent,
  deleteEntraAgent,
} from "../dist/entra-mgmt.js";

const ENV_KEYS = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_API_APP_ID"];

function clearEntraEnv() {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test("isEntraMgmtConfigured() is false when ENTRA_* unset", () => {
  const restore = clearEntraEnv();
  try {
    assert.equal(isEntraMgmtConfigured(), false);
  } finally {
    restore();
  }
});

test("isEntraMgmtConfigured() is true when all ENTRA_* mgmt vars set", () => {
  const restore = clearEntraEnv();
  try {
    process.env.ENTRA_TENANT_ID = "tenant-id";
    process.env.ENTRA_CLIENT_ID = "mgmt-client-id";
    process.env.ENTRA_CLIENT_SECRET = "mgmt-client-secret";
    process.env.ENTRA_API_APP_ID = "api-app-id";
    assert.equal(isEntraMgmtConfigured(), true);
  } finally {
    restore();
  }
});

test("createEntraAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearEntraEnv();
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra Management API not configured — set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_API_APP_ID/,
    );
  } finally {
    restore();
  }
});

test("deleteEntraAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearEntraEnv();
  try {
    await assert.rejects(
      deleteEntraAgent("some-app-object-id"),
      /Entra Management API not configured/,
    );
  } finally {
    restore();
  }
});

test("createEntraAgent() registers app, service principal, role assignment, and secret", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  process.env.ENTRA_TENANT_ID = "tenant-id";
  process.env.ENTRA_CLIENT_ID = "mgmt-client-id";
  process.env.ENTRA_CLIENT_SECRET = "mgmt-client-secret";
  process.env.ENTRA_API_APP_ID = "api-app-id";
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET" });
    if (String(url).includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (String(url).endsWith("/applications") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ appId: "new-client-id", id: "new-object-id" }) };
    }
    if (String(url).endsWith("/servicePrincipals") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ id: "new-sp-id" }) };
    }
    if (String(url).includes("/appRoleAssignments") && opts?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    if (String(url).includes("/addPassword") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ secretText: "new-client-secret" }) };
    }
    throw new Error(`Unexpected fetch: ${opts?.method} ${url}`);
  };
  try {
    const result = await createEntraAgent("test-agent", ["flights:read"]);
    assert.equal(result.clientId, "new-client-id");
    assert.equal(result.clientSecret, "new-client-secret");
    assert.equal(result.name, "test-agent");
    assert.ok(calls.some((c) => c.url.endsWith("/applications") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.endsWith("/servicePrincipals") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.includes("/appRoleAssignments")));
    assert.ok(calls.some((c) => c.url.includes("/addPassword")));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/entra-mgmt.test.mjs`
Expected: FAIL — `Cannot find module '../dist/entra-mgmt.js'`

- [ ] **Step 3: Implement `gateway/entra-mgmt.ts`**

```ts
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

  const appRes = await fetch(`${GRAPH_BASE}/applications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ displayName: `mcp-agent-${name}` }),
  });
  if (!appRes.ok) {
    throw new Error(`Entra create application failed: ${appRes.status} ${await appRes.text()}`);
  }
  const app = (await appRes.json()) as { appId: string; id: string };

  const spRes = await fetch(`${GRAPH_BASE}/servicePrincipals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ appId: app.appId }),
  });
  if (!spRes.ok) {
    throw new Error(`Entra create servicePrincipal failed: ${spRes.status} ${await spRes.text()}`);
  }
  const sp = (await spRes.json()) as { id: string };

  for (const scope of scopes) {
    const assignRes = await fetch(
      `${GRAPH_BASE}/servicePrincipals/${sp.id}/appRoleAssignments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          principalId: sp.id,
          resourceId: cfg.apiAppId,
          appRoleId: scope,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/entra-mgmt.test.mjs`
Expected: all 5 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/entra-mgmt.ts gateway/tests/entra-mgmt.test.mjs
git commit -m "feat(gateway): add Entra Graph API M2M agent lifecycle (create/delete)"
```

**Post-implementation correction (found in task review, fixed in commit `cd2daf4`):** the `appRoleAssignments` payload above is wrong against Microsoft Graph's actual schema — `resourceId` must be the protected API's **service-principal object ID**, not `ENTRA_API_APP_ID` (its client ID), and `appRoleId` must be the App Role's **GUID `id`**, not the raw scope string. The corrected implementation resolves the API's service principal once via `GET /servicePrincipals?$filter=appId eq '{ENTRA_API_APP_ID}'` (its `id` and `appRoles` array), maps each scope to its role GUID via `appRoles.find(r => r.value === scope).id`, and rolls back (`DELETE /applications/{app.id}`) if any mutating step after application-creation fails. See `gateway/entra-mgmt.ts` as committed (not the snippet above) for the authoritative version.

---

### Task 4: `EntraIdpAdapter` — wire into `IdpAdapter`/`buildIdpAdapter()`

**Files:**
- Modify: `gateway/idp-adapter.ts`
- Modify: `gateway/tests/idp-adapter.test.mjs`

**Interfaces:**
- Consumes: `entraTokenVendorFromEnv`/`entraApiAppIdFromEnv` (Task 2), `isEntraMgmtConfigured`/`createEntraAgent`/`deleteEntraAgent` (Task 3)
- Produces: `EntraIdpAdapter` class satisfying `IdpAdapter`; `buildIdpAdapter("entra")` returns a working instance instead of throwing.

- [ ] **Step 1: Update the failing "not yet implemented" test to the real expectation**

In `gateway/tests/idp-adapter.test.mjs`, replace lines 166-168:

```js
test("buildIdpAdapter('entra') throws not-yet-implemented", () => {
  assert.throws(() => buildIdpAdapter("entra"), /entra.*not yet implemented/i);
});
```

with:

```js
test("buildIdpAdapter('entra') returns an EntraIdpAdapter", () => {
  const adapter = buildIdpAdapter("entra");
  assert.equal(adapter.providerId, "entra");
});
```

Also add, after the existing Auth0IdpAdapter tests (after line 116), mirroring the same structure for `EntraIdpAdapter`:

```js
import { EntraIdpAdapter } from "../dist/idp-adapter.js";

const ENTRA_ENV_KEYS = [
  "ENTRA_TENANT_ID",
  "ENTRA_CLIENT_ID",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_API_APP_ID",
];

function clearEntraAdapterEnv() {
  const saved = {};
  for (const key of ENTRA_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENTRA_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test("EntraIdpAdapter reports providerId 'entra'", () => {
  const restore = clearEntraAdapterEnv();
  try {
    const adapter = new EntraIdpAdapter();
    assert.equal(adapter.providerId, "entra");
  } finally {
    restore();
  }
});

test("EntraIdpAdapter.isManagementConfigured() is false when ENTRA_* unset", () => {
  const restore = clearEntraAdapterEnv();
  try {
    const adapter = new EntraIdpAdapter();
    assert.equal(adapter.isManagementConfigured(), false);
  } finally {
    restore();
  }
});

test("EntraIdpAdapter.isVendingConfigured() is false when ENTRA_TENANT_ID/API_APP_ID unset", () => {
  const restore = clearEntraAdapterEnv();
  try {
    const adapter = new EntraIdpAdapter();
    assert.equal(adapter.isVendingConfigured(), false);
  } finally {
    restore();
  }
});

test("EntraIdpAdapter.isVendingConfigured() is true when ENTRA_TENANT_ID/API_APP_ID set", () => {
  const restore = clearEntraAdapterEnv();
  try {
    process.env.ENTRA_TENANT_ID = "tenant-id";
    process.env.ENTRA_API_APP_ID = "api-app-id";
    const adapter = new EntraIdpAdapter();
    assert.equal(adapter.isVendingConfigured(), true);
  } finally {
    restore();
  }
});

test("EntraIdpAdapter.vendToken() rejects when vending not configured", async () => {
  const restore = clearEntraAdapterEnv();
  try {
    const adapter = new EntraIdpAdapter();
    await assert.rejects(
      adapter.vendToken("client-id", "client-secret"),
      /ENTRA_TENANT_ID and ENTRA_API_APP_ID required for token vending/,
    );
  } finally {
    restore();
  }
});

test("EntraIdpAdapter.invalidateToken() does not throw when vending not configured", () => {
  const restore = clearEntraAdapterEnv();
  try {
    const adapter = new EntraIdpAdapter();
    assert.doesNotThrow(() => adapter.invalidateToken("client-id"));
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/idp-adapter.test.mjs`
Expected: FAIL — `EntraIdpAdapter` is not exported yet; `buildIdpAdapter('entra')` still throws.

- [ ] **Step 3: Implement `EntraIdpAdapter` and wire it into `buildIdpAdapter()`**

In `gateway/idp-adapter.ts`, add imports at the top:

```ts
import { entraTokenVendorFromEnv, entraApiAppIdFromEnv } from "./entra-token-vendor.js";
import { isEntraMgmtConfigured, createEntraAgent, deleteEntraAgent } from "./entra-mgmt.js";
```

Add the class after `Auth0IdpAdapter` (after line 46 in the current file):

```ts
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

  createAgent(name: string, scopes: string[]): Promise<CreatedAgentClient> {
    return createEntraAgent(name, scopes);
  }

  deleteAgent(clientId: string): Promise<void> {
    return deleteEntraAgent(clientId);
  }

  async vendToken(clientId: string, clientSecret: string): Promise<VendedToken> {
    if (!this.tokenVendor || !this.apiAppId) {
      throw new Error("ENTRA_TENANT_ID and ENTRA_API_APP_ID required for token vending");
    }
    return this.tokenVendor.vend(clientId, clientSecret, this.apiAppId);
  }

  invalidateToken(clientId: string): void {
    this.tokenVendor?.invalidate(clientId);
  }
}
```

Replace the `entra` case in `buildIdpAdapter()`:

```ts
    case "entra":
      return new EntraIdpAdapter();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/idp-adapter.test.mjs`
Expected: all tests PASS

- [ ] **Step 5: Run full gateway suite + typecheck**

Run: `npm run typecheck && npm run test -w @mcp-tool-guard/gateway`
Expected: PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add gateway/idp-adapter.ts gateway/tests/idp-adapter.test.mjs
git commit -m "feat(gateway): wire EntraIdpAdapter into buildIdpAdapter()"
```

---

### Task 5: Surface `client_secret` once in `/agents.html` (completes BL-048)

**Files:**
- Modify: `ui/src/agents-main.ts:41-48` (`ActiveAgent` interface — no change needed, already has `clientSecret: string`)
- Modify: `ui/src/agents-main.ts:420-453` (create-agent handler — stop discarding the secret)
- Modify: `ui/src/agents-main.ts:290-326` (`renderAgentCards()` — one-time secret display)
- Modify: `ui/agents.html` (add a dismissible secret-display container if not already present as a generic element)

**Interfaces:**
- Consumes: `createAgent()` (`ui/src/proxy-api.ts:113-128`, already returns `clientSecret` in its response — no proxy-api.ts change needed)
- Produces: a `secretShown: boolean` flag per `ActiveAgent` so the secret only ever renders once, then is cleared from memory.

- [ ] **Step 1: Update `ActiveAgent` interface and the create-agent handler to keep the secret, once**

In `ui/src/agents-main.ts`, change the interface at lines 41-48:

```ts
interface ActiveAgent {
  name: string;
  clientId: string;
  clientSecret: string;
  secretShown: boolean;
  token: string;
  scopes: string[];
  serverId: string;
}
```

Change the create-agent handler at lines 436-443 — stop discarding the secret:

```ts
    const agent: ActiveAgent = {
      name: created.name,
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      secretShown: false,
      token: vended.token,
      scopes,
      serverId: created.serverId ?? serverId,
    };
```

- [ ] **Step 2: Render the secret once in `renderAgentCards()`, with a copy button and explicit one-time warning**

Replace the card template in `renderAgentCards()` (lines 292-300):

```ts
function renderAgentCards(): void {
  agentListEl.innerHTML = agents
    .map(
      (a) => `<div class="card ${selectedAgent?.clientId === a.clientId ? "card-active" : ""}">
        <strong>${a.name}</strong>
        <div class="card-meta">${a.serverId} · ${a.scopes.join(", ")}</div>
        <div class="card-meta mono">${a.clientId.slice(0, 12)}…</div>
        ${
          !a.secretShown
            ? `<div class="card-secret-warning">
                 <p>client_secret — shown once, save it now:</p>
                 <code class="mono" data-secret-for="${a.clientId}">${a.clientSecret}</code>
                 <button type="button" data-copy-secret="${a.clientId}">Copy</button>
                 <button type="button" data-dismiss-secret="${a.clientId}">I've saved it</button>
               </div>`
            : ""
        }
        <button type="button" data-select-agent="${a.clientId}">Use</button>
        <button type="button" data-revoke-agent="${a.clientId}" ${adminOpsEnabled ? "" : "disabled"}>Revoke</button>
      </div>`,
    )
    .join("");

  agentListEl.querySelectorAll("[data-copy-secret]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.copySecret!;
      const agent = agents.find((a) => a.clientId === id);
      if (agent) void navigator.clipboard.writeText(agent.clientSecret);
    });
  });

  agentListEl.querySelectorAll("[data-dismiss-secret]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.dismissSecret!;
      const agent = agents.find((a) => a.clientId === id);
      if (agent) {
        agent.secretShown = true;
        agent.clientSecret = ""; // clear from memory once acknowledged saved
        renderAgentCards();
      }
    });
  });

  agentListEl.querySelectorAll("[data-select-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.selectAgent!;
      void activateSelectedAgent(id);
    });
  });

  agentListEl.querySelectorAll("[data-revoke-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!adminOpsEnabled) return;
      const id = (btn as HTMLElement).dataset.revokeAgent!;
      void (async () => {
        await revokeAgent(id);
        agents = agents.filter((a) => a.clientId !== id);
        removeAgentSession(id);
        if (selectedAgent?.clientId === id) selectedAgent = null;
        gatewayAgent = null;
        syncSendButtonState();
        statusEl.textContent = "Select or create an agent, then Initialize";
        renderAgentCards();
      })();
    });
  });
}
```

- [ ] **Step 3: Add minimal CSS for the warning box (if `ui/` has a stylesheet)**

Run: `grep -rn "card-meta" ui/src/ ui/*.css ui/agents.html 2>/dev/null`

Add a `.card-secret-warning` rule near the existing `.card-meta` rule in whichever stylesheet defines it (e.g. a distinct background/border to make it visually stand out as sensitive, one-time content) — exact selector location depends on what the grep above finds.

- [ ] **Step 4: Manual verification (no automated UI test suite exists per CLAUDE.md)**

Run: `make dev`

1. Open `http://localhost:5173/agents.html`, sign in, create a new agent.
2. Confirm the `client_secret` renders once with a visible "Copy" and "I've saved it" button.
3. Click "I've saved it" — confirm the secret disappears from the card and `agent.clientSecret` is empty in memory (check via browser DevTools console: inspect the `agents` array is out of scope, but confirm no secret is visible in the rendered DOM after dismissal).
4. Refresh the page — confirm the secret is not recoverable (it was never persisted, matching the one-time-display design).

- [ ] **Step 5: Commit**

```bash
git add ui/src/agents-main.ts ui/agents.html
git commit -m "feat(ui): surface client_secret once from /agents.html create-agent flow (BL-048)"
```

---

### Task 6: Provider-driven login UI (config-driven single button)

**Files:**
- Modify: `ui/src/auth.ts` (add Entra/MSAL support + generic dispatcher functions)
- Modify: `ui/src/agents-main.ts:135-189` (`syncAdminUi()` — use generic dispatchers)
- Modify: `ui/agents.html` (sign-in button label becomes dynamic, not hardcoded "Sign in")
- Modify: `ui/package.json` (add `@azure/msal-browser`)

**Interfaces:**
- Consumes: none new
- Produces: `getIdpProvider(): "auth0" | "entra"`, and generic functions `login()`, `logout()`, `isAuthenticated()`, `getAccessToken()`, `getUserLabel()`, `hasGatewayAdminPermission()` (same name/signature as the existing Auth0-specific `hasGatewayAdminPermission()`, now provider-dispatching) that `agents-main.ts` calls instead of the Auth0-specific functions directly.

- [ ] **Step 1: Add the MSAL dependency**

```bash
npm install @azure/msal-browser -w ui
```

- [ ] **Step 2: Write the failing test for provider selection**

Create `ui/src/auth.test.mjs` (Node test runner against the built UI TS is not wired up in this project — CLAUDE.md confirms no UI test suite exists yet, so this step is a plain Node-runnable unit test file for the pure/non-DOM functions only, run directly with `node --test`, not part of any existing `npm run test` UI script):

```js
import assert from "node:assert/strict";
import { test } from "node:test";

// Only test the pure, DOM-free logic — getIdpProvider() reads import.meta.env,
// which requires the Vite build; instead test the fallback/default behavior
// via a small string-based helper extracted for testability.
import { normalizeIdpProvider } from "../dist-test/auth-provider.js";

test("normalizeIdpProvider() defaults to 'auth0' when unset", () => {
  assert.equal(normalizeIdpProvider(undefined), "auth0");
});

test("normalizeIdpProvider() accepts 'entra'", () => {
  assert.equal(normalizeIdpProvider("entra"), "entra");
});

test("normalizeIdpProvider() is case-insensitive", () => {
  assert.equal(normalizeIdpProvider("Entra"), "entra");
});

test("normalizeIdpProvider() throws on unrecognized value", () => {
  assert.throws(() => normalizeIdpProvider("okta"), /Unrecognized VITE_IDP_PROVIDER 'okta'/);
});
```

Since this needs a tiny standalone-compilable helper, create `ui/src/auth-provider.ts` (separate from `auth.ts` specifically so it has no `import.meta.env`/DOM dependency and can be compiled+tested standalone):

```ts
export type IdpProviderId = "auth0" | "entra";

export function normalizeIdpProvider(raw: string | undefined): IdpProviderId {
  const value = raw?.trim().toLowerCase();
  if (!value) return "auth0";
  if (value === "auth0" || value === "entra") return value;
  throw new Error(`Unrecognized VITE_IDP_PROVIDER '${raw}' — expected 'auth0' or 'entra'`);
}
```

- [ ] **Step 3: Run test to verify it fails, then compile the standalone helper and re-run**

Run: `node --test ui/src/auth.test.mjs`
Expected: FAIL — `Cannot find module '../dist-test/auth-provider.js'`

Run: `npx tsc ui/src/auth-provider.ts --outDir ui/dist-test --module esnext --target es2020`
Run: `node --test ui/src/auth.test.mjs`
Expected: all 4 PASS

- [ ] **Step 4: Wire `auth.ts` to dispatch on provider**

In `ui/src/auth.ts`, add at the top (after the existing `Auth0Client` import):

```ts
import {
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from "@azure/msal-browser";
import { normalizeIdpProvider, type IdpProviderId } from "./auth-provider.js";

export function getIdpProvider(): IdpProviderId {
  return normalizeIdpProvider(import.meta.env.VITE_IDP_PROVIDER);
}

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  apiAppId: string;
}

export function getEntraConfig(): EntraConfig | null {
  const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID?.trim();
  const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID?.trim();
  const apiAppId = import.meta.env.VITE_ENTRA_API_APP_ID?.trim();
  if (!tenantId || !clientId || !apiAppId) return null;
  return { tenantId, clientId, apiAppId };
}

export function jwtTrustFromEntra(config: EntraConfig): JwtTrustOptions {
  return {
    jwtIssuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    jwtAudience: `api://${config.apiAppId}`,
    jwksUrl: `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
  };
}

let msalClient: PublicClientApplication | null = null;
let msalAccount: AccountInfo | null = null;

async function getMsalClient(): Promise<PublicClientApplication> {
  const config = getEntraConfig();
  if (!config) {
    throw new Error("Entra is not configured (set VITE_ENTRA_* env vars)");
  }
  if (!msalClient) {
    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: "localStorage" },
    };
    msalClient = new PublicClientApplication(msalConfig);
    await msalClient.initialize();
    const redirectResult = await msalClient.handleRedirectPromise();
    if (redirectResult?.account) msalAccount = redirectResult.account;
  }
  return msalClient;
}

export async function isEntraAuthenticated(): Promise<boolean> {
  if (!getEntraConfig()) return false;
  const client = await getMsalClient();
  const accounts = client.getAllAccounts();
  if (accounts.length > 0) msalAccount = accounts[0];
  return msalAccount !== null;
}

export async function loginWithEntra(): Promise<void> {
  const client = await getMsalClient();
  const config = getEntraConfig();
  if (!config) throw new Error("Entra is not configured");
  await client.loginRedirect({ scopes: [`api://${config.apiAppId}/.default`] });
}

export async function logoutEntra(): Promise<void> {
  const client = await getMsalClient();
  await client.logoutRedirect();
}

export async function getEntraAccessToken(): Promise<string> {
  const client = await getMsalClient();
  const config = getEntraConfig();
  if (!config || !msalAccount) throw new Error("Not signed in with Entra");
  const result = await client.acquireTokenSilent({
    scopes: [`api://${config.apiAppId}/.default`],
    account: msalAccount,
  });
  return result.accessToken;
}

export async function getEntraUserLabel(): Promise<string> {
  return msalAccount?.username ?? msalAccount?.name ?? "Signed in";
}

// --- Generic, provider-dispatching functions used by the rest of the UI ---

export function getIdpConfig(): Auth0Config | EntraConfig | null {
  return getIdpProvider() === "entra" ? getEntraConfig() : getAuth0Config();
}

export function getSignInLabel(): string {
  return getIdpProvider() === "entra" ? "Sign in with Microsoft" : "Sign in with Auth0";
}

export async function isSignedIn(): Promise<boolean> {
  return getIdpProvider() === "entra" ? isEntraAuthenticated() : isAuth0Authenticated();
}

export async function login(): Promise<void> {
  if (getIdpProvider() === "entra") await loginWithEntra();
  else await loginWithAuth0();
}

export async function logout(): Promise<void> {
  if (getIdpProvider() === "entra") await logoutEntra();
  else await logoutAuth0();
}

export async function getAccessToken(): Promise<string> {
  return getIdpProvider() === "entra" ? getEntraAccessToken() : getAuth0AccessToken();
}

export async function getUserLabel(): Promise<string> {
  return getIdpProvider() === "entra" ? getEntraUserLabel() : getAuth0UserLabel();
}

export async function hasGatewayAdminAccess(): Promise<boolean> {
  if (!getIdpConfig()) return false;
  if (!(await isSignedIn())) return false;
  const token = await getAccessToken();
  if (getIdpProvider() === "entra") {
    return tokenHasEntraRole(token, GATEWAY_ADMIN_PERMISSION);
  }
  return tokenHasPermission(token, GATEWAY_ADMIN_PERMISSION);
}

export function rolesFromAccessToken(token: string): string[] {
  try {
    const segment = token.split(".")[1];
    if (!segment) return [];
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded)) as { roles?: string[] };
    return Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  } catch {
    return [];
  }
}

export function tokenHasEntraRole(token: string, role: string): boolean {
  const roles = rolesFromAccessToken(token);
  if (roles.includes(role)) return true;
  const [resource] = role.split(":");
  return roles.includes(`${resource}:*`) || roles.includes("*");
}
```

Finally, **replace** (not duplicate — this is a modification of existing code) the original `handleAuthRedirect()` function at `ui/src/auth.ts:63-73` so it dispatches by provider instead of being Auth0-only. `syncAdminUi()` calls this unconditionally on every load, before checking authentication state, so both providers need their redirect-callback handling to run through it:

```ts
export async function handleAuthRedirect(): Promise<void> {
  if (getIdpProvider() === "entra") {
    await getMsalClient(); // handleRedirectPromise() runs inside its lazy init, see Step 4 above
    return;
  }
  const config = getAuth0Config();
  if (!config) return;
  const query = window.location.search;
  if (!query.includes("code=") && !query.includes("state=")) return;
  const auth0 = await getAuth0Client();
  await auth0.handleRedirectCallback();
  window.history.replaceState({}, document.title, window.location.pathname);
}
```

- [ ] **Step 5: Update `syncAdminUi()` in `ui/src/agents-main.ts` to use the generic dispatchers**

Replace the imports at the top of `ui/src/agents-main.ts` that currently pull in `getAuth0Config`, `isAuth0Authenticated`, `hasGatewayAdminPermission`, `getAuth0UserLabel`, `loginWithAuth0`, `logoutAuth0` with the generic equivalents: `getIdpConfig`, `isSignedIn`, `hasGatewayAdminAccess`, `getUserLabel`, `login`, `logout`, `getSignInLabel`. The existing `handleAuthRedirect` import stays — it's the same name, now provider-dispatching per the replacement above, so the `await handleAuthRedirect();` call site itself (line 160) needs no change.

Then update `syncAdminUi()` (lines 135-189) to call the generic names — e.g. line 136 `const auth0Config = getAuth0Config();` becomes `const idpConfig = getIdpConfig();`, and downstream `if (!auth0Config)`/`await isAuth0Authenticated()`/`await hasGatewayAdminPermission()`/`await getAuth0UserLabel()` become `if (!idpConfig)`/`await isSignedIn()`/`await hasGatewayAdminAccess()`/`await getUserLabel()`. The button click handlers (previously `loginWithAuth0()`/`logoutAuth0()`) become `login()`/`logout()`.

Add one new line to set the button's label dynamically, right after `authControls.hidden = false;` (line 159):

```ts
  authLoginBtn.textContent = getSignInLabel();
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors across gateway + ui + workspaces)

- [ ] **Step 7: Manual verification**

Run: `make dev` with `VITE_IDP_PROVIDER=entra` and `VITE_ENTRA_*` set in `ui/.env.local` (against a real dev Entra tenant from Task 7's setup script).

1. Confirm the sign-in button reads "Sign in with Microsoft".
2. Click it, confirm redirect to Entra's real login page, sign in, confirm redirect back and `authStatusEl` shows your Entra user label.
3. Switch `.env.local` back to `VITE_IDP_PROVIDER=auth0` (or unset it), restart `make ui`, confirm the button reverts to "Sign in with Auth0" and Auth0 login still works unchanged.

- [ ] **Step 8: Commit**

```bash
git add ui/src/auth.ts ui/src/auth-provider.ts ui/src/auth.test.mjs ui/src/agents-main.ts ui/package.json ui/package-lock.json
git commit -m "feat(ui): config-driven single sign-in button (Auth0 or Entra via VITE_IDP_PROVIDER)"
```

---

### Task 7: `scripts/entra-setup.sh` — scripted one-time tenant setup

**Files:**
- Create: `scripts/entra-setup.sh`

**Interfaces:**
- Consumes: `az` CLI (already-authenticated `az login` session), an existing Entra tenant
- Produces: prints the env vars needed for Tasks 2-6 (`ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET`, `ENTRA_API_APP_ID`, `VITE_ENTRA_*`) to stdout for the operator to copy into `ui/.env.local` / `scripts/dev.env`.

- [ ] **Step 1: Write the script**

Create `scripts/entra-setup.sh`:

```bash
#!/usr/bin/env bash
# One-time Entra tenant setup for mcp-tool-guard, scripted via az CLI.
# Prerequisite (manual, portal-only): an Entra tenant must already exist
# (Azure Portal -> Microsoft Entra ID -> Manage tenants -> + Create, ~5 min).
# Run `az login` against that tenant before running this script.
set -euo pipefail

API_APP_NAME="${API_APP_NAME:-mcp-tool-guard-api}"
MGMT_APP_NAME="${MGMT_APP_NAME:-mcp-tool-guard-mgmt}"
SPA_APP_NAME="${SPA_APP_NAME:-mcp-tool-guard-spa}"

echo "== Tenant =="
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "ENTRA_TENANT_ID=$TENANT_ID"

echo "== Protected API app registration =="
API_APP_ID="$(az ad app create --display-name "$API_APP_NAME" --query appId -o tsv)"
echo "ENTRA_API_APP_ID=$API_APP_ID"

echo "== Expose an API + define App Roles matching existing scope strings =="
az ad app update --id "$API_APP_ID" --identifier-uris "api://$API_APP_ID"

# App Roles: allowedMemberTypes "Application" makes these assignable to
# service principals (M2M agents), not just interactive users. Extend this
# list to match gateway/config.yaml's required_scope values as new tools/
# servers are added.
ROLE_JSON=$(cat <<EOF
[
  {"allowedMemberTypes": ["Application"], "displayName": "flights:read", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:read"},
  {"allowedMemberTypes": ["Application"], "displayName": "flights:write", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:write"},
  {"allowedMemberTypes": ["Application"], "displayName": "flights:delete", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:delete"},
  {"allowedMemberTypes": ["Application"], "displayName": "repo:read", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "repo:read"},
  {"allowedMemberTypes": ["Application"], "displayName": "repo:write", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "repo:write"},
  {"allowedMemberTypes": ["User"], "displayName": "gateway:admin", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "gateway:admin"}
]
EOF
)
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$(az ad app show --id "$API_APP_ID" --query id -o tsv)" \
  --headers "Content-Type=application/json" \
  --body "{\"appRoles\": $ROLE_JSON}"

echo "== Management app (Graph API calls: create/delete M2M agents) =="
MGMT_APP_ID="$(az ad app create --display-name "$MGMT_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
MGMT_SECRET="$(az ad app credential reset --id "$MGMT_APP_ID" --query password -o tsv)"
echo "ENTRA_CLIENT_ID=$MGMT_APP_ID"
echo "ENTRA_CLIENT_SECRET=$MGMT_SECRET"

echo "== Granting management app Graph Application.ReadWrite.OwnedBy + admin consent =="
az ad app permission add --id "$MGMT_APP_ID" \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions 18a4783c-866b-4cc7-a460-3d5e5662c884=Role
az ad app permission admin-consent --id "$MGMT_APP_ID"

echo "== SPA app registration (human browser login) =="
SPA_APP_ID="$(az ad app create --display-name "$SPA_APP_NAME" \
  --spa-redirect-uris "http://localhost:5173" \
  --query appId -o tsv)"
echo "VITE_ENTRA_CLIENT_ID=$SPA_APP_ID"
echo "VITE_ENTRA_TENANT_ID=$TENANT_ID"
echo "VITE_ENTRA_API_APP_ID=$API_APP_ID"

echo ""
echo "Done. Copy the ENTRA_* lines above into scripts/dev.env (gateway) and"
echo "the VITE_ENTRA_* lines into ui/.env.local, alongside VITE_IDP_PROVIDER=entra."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/entra-setup.sh
```

- [ ] **Step 3: Verify script syntax (no live Azure call — that requires a real tenant, exercised manually per the design doc's "no new deployed/e2e smoke test in this phase" decision)**

Run: `bash -n scripts/entra-setup.sh`
Expected: no output (syntax valid)

- [ ] **Step 4: Commit**

```bash
git add scripts/entra-setup.sh
git commit -m "feat(scripts): add az-cli-scripted one-time Entra tenant setup"
```

---

### Task 8: Retire the prod static-token workaround

**Files:**
- Delete: `scripts/claude-mcp-token-helper-prod-demo.sh`
- Modify: `docs/claude-code-demo.md`

**Interfaces:**
- Consumes: `scripts/claude-mcp-token-helper.sh` (existing, unchanged — already does the right `client_credentials` self-mint against whichever IdP the proxy is configured for)
- Produces: nothing new — this task removes dead code now that Task 5 makes `client_secret` available for real agents in prod, so the already-correct local-dev helper script works in prod too.

- [ ] **Step 1: Remove the static-token helper script**

```bash
git rm scripts/claude-mcp-token-helper-prod-demo.sh
```

- [ ] **Step 2: Update `docs/claude-code-demo.md` to point at the real self-refreshing script**

Run: `grep -n "claude-mcp-token-helper-prod-demo\|MCP_PROD_STATIC_TOKEN\|grabbed an admin access token" docs/claude-code-demo.md`

Replace whatever section that grep surfaces (the "grab a token from DevTools, store as `MCP_PROD_STATIC_TOKEN`" instructions) with: create a prod agent via `/agents.html` against the deployed Render proxy, copy its now-visible `client_id`/`client_secret` (per Task 5), and configure `.mcp.json`'s `headersHelper` to point at the same `scripts/claude-mcp-token-helper.sh` used locally, with `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET` set to the prod agent's credentials and `PROXY_URL` set to the Render URL instead of `http://localhost:8787`.

- [ ] **Step 3: Manual verification**

Follow the updated `docs/claude-code-demo.md` steps against the real deployed proxy; confirm Claude Code successfully calls a tool with a token self-minted via `client_credentials`, with no static token and no DevTools step anywhere in the flow.

- [ ] **Step 4: Commit**

```bash
git add docs/claude-code-demo.md
git commit -m "docs: retire static-token prod workaround now that client_secret is surfaced (BL-048)"
```

---

### Task 9: `docs/entra-setup.md` + identity doc updates

**Files:**
- Create: `docs/entra-setup.md`
- Modify: `docs/identity.md`

**Interfaces:** none (docs only)

- [ ] **Step 1: Write `docs/entra-setup.md`**

Follow `docs/auth0-setup.md`'s structure (Part 1 dashboard/script setup, Part 2 local dev env vars, Part 3 token verification, troubleshooting table) but lead with `scripts/entra-setup.sh` (Task 7) as the primary path, documenting the portal-only tenant-creation step as the one prerequisite, and the env var table:

| Variable | Where | Source |
|---|---|---|
| `ENTRA_TENANT_ID` | gateway (`scripts/dev.env`) | `entra-setup.sh` output |
| `ENTRA_CLIENT_ID`/`ENTRA_CLIENT_SECRET` | gateway | management app, `entra-setup.sh` output |
| `ENTRA_API_APP_ID` | gateway | protected API app, `entra-setup.sh` output |
| `MCP_IDP_PROVIDER=entra` | gateway | explicit selector, per BL-034 |
| `VITE_IDP_PROVIDER=entra` | ui (`.env.local`) | selects the UI's login flow |
| `VITE_ENTRA_TENANT_ID`/`VITE_ENTRA_CLIENT_ID`/`VITE_ENTRA_API_APP_ID` | ui | SPA app, `entra-setup.sh` output |

Include a troubleshooting row for the one known Entra-specific friction point: "App Role not assignable to service principal" → cause: `allowedMemberTypes` on that role wasn't set to `"Application"` → fix: re-run the `az rest` PATCH step in `entra-setup.sh` with the correct member type.

- [ ] **Step 2: Update `docs/identity.md` to document the second IdP option**

Run: `grep -n "Auth0\|single.*IdP\|MCP_IDP_PROVIDER" docs/identity.md`

Add a short "Entra ID" subsection alongside whatever existing Auth0-specific identity documentation the grep surfaces, cross-referencing `docs/entra-setup.md` and reiterating the single-active-provider model from BL-034 (link `docs/superpowers/specs/2026-07-18-idp-trust-model-design.md`).

- [ ] **Step 3: Commit**

```bash
git add docs/entra-setup.md docs/identity.md
git commit -m "docs: add Entra ID setup guide, cross-link from identity.md"
```

---

### Task 10: CHANGELOG + backlog.md updates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `backlog.md`

**Interfaces:** none (docs/tracking only)

- [ ] **Step 1: Add a CHANGELOG entry under `[Unreleased]`**

In `CHANGELOG.md`, under `### Added`, add:

```markdown
- **Microsoft Entra ID as a second IdP** (`MCP_IDP_PROVIDER=entra`) — `EntraIdpAdapter`/Graph API M2M agent lifecycle (`gateway/entra-mgmt.ts`), Entra `client_credentials` token vending (`gateway/entra-token-vendor.ts`), `roles` claim support in `DefaultJwtValidator.extractScopes()`, config-driven single sign-in button in the browser harness (Auth0 or Entra per `VITE_IDP_PROVIDER`), and a scripted one-time tenant setup (`scripts/entra-setup.sh`). Single-active-provider only, per BL-034 — no concurrent Auth0+Entra trust.
- **`/agents.html` now surfaces the M2M `client_secret`** on agent creation (BL-048) — retires the static pre-vended-token workaround documented in `docs/claude-code-demo.md`; Claude Code's existing `headersHelper` self-mints fresh tokens via `client_credentials` in prod exactly as it already did locally.
```

- [ ] **Step 2: Update `backlog.md` per the approved design doc's backlog-update appendix**

Read `docs/superpowers/specs/2026-08-08-entra-idp-and-agent-tokens-design.md`'s final section ("Backlog updates to apply once this spec is approved") and apply each item:

- `BL-021`: change `status: todo` to `status: done`; add a note that "concurrent trust" language was already dropped per BL-034.
- `BL-029`: mark `status: done`, note it was implemented as part of BL-021 (App Roles named identically to scope strings — no separate `role_mappings` translation layer needed; unmapped roles simply aren't present in the token's `roles` claim, so `ToolGuard`'s existing scope-check already denies them by default).
- `BL-041`: add a note "deliberately skipped in favor of going straight to Entra — the `JwtValidator`/`IdpAdapter` abstraction was already interface-complete and Auth0-proven, so Keycloak-first de-risking wasn't needed."
- `BL-048`: mark `status: done`.
- `BL-027`/`BL-028`: their entire premise — a stdio transport bridge (BL-027) plus human-delegated Entra SSO token acquisition for that bridge (BL-028) — is superseded now that agents (Claude Code included) use their own M2M identity over the existing HTTP transport, which already works today via `headersHelper` (Task 8). No remaining scope survives once that framing is removed, so remove both rows from `backlog.md` entirely (per its own rule 3: completed/resolved items move to `CHANGELOG.md`, not left in place). Add one line to the `CHANGELOG.md` entry from Step 1's `### Added` block, under a new `### Removed` heading:

  ```markdown
  ### Removed

  - **BL-027/BL-028** (Claude Desktop stdio transport shim + human-delegated Entra SSO token acquisition for it) — superseded by the M2M-agent-identity model this release ships: Claude Code already gets its own token via `client_credentials` over the existing HTTP transport (`headersHelper`), so neither a stdio bridge nor a human-delegated OAuth flow is needed.
  ```
- `BL-049`: leave as-is (`status: todo`, still unscoped, out of this spec's scope).
- `BL-052`: mark `status: done`, with the research finding recorded (Claude Code has native MCP OAuth support; not adopted here because agents keep their own M2M identity rather than a human-delegated token).

Per `backlog.md`'s own rule #3 ("Move completed items to CHANGELOG.md, then remove them here"), move the newly-`done` items' summaries into the CHANGELOG entry from Step 1 if not already covered there, then remove their rows from `backlog.md`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md backlog.md
git commit -m "docs: update CHANGELOG and backlog for Entra IdP + agent token work"
```

---

## After all tasks: push and hand off for PR

Per this project's workflow rules — **never merge or create the PR yourself**, hand the user the compare URL:

```bash
git push -u origin feature/entra-idp-adapter
```

Give the user: `https://github.com/peterkrentel/mcp-tool-guard/compare/main...feature/entra-idp-adapter` plus a suggested PR title (e.g. "Add Microsoft Entra ID as a second IdP + M2M agent token self-refresh") and body summarizing Tasks 1-10.
