# BL-020: IdpAdapter Interface + Auth0 Implementation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an `IdpAdapter` interface from the Auth0-specific management/token-vending code so the gateway's control-plane routes depend on an injected interface, then wire single-active-provider selection (`MCP_IDP_PROVIDER`) per the BL-034 design spec (`docs/superpowers/specs/2026-07-18-idp-trust-model-design.md`).

**Architecture:** New `gateway/idp-adapter.ts` defines `IdpAdapter` and wraps the existing `gateway/auth0-mgmt.ts` (create/delete M2M client) and `gateway/token-vendor.ts` (client_credentials vending) logic, unchanged, behind the interface — same pattern as BL-019's `JwtValidator` extraction. A new `idpProviderIdFromEnv()` (env.ts) + `buildIdpAdapter()` (idp-adapter.ts) pair select and construct the one active provider at startup, failing loudly on an unrecognized or not-yet-implemented value. `gateway/proxy-routes-agents-token.ts` and `gateway/proxy-server.ts` are updated to consume `IdpAdapter` instead of the raw Auth0 functions.

**Tech Stack:** TypeScript (Node's built-in `node:test` runner), existing `jose`/`node:http` test patterns already used in `gateway/tests/`.

## Global Constraints

- Every step that changes code must be preceded by a failing test (TDD) — no exceptions.
- `Auth0IdpAdapter` must preserve every existing status code, error message string, and control-flow branch in `gateway/auth0-mgmt.ts`, `gateway/token-vendor.ts`, and `gateway/proxy-routes-agents-token.ts` exactly — this is BL-020's literal acceptance criterion. Do not "improve" messages or behavior along the way.
- Real Auth0 HTTP calls are never mocked in this plan's unit tests — only the "not configured" / "not vending-configured" branches are testable without live Auth0 credentials, matching existing project convention (real happy-path Auth0 coverage is tracked separately as BL-036).
- `npm run build -w @mcp-tool-guard/gateway` must be run before any `node --test` invocation in this plan, since tests import from `gateway/dist/`.
- `npm run typecheck` must pass before any commit that touches `.ts` files.
- Every commit needs a `CHANGELOG.md` entry under `[Unreleased]` (repo pre-commit hook enforces this).
- Branch: create `feature/bl-020-idp-adapter` off `main` before Task 1.

---

### Task 1: `IdpAdapter` interface + `Auth0IdpAdapter` wrapping existing logic

**Files:**
- Create: `gateway/idp-adapter.ts`
- Test: `gateway/tests/idp-adapter.test.mjs`

**Interfaces:**
- Consumes: `createM2mAgent(name: string, scopes: string[]): Promise<CreatedAgentClient>`, `deleteM2mAgent(clientId: string): Promise<void>`, `isAuth0MgmtConfigured(): boolean` from `gateway/auth0-mgmt.ts` (unchanged, existing exports). `TokenVendor` class, `tokenVendorFromEnv(): TokenVendor | null`, `auth0AudienceFromEnv(): string | null` from `gateway/token-vendor.ts` (unchanged, existing exports).
- Produces: `IdpAdapter` interface (`providerId: IdpProviderId`, `isManagementConfigured(): boolean`, `isVendingConfigured(): boolean`, `createAgent(name, scopes): Promise<CreatedAgentClient>`, `deleteAgent(clientId): Promise<void>`, `vendToken(clientId, clientSecret): Promise<VendedToken>`, `invalidateToken(clientId): void`), `CreatedAgentClient`, `VendedToken`, `IdpProviderId` type, `Auth0IdpAdapter` class — all consumed by Task 2 and Task 4.

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/idp-adapter.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";

import { Auth0IdpAdapter } from "../dist/idp-adapter.js";

const ENV_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_MGMT_CLIENT_ID",
  "AUTH0_MGMT_CLIENT_SECRET",
  "AUTH0_AUDIENCE",
];

function clearAuth0Env() {
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

test("Auth0IdpAdapter reports providerId 'auth0'", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.providerId, "auth0");
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isManagementConfigured() is false when AUTH0_MGMT_* unset", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isManagementConfigured(), false);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isVendingConfigured() is false when AUTH0_DOMAIN/AUDIENCE unset", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isVendingConfigured(), false);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isVendingConfigured() is true when AUTH0_DOMAIN/AUDIENCE set", () => {
  const restore = clearAuth0Env();
  try {
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_AUDIENCE = "https://example.com/api";
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isVendingConfigured(), true);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.createAgent() rejects with existing message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.createAgent("test-agent", ["flights:read"]),
      /Auth0 Management API not configured — set AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_AUDIENCE/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.deleteAgent() rejects with existing message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.deleteAgent("some-client-id"),
      /Auth0 Management API not configured/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.vendToken() rejects when vending not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.vendToken("client-id", "client-secret"),
      /AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.invalidateToken() does not throw when vending not configured", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.doesNotThrow(() => adapter.invalidateToken("client-id"));
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/idp-adapter.test.mjs`
Expected: FAIL — `Cannot find module '../dist/idp-adapter.js'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `gateway/idp-adapter.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/idp-adapter.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/idp-adapter.ts gateway/tests/idp-adapter.test.mjs
git commit -m "feat(gateway): add IdpAdapter interface + Auth0IdpAdapter wrapper"
```

(Add a `CHANGELOG.md` `[Unreleased]` entry describing this before committing — the pre-commit hook requires it.)

---

### Task 2: Provider selection — `idpProviderIdFromEnv()` + `buildIdpAdapter()` (fail-closed)

**Files:**
- Modify: `gateway/env.ts`
- Modify: `gateway/idp-adapter.ts`
- Modify: `gateway/index.ts`
- Test: `gateway/tests/idp-adapter.test.mjs` (append)

**Interfaces:**
- Consumes: `IdpProviderId`, `IdpAdapter`, `Auth0IdpAdapter` from Task 1.
- Produces: `idpProviderIdFromEnv(): IdpProviderId` (env.ts), `buildIdpAdapter(providerId: IdpProviderId): IdpAdapter` (idp-adapter.ts) — both consumed by Task 4's `proxy-server.ts` wiring. `gateway/index.ts` now also exports `IdpAdapter`, `IdpProviderId`, `CreatedAgentClient`, `VendedToken`, `Auth0IdpAdapter`, `buildIdpAdapter`.

- [ ] **Step 1: Write the failing test**

Append to `gateway/tests/idp-adapter.test.mjs`:

```javascript
import { buildIdpAdapter } from "../dist/idp-adapter.js";
import { idpProviderIdFromEnv } from "../dist/env.js";

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

test("idpProviderIdFromEnv() defaults to 'auth0' when MCP_IDP_PROVIDER unset", () => {
  withEnv("MCP_IDP_PROVIDER", undefined, () => {
    assert.equal(idpProviderIdFromEnv(), "auth0");
  });
});

test("idpProviderIdFromEnv() returns explicit value when set", () => {
  withEnv("MCP_IDP_PROVIDER", "keycloak", () => {
    assert.equal(idpProviderIdFromEnv(), "keycloak");
  });
});

test("idpProviderIdFromEnv() is case-insensitive", () => {
  withEnv("MCP_IDP_PROVIDER", "Auth0", () => {
    assert.equal(idpProviderIdFromEnv(), "auth0");
  });
});

test("idpProviderIdFromEnv() throws on an unrecognized value", () => {
  withEnv("MCP_IDP_PROVIDER", "okta", () => {
    assert.throws(() => idpProviderIdFromEnv(), /Unrecognized MCP_IDP_PROVIDER 'okta'/);
  });
});

test("buildIdpAdapter('auth0') returns an Auth0IdpAdapter", () => {
  const adapter = buildIdpAdapter("auth0");
  assert.equal(adapter.providerId, "auth0");
});

test("buildIdpAdapter('keycloak') throws not-yet-implemented", () => {
  assert.throws(() => buildIdpAdapter("keycloak"), /keycloak.*not yet implemented/i);
});

test("buildIdpAdapter('entra') throws not-yet-implemented", () => {
  assert.throws(() => buildIdpAdapter("entra"), /entra.*not yet implemented/i);
});

test("dist/index.js exports the IdpAdapter public surface", async () => {
  const indexModule = await import("../dist/index.js");
  assert.equal(typeof indexModule.Auth0IdpAdapter, "function");
  assert.equal(typeof indexModule.buildIdpAdapter, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/idp-adapter.test.mjs`
Expected: FAIL — `idpProviderIdFromEnv is not a function` / `buildIdpAdapter is not a function` (build will also fail to find these exports).

- [ ] **Step 3: Write minimal implementation**

Add to `gateway/env.ts` (append, do not modify existing functions):

```typescript
import type { IdpProviderId } from "./idp-adapter.js";

const KNOWN_IDP_PROVIDERS: IdpProviderId[] = ["auth0", "keycloak", "entra"];

/**
 * Selects the single active IdP provider for this deployment.
 * Defaults to "auth0" when unset — matches today's behavior, where the
 * Auth0 management/token-vending code paths are always attempted
 * unconditionally regardless of any other config.
 */
export function idpProviderIdFromEnv(): IdpProviderId {
  const raw = process.env.MCP_IDP_PROVIDER?.trim().toLowerCase();
  if (!raw) return "auth0";
  if (!KNOWN_IDP_PROVIDERS.includes(raw as IdpProviderId)) {
    throw new Error(
      `Unrecognized MCP_IDP_PROVIDER '${raw}' — expected one of: ${KNOWN_IDP_PROVIDERS.join(", ")}`,
    );
  }
  return raw as IdpProviderId;
}
```

Add to `gateway/idp-adapter.ts` (append):

```typescript
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
```

Update `gateway/index.ts` — add to the existing export block (append a new `export` statement, don't touch the `guard.js` one):

```typescript
export {
  type IdpAdapter,
  type IdpProviderId,
  type CreatedAgentClient,
  type VendedToken,
  Auth0IdpAdapter,
  buildIdpAdapter,
} from "./idp-adapter.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/idp-adapter.test.mjs`
Expected: PASS (16 tests total)

- [ ] **Step 5: Commit**

```bash
git add gateway/env.ts gateway/idp-adapter.ts gateway/index.ts gateway/tests/idp-adapter.test.mjs
git commit -m "feat(gateway): add MCP_IDP_PROVIDER selection with fail-closed validation"
```

---

### Task 3: Wire `proxy-routes-agents-token.ts` to consume `IdpAdapter`

**Files:**
- Modify: `gateway/proxy-routes-agents-token.ts`

**Interfaces:**
- Consumes: `IdpAdapter` from Task 1/2 (`gateway/idp-adapter.js`).
- Produces: `HandleAgentsTokenRoutesOptions.idpAdapter: IdpAdapter` (required, not nullable) — consumed by Task 4's `proxy-server.ts` call site.

This task has no new automated test of its own — its behavior is covered by the existing `gateway/tests/proxy-auth.test.mjs` suite (already asserts the 401/503 contracts this task must preserve) and gets exercised end-to-end in Task 4. Do not skip re-running `proxy-auth.test.mjs` after this task; Task 4 covers that.

- [ ] **Step 1: Modify the file**

In `gateway/proxy-routes-agents-token.ts`, replace the import block:

```typescript
import { encryptClientSecret } from "./agent-secrets.js";
import {
  buildAgentRecord,
  deleteAgent,
  getAgentClientSecret,
  listAgents,
  saveAgent,
} from "./agent-store.js";
import { requireGatewayAdmin } from "./admin-auth.js";
import type { ToolGuard } from "./guard.js";
import type { IdpAdapter } from "./idp-adapter.js";
import { readJson, sendJson } from "./http-helpers.js";
```

(This removes `import { createM2mAgent, deleteM2mAgent } from "./auth0-mgmt.js";` and `import type { TokenVendor } from "./token-vendor.js";`, and adds the `IdpAdapter` type import.)

Replace the options interface:

```typescript
export interface HandleAgentsTokenRoutesOptions {
  guard: ToolGuard;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  controlPlaneAuth: boolean;
  idpAdapter: IdpAdapter;
}
```

Update the function signature destructure:

```typescript
export async function handleAgentsTokenRoutes(
  options: HandleAgentsTokenRoutesOptions,
): Promise<boolean> {
  const {
    guard,
    req,
    res,
    pathname,
    controlPlaneAuth,
    idpAdapter,
  } = options;
```

In the `POST /agents` handler, replace:

```typescript
      const created = await createM2mAgent(body.name, body.scopes ?? []);
```

with:

```typescript
      const created = await idpAdapter.createAgent(body.name, body.scopes ?? []);
```

In the `POST /agents/:clientId/token` handler, replace:

```typescript
    /** POST /agents/:clientId/token — vend JWT using secret stored at create (gateway:admin). */
    if (!tokenVendor || !apiAudience) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
```

with:

```typescript
    /** POST /agents/:clientId/token — vend JWT using secret stored at create (gateway:admin). */
    if (!idpAdapter.isVendingConfigured()) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
```

and further down in the same handler, replace:

```typescript
      const vended = await tokenVendor.vend(clientId, clientSecret, apiAudience);
```

with:

```typescript
      const vended = await idpAdapter.vendToken(clientId, clientSecret);
```

In the `DELETE /agents/:clientId` handler, replace:

```typescript
      await deleteM2mAgent(clientId);
      await deleteAgent(clientId);
      tokenVendor?.invalidate(clientId);
```

with:

```typescript
      await idpAdapter.deleteAgent(clientId);
      await deleteAgent(clientId);
      idpAdapter.invalidateToken(clientId);
```

In the `POST /token` handler, replace:

```typescript
  if (req.method === "POST" && pathname === "/token") {
    if (!tokenVendor || !apiAudience) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
```

with:

```typescript
  if (req.method === "POST" && pathname === "/token") {
    if (!idpAdapter.isVendingConfigured()) {
      sendJson(res, 503, { error: "AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending" });
      return true;
    }
```

and further down in the same handler, replace:

```typescript
      const vended = await tokenVendor.vend(
        body.clientId,
        body.clientSecret,
        apiAudience,
      );
```

with:

```typescript
      const vended = await idpAdapter.vendToken(body.clientId, body.clientSecret);
```

- [ ] **Step 2: Typecheck (this file will not compile until Task 4 updates its caller — that's expected)**

Run: `npm run build -w @mcp-tool-guard/gateway`
Expected: FAIL — `proxy-server.ts` still calls `handleAgentsTokenRoutes` with the old `tokenVendor`/`apiAudience` options shape. This is expected; Task 4 fixes the call site. Do not commit yet — Task 3 and Task 4 land in a single commit together since neither compiles independently once this edit is made (the type contract changed on both sides of one call).

Continue directly to Task 4 before committing.

---

### Task 4: Wire `proxy-server.ts` — fail-closed startup, `/health`, and route call site

**Files:**
- Modify: `gateway/proxy-server.ts`
- Modify: `gateway/tests/proxy-auth.test.mjs`

**Interfaces:**
- Consumes: `idpProviderIdFromEnv()` (env.ts, Task 2), `buildIdpAdapter()` (idp-adapter.ts, Task 2), `HandleAgentsTokenRoutesOptions.idpAdapter` (Task 3).
- Produces: nothing further consumed downstream — this is the top of the wiring chain.

- [ ] **Step 1: Update the existing `/health` test assertion first (this is the failing test for this task)**

In `gateway/tests/proxy-auth.test.mjs`, in the `"GET /health returns expected baseline flags"` test, replace:

```javascript
  assert.equal(body.jwt_trust_enabled, true);
```

with:

```javascript
  assert.equal(body.idp_provider, "auth0");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/proxy-auth.test.mjs`
Expected: This step will actually fail to even build/run cleanly right now, because Task 3's edit to `proxy-routes-agents-token.ts` broke the call site in `proxy-server.ts`. That compile failure — plus, once fixed, `body.idp_provider` being `undefined` — is the "red" state this task turns green. Confirm you see a build error mentioning `proxy-server.ts` and the `handleAgentsTokenRoutes` call before proceeding.

- [ ] **Step 3: Modify `gateway/proxy-server.ts`**

Replace the import block (remove the two now-unused imports, add the two new ones):

```typescript
import {
  auditAgentTrustedMode,
  guardEnabled,
  m2mRevocationEnabled,
  jwtTrustFromEnv,
  idpProviderIdFromEnv,
  readPublicKeyPem,
} from "./env.js";
import { ToolGuard } from "./guard.js";
import { buildIdpAdapter } from "./idp-adapter.js";
import { clientIp, kvRateLimitExceeded, SlidingWindowRateLimiter } from "./rate-limit.js";
import { ServerRegistry } from "./server-registry.js";
import {
  withHttpRequestSpan,
} from "./telemetry.js";
```

(Remove the separate `import { auth0AudienceFromEnv, tokenVendorFromEnv } from "./token-vendor.js";` import block entirely — it's no longer used directly in this file.)

In `main()`, replace:

```typescript
  const tokenVendor = tokenVendorFromEnv();
  const apiAudience = auth0AudienceFromEnv();
```

with:

```typescript
  let idpAdapter;
  try {
    idpAdapter = buildIdpAdapter(idpProviderIdFromEnv());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[MCPToolGuard proxy] Fatal IdP config error: ${message}`);
    process.exit(1);
  }
```

In the `/health` handler, replace:

```typescript
          jwt_trust_enabled: Boolean(jwtTrust.jwtIssuer),
          control_plane_auth: controlPlaneAuth,
          m2m_revocation_enabled: revocationEnabled,
          audit_agent_trusted_mode: auditAgentTrustedMode(),
          auth0_mgmt_configured: Boolean(process.env.AUTH0_MGMT_CLIENT_ID),
```

with:

```typescript
          idp_provider: idpAdapter.providerId,
          idp_management_configured: idpAdapter.isManagementConfigured(),
          idp_vending_configured: idpAdapter.isVendingConfigured(),
          control_plane_auth: controlPlaneAuth,
          m2m_revocation_enabled: revocationEnabled,
          audit_agent_trusted_mode: auditAgentTrustedMode(),
```

Find the call to `handleAgentsTokenRoutes` (it's grouped with the other route handlers later in the request handler) and replace its options object — change:

```typescript
          tokenVendor,
          apiAudience,
```

to:

```typescript
          idpAdapter,
```

(Leave every other field in that call — `guard`, `req`, `res`, `pathname`, `controlPlaneAuth` — untouched.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway; node --test gateway/tests/proxy-auth.test.mjs`
Expected: PASS (all existing tests, including the updated `/health` assertion)

Then run the full gateway suite to confirm nothing else regressed:

Run: `npm run test -w @mcp-tool-guard/gateway`
Expected: PASS (all files, including `idp-adapter.test.mjs` from Tasks 1–2)

Then run typecheck:

Run: `npm run typecheck`
Expected: PASS, no errors

- [ ] **Step 5: Commit**

```bash
git add gateway/proxy-server.ts gateway/proxy-routes-agents-token.ts gateway/tests/proxy-auth.test.mjs
git commit -m "feat(gateway): wire IdpAdapter into proxy-server, fail-closed startup, /health"
```

(This commit includes Task 3's edit too, since Task 3 and Task 4 form a single non-independently-compilable change — see the note in Task 3.)

---

### Task 5: Backlog + docs closeout

**Files:**
- Modify: `backlog.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `backlog.md`**

Remove the `BL-020` entry from the `## P0 (next)` section (per the file's own rule: completed items move to `CHANGELOG.md` and are removed here). In `BL-021`'s and `BL-041`'s `depends_on` lines, `BL-020` stays as a dependency reference since it's the item that just shipped — no change needed there (the dependency is now satisfied, but the reference itself remains accurate documentation of what BL-021/041 build on).

- [ ] **Step 2: Add the closing `CHANGELOG.md` entry**

Add under `### Added` in `[Unreleased]`:

```markdown
- **`IdpAdapter` interface extraction + Auth0 implementation (BL-020)** — `gateway/proxy-routes-agents-token.ts` now consumes agent create/delete/token-vend via an injected `IdpAdapter` interface (`gateway/idp-adapter.ts`) instead of calling `gateway/auth0-mgmt.ts`/`gateway/token-vendor.ts` directly; `Auth0IdpAdapter` wraps that existing code unchanged so behavior (status codes, error messages) is preserved exactly. New `MCP_IDP_PROVIDER=auth0|keycloak|entra` env var (default `auth0`) selects the single active provider at startup per the BL-034 design spec, failing loudly on an unrecognized or not-yet-implemented value. `/health` now reports `idp_provider`, `idp_management_configured`, and `idp_vending_configured` instead of `jwt_trust_enabled`/`auth0_mgmt_configured`. `IdpAdapter`, `IdpProviderId`, `CreatedAgentClient`, `VendedToken`, `Auth0IdpAdapter`, and `buildIdpAdapter` are exported from `gateway/index.ts` for future Keycloak (BL-041) and Entra (BL-021) implementations.
```

- [ ] **Step 3: Commit**

```bash
git add backlog.md CHANGELOG.md
git commit -m "docs(backlog): close out BL-020"
```

- [ ] **Step 4: Push and report**

```bash
git push -u origin feature/bl-020-idp-adapter
```

Report the compare URL to the user: `https://github.com/peterkrentel/mcp-tool-guard/compare/main...feature/bl-020-idp-adapter` — per project workflow rules, do not merge or open the PR via `gh`.

---

## Self-Review Notes

- **Spec coverage:** `MCP_IDP_PROVIDER` selection (Task 2), default-to-auth0 (Task 2), fail-closed on unknown/unimplemented (Task 2 + Task 4), `/health` reporting (Task 4), exported for external implementations (Task 2), behavior preservation (Tasks 1/3, enforced via exact-message tests). The design spec's original wording — "default to auth0 when unset **and `MCP_JWT_*` present**" — is corrected in this plan to an *unconditional* default to `auth0` when `MCP_IDP_PROVIDER` is unset. Grounding this plan in the actual code showed `auth0-mgmt.ts`/`token-vendor.ts` have never been conditioned on JWT-trust config being present — they're independently configured via their own `AUTH0_*` env vars. An unconditional default is what "preserves existing behavior exactly" actually requires; the JWT-conditioned version in the spec would have silently disabled agent management for any deployment that has `AUTH0_MGMT_*` configured but not yet `MCP_JWT_*` (an edge case, but a real behavior change the literal acceptance criterion forbids).
- **Placeholder scan:** none found — every step has complete code.
- **Type consistency:** `IdpAdapter`, `CreatedAgentClient`, `VendedToken`, `IdpProviderId` are defined once in Task 1/2 and referenced identically (same names, same shapes) in Tasks 3–4.
- **Out of scope (unchanged from the BL-034 spec):** Keycloak/Entra adapter implementations (BL-041/BL-021), any `config.yaml` per-server issuer restriction, real-Auth0-response integration tests (BL-036).
