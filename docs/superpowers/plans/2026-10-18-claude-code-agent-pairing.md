# Claude Code Agent Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A human approves once, on `claude-ops.html`, which existing agent a given Claude Code MCP-server registration may act as; Claude Code's `headersHelper` then mints JWTs with no credential ever typed or pasted.

**Architecture:** A new "pairing" record (KV-backed with in-memory fallback, same pattern as `gateway/pending-store.ts`) binds one local Claude Code server registration to one agent. The helper requests a pairing (unauthenticated, device-code style), an admin approves it in the UI, and the helper receives an opaque pairing token exactly once. Afterwards the helper presents that token (`X-Pairing-Token`) to the existing `POST /agents/:clientId/token`, which gains a second auth path next to the `gateway:admin` bearer. Everything downstream of "Claude Code has a JWT" is unchanged.

**Tech Stack:** TypeScript (gateway, ESM, `node:test` on compiled `dist/`), Vite + TypeScript UI, Node 22 `.mjs` helper, bash wrapper.

Spec: `docs/superpowers/specs/2026-08-11-claude-code-agent-pairing-design.md`.

## Global Constraints

- Pairing token is stored only as a SHA-256 hash (`node:crypto` `createHash`), never the reversible `agent-secrets.ts` encryption; plaintext is delivered exactly once and then cleared.
- Pending pairing requests expire after 5 minutes (`PENDING_PAIRING_TTL_MS`); at most 20 pending at once (`MAX_PENDING_PAIRINGS`), because `POST /pair` is unauthenticated on a public URL.
- `POST /pair` and `GET /pair/:id` are unauthenticated; approve, deny, list and revoke require `gateway:admin` (same `requireGatewayAdmin` gate as other control-plane routes, skipped only when `controlPlaneAuth` is false).
- Pairing-token header name is `X-Pairing-Token`; token format is `pc_` + base64url; pairing ids are `pg_` + 12 hex chars.
- A pairing token only vends a token for the single `clientId` it was approved for. No IdP-specific branching: vending still goes through `idpAdapter.vendToken()`.
- Local pairing files live in `${MCP_TOOL_GUARD_HOME:-$HOME/.mcp-tool-guard}/pairings/`, directory mode 0700, files mode 0600.
- Anything rendered into `claude-ops.html` that came from `POST /pair` (server name, URL) must be HTML-escaped.
- No real tenant/app IDs or secrets in code, tests or docs; use placeholders. No emojis.
- Repo workflow: feature branch `feature/claude-code-pairing`, every commit touches `CHANGELOG.md` under `[Unreleased]` (pre-commit hook), `npm run typecheck` and `npm test -w @mcp-tool-guard/gateway` green before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `gateway/pairing-store.ts` (new) | Pairing records, token hashing, one-time delivery, TTL, cap |
| `gateway/proxy-routes-pairing.ts` (new) | HTTP routes `/pair*`, `/pairings*` |
| `gateway/proxy-routes-agents-token.ts` (modify) | Second auth path (`X-Pairing-Token`) on `POST /agents/:clientId/token` |
| `gateway/proxy-server.ts` (modify) | Wire the new route handler; update the route list comment |
| `ui/src/proxy-api.ts` (modify) | `listPairings`, `approvePairing`, `denyPairing`, `revokePairing` |
| `ui/src/pairing-html.ts` (new) | Pure, DOM-free HTML builders with escaping (unit-testable) |
| `ui/claude-ops.html`, `ui/src/claude-ops-main.ts` (modify) | Two panels: Pairing requests, Active pairings |
| `scripts/lib/pairing-helper.mjs` (new) | Pairing client logic + CLI entry |
| `scripts/claude-mcp-token-helper.sh` (modify) | Use pairing mode when Claude Code identifies the server |
| `gateway/tests/pairing-store.test.mjs`, `pairing-routes.test.mjs`, `pairing-token-auth.test.mjs`, `pairing-helper.test.mjs` (new) | Tests |
| `ui/src/pairing-html.test.mjs` (new) | UI escaping/filter tests |

Design notes that refine the spec (decided here, reflected in the tasks):
- The helper keeps a local `<name>.pending.json` holding the pairing id, so if Claude Code's `headersHelper` time budget is shorter than the human's approval time, the next connection resumes the same request instead of starting a new one. First-call wait is `MCP_PAIRING_WAIT_MS` (default 8000).
- The ops page already polls every 10 s (not 2 s as the spec says); the pairing panels reuse that poll.

---

### Task 1: Pairing store

**Files:**
- Create: `gateway/pairing-store.ts`
- Test: `gateway/tests/pairing-store.test.mjs`

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `type PairingStatus = "pending" | "approved" | "denied" | "revoked"`
  - `interface PublicPairing { id; serverName; serverUrl; status; clientId?; createdAt; approvedAt?; lastUsedAt? }`
  - `createPairing(input: { serverName: string; serverUrl: string }): Promise<PublicPairing | null>` (null when the pending cap is reached)
  - `pollPairing(id: string): Promise<{ status: PairingStatus; clientId?: string; pairingToken?: string } | null>` (null when unknown or expired; the token appears on the first poll after approval only)
  - `approvePairing(id: string, clientId: string): Promise<PublicPairing | null>` (null unless currently pending)
  - `denyPairing(id: string): Promise<PublicPairing | null>` (null unless currently pending)
  - `revokePairing(id: string): Promise<PublicPairing | null>` (null when unknown)
  - `verifyPairingToken(token: string, clientId: string): Promise<PublicPairing | null>`
  - `listPairings(): Promise<PublicPairing[]>` (newest first, secrets never included)
  - `MAX_PENDING_PAIRINGS`, `PENDING_PAIRING_TTL_MS`, `hashPairingToken(token): string`

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/pairing-store.test.mjs`:

```js
import assert from "node:assert/strict";
import { mock, test } from "node:test";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const {
  MAX_PENDING_PAIRINGS,
  PENDING_PAIRING_TTL_MS,
  approvePairing,
  createPairing,
  denyPairing,
  hashPairingToken,
  listPairings,
  pollPairing,
  revokePairing,
  verifyPairingToken,
} = await import("../dist/pairing-store.js");

test("createPairing starts pending and the public view carries no secrets", async () => {
  const created = await createPairing({ serverName: "ghprod", serverUrl: "https://proxy.example/github/mcp" });
  assert.ok(created);
  assert.match(created.id, /^pg_[0-9a-f]{12}$/);
  assert.equal(created.status, "pending");
  const listed = (await listPairings()).find((p) => p.id === created.id);
  assert.ok(listed);
  assert.equal("pairingTokenHash" in listed, false);
  assert.equal("pairingTokenPlaintext" in listed, false);
});

test("approved pairing delivers its token exactly once", async () => {
  const created = await createPairing({ serverName: "once", serverUrl: "" });
  const approved = await approvePairing(created.id, "agent-1");
  assert.equal(approved.status, "approved");
  assert.equal(approved.clientId, "agent-1");

  const first = await pollPairing(created.id);
  assert.equal(first.status, "approved");
  assert.equal(first.clientId, "agent-1");
  assert.match(first.pairingToken, /^pc_/);

  const second = await pollPairing(created.id);
  assert.equal(second.status, "approved");
  assert.equal(second.pairingToken, undefined);
});

test("verifyPairingToken accepts the bound agent only, and stops after revoke", async () => {
  const created = await createPairing({ serverName: "verify", serverUrl: "" });
  await approvePairing(created.id, "agent-2");
  const { pairingToken } = await pollPairing(created.id);

  const ok = await verifyPairingToken(pairingToken, "agent-2");
  assert.equal(ok.id, created.id);
  assert.ok(ok.lastUsedAt);

  assert.equal(await verifyPairingToken(pairingToken, "other-agent"), null);
  assert.equal(await verifyPairingToken("pc_garbage", "agent-2"), null);
  assert.equal(await verifyPairingToken("not-a-pairing-token", "agent-2"), null);

  const revoked = await revokePairing(created.id);
  assert.equal(revoked.status, "revoked");
  assert.equal(await verifyPairingToken(pairingToken, "agent-2"), null);
});

test("denied pairing polls as denied and cannot be approved afterwards", async () => {
  const created = await createPairing({ serverName: "deny", serverUrl: "" });
  const denied = await denyPairing(created.id);
  assert.equal(denied.status, "denied");
  assert.equal((await pollPairing(created.id)).status, "denied");
  assert.equal(await approvePairing(created.id, "agent-3"), null);
});

test("unknown ids return null", async () => {
  assert.equal(await pollPairing("pg_000000000000"), null);
  assert.equal(await approvePairing("pg_000000000000", "agent-x"), null);
  assert.equal(await revokePairing("pg_000000000000"), null);
});

test("hashPairingToken is a stable 64-char hex SHA-256", () => {
  const h = hashPairingToken("pc_example");
  assert.equal(h, hashPairingToken("pc_example"));
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("pending requests expire after the TTL", async () => {
  const created = await createPairing({ serverName: "ttl", serverUrl: "" });
  const real = Date.now();
  const fake = mock.method(Date, "now", () => real + PENDING_PAIRING_TTL_MS + 1000);
  try {
    assert.equal(await pollPairing(created.id), null);
    assert.equal(await approvePairing(created.id, "agent-4"), null);
  } finally {
    fake.mock.restore();
  }
});

test("pending requests are capped", async () => {
  const existing = (await listPairings()).filter((p) => p.status === "pending").length;
  for (let i = 0; i < MAX_PENDING_PAIRINGS - existing; i++) {
    assert.ok(await createPairing({ serverName: `cap-${i}`, serverUrl: "" }));
  }
  assert.equal(await createPairing({ serverName: "over-cap", serverUrl: "" }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/pairing-store.test.mjs`
Expected: FAIL, `Cannot find module '../dist/pairing-store.js'` (the build also succeeds since the file does not exist yet).

- [ ] **Step 3: Implement the store**

Create `gateway/pairing-store.ts`:

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { kvEnabled, kvGet, kvMget, kvScan, kvSet, kvDel } from "./kv.js";

export type PairingStatus = "pending" | "approved" | "denied" | "revoked";

interface PairingRecord {
  id: string;
  serverName: string;
  serverUrl: string;
  status: PairingStatus;
  clientId?: string;
  pairingTokenHash?: string;
  /** Transient: delivered on the first poll after approval, then cleared. */
  pairingTokenPlaintext?: string;
  createdAt: string;
  approvedAt?: string;
  lastUsedAt?: string;
}

export interface PublicPairing {
  id: string;
  serverName: string;
  serverUrl: string;
  status: PairingStatus;
  clientId?: string;
  createdAt: string;
  approvedAt?: string;
  lastUsedAt?: string;
}

export const PENDING_PAIRING_TTL_MS = 5 * 60 * 1000;
export const MAX_PENDING_PAIRINGS = 20;

const PAIRING_PREFIX = "gateway:pairing:";
const TOKEN_INDEX_PREFIX = "gateway:pairing-token:";

const memPairings = new Map<string, PairingRecord>();
const memTokenIndex = new Map<string, string>(); // token hash -> pairing id

function newPairingId(): string {
  return `pg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function newPairingToken(): string {
  return `pc_${randomBytes(32).toString("base64url")}`;
}

export function hashPairingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublic(r: PairingRecord): PublicPairing {
  return {
    id: r.id,
    serverName: r.serverName,
    serverUrl: r.serverUrl,
    status: r.status,
    clientId: r.clientId,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
    lastUsedAt: r.lastUsedAt,
  };
}

function isExpired(r: PairingRecord): boolean {
  return r.status === "pending" && Date.now() - Date.parse(r.createdAt) > PENDING_PAIRING_TTL_MS;
}

async function save(r: PairingRecord): Promise<void> {
  if (kvEnabled()) {
    // Unresolved or denied records age out on their own; approved/revoked ones persist until revoked.
    const ttlSec =
      r.status === "pending" || r.status === "denied"
        ? Math.ceil(PENDING_PAIRING_TTL_MS / 1000)
        : undefined;
    await kvSet(`${PAIRING_PREFIX}${r.id}`, r, ttlSec);
  } else {
    memPairings.set(r.id, r);
  }
}

async function load(id: string): Promise<PairingRecord | null> {
  const record = kvEnabled()
    ? await kvGet<PairingRecord>(`${PAIRING_PREFIX}${id}`)
    : (memPairings.get(id) ?? null);
  if (!record || isExpired(record)) return null;
  return record;
}

async function loadAll(): Promise<PairingRecord[]> {
  if (!kvEnabled()) return Array.from(memPairings.values()).filter((r) => !isExpired(r));
  const keys = await kvScan(`${PAIRING_PREFIX}*`);
  const records = await kvMget<PairingRecord>(keys);
  return records.filter((r): r is PairingRecord => r != null && !isExpired(r));
}

async function indexToken(hash: string, id: string): Promise<void> {
  if (kvEnabled()) await kvSet(`${TOKEN_INDEX_PREFIX}${hash}`, id);
  else memTokenIndex.set(hash, id);
}

async function unindexToken(hash: string): Promise<void> {
  if (kvEnabled()) await kvDel(`${TOKEN_INDEX_PREFIX}${hash}`);
  else memTokenIndex.delete(hash);
}

async function idForTokenHash(hash: string): Promise<string | null> {
  if (kvEnabled()) return kvGet<string>(`${TOKEN_INDEX_PREFIX}${hash}`);
  return memTokenIndex.get(hash) ?? null;
}

export async function createPairing(input: {
  serverName: string;
  serverUrl: string;
}): Promise<PublicPairing | null> {
  const pending = (await loadAll()).filter((r) => r.status === "pending").length;
  if (pending >= MAX_PENDING_PAIRINGS) return null;
  const record: PairingRecord = {
    id: newPairingId(),
    serverName: input.serverName,
    serverUrl: input.serverUrl,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await save(record);
  return toPublic(record);
}

export async function pollPairing(
  id: string,
): Promise<{ status: PairingStatus; clientId?: string; pairingToken?: string } | null> {
  const record = await load(id);
  if (!record) return null;
  if (record.status === "approved" && record.pairingTokenPlaintext) {
    const delivered = { status: record.status, clientId: record.clientId, pairingToken: record.pairingTokenPlaintext };
    await save({ ...record, pairingTokenPlaintext: undefined });
    return delivered;
  }
  return { status: record.status };
}

export async function approvePairing(id: string, clientId: string): Promise<PublicPairing | null> {
  const record = await load(id);
  if (!record || record.status !== "pending") return null;
  const token = newPairingToken();
  const hash = hashPairingToken(token);
  const updated: PairingRecord = {
    ...record,
    status: "approved",
    clientId,
    pairingTokenHash: hash,
    pairingTokenPlaintext: token,
    approvedAt: new Date().toISOString(),
  };
  await save(updated);
  await indexToken(hash, id);
  return toPublic(updated);
}

export async function denyPairing(id: string): Promise<PublicPairing | null> {
  const record = await load(id);
  if (!record || record.status !== "pending") return null;
  const updated: PairingRecord = { ...record, status: "denied" };
  await save(updated);
  return toPublic(updated);
}

export async function revokePairing(id: string): Promise<PublicPairing | null> {
  const record = await load(id);
  if (!record) return null;
  if (record.pairingTokenHash) await unindexToken(record.pairingTokenHash);
  const updated: PairingRecord = {
    ...record,
    status: "revoked",
    pairingTokenHash: undefined,
    pairingTokenPlaintext: undefined,
  };
  await save(updated);
  return toPublic(updated);
}

export async function verifyPairingToken(
  token: string,
  clientId: string,
): Promise<PublicPairing | null> {
  if (!token.startsWith("pc_")) return null;
  const hash = hashPairingToken(token);
  const id = await idForTokenHash(hash);
  if (!id) return null;
  const record = await load(id);
  if (!record || record.status !== "approved") return null;
  if (record.pairingTokenHash !== hash || record.clientId !== clientId) return null;
  const updated: PairingRecord = { ...record, lastUsedAt: new Date().toISOString() };
  await save(updated);
  return toPublic(updated);
}

export async function listPairings(): Promise<PublicPairing[]> {
  const all = await loadAll();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.map(toPublic);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/pairing-store.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Create the CHANGELOG entry and commit**

In `CHANGELOG.md` under `## [Unreleased]` / `### Added`, add as the first bullet:

```
- **Claude Code agent pairing (BL-055), in progress** — `gateway/pairing-store.ts`: pairing records binding one Claude Code MCP-server registration to one existing agent, with a SHA-256-hashed pairing token delivered to the helper exactly once, a 5-minute TTL on unresolved requests and a cap of 20 pending requests (the create endpoint is unauthenticated). Plan: `docs/superpowers/plans/2026-10-18-claude-code-agent-pairing.md`.
```

```bash
git add gateway/pairing-store.ts gateway/tests/pairing-store.test.mjs CHANGELOG.md docs/superpowers/plans/2026-10-18-claude-code-agent-pairing.md
git commit -m "feat(pairing): add pairing store with one-time token delivery"
```

---

### Task 2: Pairing routes

**Files:**
- Create: `gateway/proxy-routes-pairing.ts`
- Modify: `gateway/proxy-server.ts` (imports near the other route imports; handler call between `handleServerRoutes` and `handleAgentsTokenRoutes`; route list in the header comment at line ~17)
- Test: `gateway/tests/pairing-routes.test.mjs`

**Interfaces:**
- Consumes: everything produced by Task 1; `requireGatewayAdmin(guard, req, res, sendJson)` from `gateway/admin-auth.ts`; `readJson`, `sendJson` from `gateway/http-helpers.ts`; `getAgent` from `gateway/agent-store.ts` (wiring only).
- Produces: `handlePairingRoutes(options: HandlePairingRoutesOptions): Promise<boolean>` where `HandlePairingRoutesOptions = { guard: ToolGuard; req: IncomingMessage; res: ServerResponse; pathname: string; controlPlaneAuth: boolean; agentExists: (clientId: string) => Promise<boolean> }`. Returns true when it handled the request.

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/pairing-routes.test.mjs`:

```js
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { handlePairingRoutes } = await import("../dist/proxy-routes-pairing.js");

const guard = {
  jwtValidator: {
    async validateToken(token) {
      if (token !== "admin-token") throw new Error("bad token");
      return { payload: {}, scopes: ["gateway:admin"] };
    },
    hasScope: (scopes, scope) => scopes.includes(scope),
  },
};

let server;
let base;

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    const handled = await handlePairingRoutes({
      guard,
      req,
      res,
      pathname,
      controlPlaneAuth: true,
      agentExists: async (id) => id === "agent-1",
    });
    if (!handled) {
      res.statusCode = 404;
      res.end("unhandled");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const admin = { Authorization: "Bearer admin-token", "Content-Type": "application/json" };
const json = { "Content-Type": "application/json" };

async function request(path, init = {}) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function startPairing(serverName = "ghprod") {
  const r = await request("/pair", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ serverName, serverUrl: "https://proxy.example/github/mcp" }),
  });
  assert.equal(r.status, 200);
  return r.body.pairingId;
}

test("full flow: request, approve, deliver once, list without secrets, revoke", async () => {
  const id = await startPairing();
  assert.equal((await request(`/pair/${id}`)).body.status, "pending");

  const approve = await request(`/pair/${id}/approve`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ clientId: "agent-1" }),
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.pairing.status, "approved");

  const first = await request(`/pair/${id}`);
  assert.equal(first.body.status, "approved");
  assert.equal(first.body.clientId, "agent-1");
  assert.match(first.body.pairingToken, /^pc_/);
  assert.equal((await request(`/pair/${id}`)).body.pairingToken, undefined);

  const list = await request("/pairings", { headers: admin });
  assert.equal(list.status, 200);
  const mine = list.body.pairings.find((p) => p.id === id);
  assert.ok(mine);
  assert.equal(JSON.stringify(mine).includes("pairingToken"), false);

  const revoke = await request(`/pairings/${id}`, { method: "DELETE", headers: admin });
  assert.equal(revoke.status, 200);
  assert.equal((await request(`/pair/${id}`)).body.status, "revoked");
});

test("approve requires admin, a known pairing and an existing agent", async () => {
  const id = await startPairing("guards");
  const noAuth = await request(`/pair/${id}/approve`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ clientId: "agent-1" }),
  });
  assert.equal(noAuth.status, 401);

  const noAgent = await request(`/pair/${id}/approve`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ clientId: "ghost-agent" }),
  });
  assert.equal(noAgent.status, 404);

  const missingClient = await request(`/pair/${id}/approve`, { method: "POST", headers: admin, body: "{}" });
  assert.equal(missingClient.status, 400);

  const unknown = await request("/pair/pg_000000000000/approve", {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ clientId: "agent-1" }),
  });
  assert.equal(unknown.status, 409);
});

test("deny resolves the request and blocks a later approve", async () => {
  const id = await startPairing("denied");
  const deny = await request(`/pair/${id}/deny`, { method: "POST", headers: admin });
  assert.equal(deny.status, 200);
  assert.equal((await request(`/pair/${id}`)).body.status, "denied");
  const late = await request(`/pair/${id}/approve`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ clientId: "agent-1" }),
  });
  assert.equal(late.status, 409);
});

test("input validation, unknown ids and admin-only listing", async () => {
  const bad = await request("/pair", { method: "POST", headers: json, body: JSON.stringify({ serverUrl: "x" }) });
  assert.equal(bad.status, 400);
  const notJson = await request("/pair", { method: "POST", headers: json, body: "not json" });
  assert.equal(notJson.status, 400);
  assert.equal((await request("/pair/pg_000000000000")).status, 404);
  assert.equal((await request("/pairings")).status, 401);
  assert.equal((await request("/pairings/pg_000000000000", { method: "DELETE", headers: admin })).status, 404);
});

test("unrelated paths are not handled", async () => {
  const res = await fetch(`${base}/agents`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "unhandled");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/pairing-routes.test.mjs`
Expected: FAIL, `Cannot find module '../dist/proxy-routes-pairing.js'`.

- [ ] **Step 3: Implement the routes**

Create `gateway/proxy-routes-pairing.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

import { requireGatewayAdmin } from "./admin-auth.js";
import type { ToolGuard } from "./guard.js";
import { readJson, sendJson } from "./http-helpers.js";
import {
  approvePairing,
  createPairing,
  denyPairing,
  listPairings,
  pollPairing,
  revokePairing,
} from "./pairing-store.js";

export interface HandlePairingRoutesOptions {
  guard: ToolGuard;
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  controlPlaneAuth: boolean;
  agentExists: (clientId: string) => Promise<boolean>;
}

const MAX_SERVER_NAME = 100;
const MAX_SERVER_URL = 300;

async function adminAllowed(options: HandlePairingRoutesOptions): Promise<boolean> {
  if (!options.controlPlaneAuth) return true;
  return requireGatewayAdmin(options.guard, options.req, options.res, sendJson);
}

async function readBody<T>(req: IncomingMessage): Promise<T | null> {
  try {
    return await readJson<T>(req);
  } catch {
    return null;
  }
}

/**
 * Pairing routes (see docs/superpowers/specs/2026-08-11-claude-code-agent-pairing-design.md):
 * - POST   /pair                  — start a pairing (no auth; device-code style)
 * - GET    /pair/:id              — poll; the first poll after approval carries the pairing token (no auth; the id is the nonce)
 * - POST   /pair/:id/approve      — bind to an existing agent (gateway:admin)
 * - POST   /pair/:id/deny         — (gateway:admin)
 * - GET    /pairings              — list, no secrets (gateway:admin)
 * - DELETE /pairings/:id          — revoke (gateway:admin)
 */
export async function handlePairingRoutes(options: HandlePairingRoutesOptions): Promise<boolean> {
  const { req, res, pathname, agentExists } = options;

  if (req.method === "POST" && pathname === "/pair") {
    const body = await readBody<{ serverName?: unknown; serverUrl?: unknown }>(req);
    const serverName = typeof body?.serverName === "string" ? body.serverName.trim() : "";
    const serverUrl = typeof body?.serverUrl === "string" ? body.serverUrl.trim() : "";
    if (!serverName || serverName.length > MAX_SERVER_NAME || serverUrl.length > MAX_SERVER_URL) {
      sendJson(res, 400, { error: "serverName (max 100 chars) is required; serverUrl max 300 chars" });
      return true;
    }
    const created = await createPairing({ serverName, serverUrl });
    if (!created) {
      sendJson(res, 429, { error: "Too many pending pairing requests; approve or wait for them to expire" });
      return true;
    }
    sendJson(res, 200, { pairingId: created.id });
    return true;
  }

  const pollMatch = pathname.match(/^\/pair\/([^/]+)\/?$/);
  if (req.method === "GET" && pollMatch) {
    const result = await pollPairing(pollMatch[1]);
    if (!result) {
      sendJson(res, 404, { error: "Pairing not found or expired" });
      return true;
    }
    sendJson(res, 200, result);
    return true;
  }

  const approveMatch = pathname.match(/^\/pair\/([^/]+)\/approve\/?$/);
  if (req.method === "POST" && approveMatch) {
    if (!(await adminAllowed(options))) return true;
    const body = await readBody<{ clientId?: unknown }>(req);
    const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
    if (!clientId) {
      sendJson(res, 400, { error: "clientId is required" });
      return true;
    }
    if (!(await agentExists(clientId))) {
      sendJson(res, 404, { error: `Unknown agent '${clientId}'` });
      return true;
    }
    const pairing = await approvePairing(approveMatch[1], clientId);
    if (!pairing) {
      sendJson(res, 409, { error: "Pairing is not pending (unknown, expired or already resolved)" });
      return true;
    }
    sendJson(res, 200, { pairing });
    return true;
  }

  const denyMatch = pathname.match(/^\/pair\/([^/]+)\/deny\/?$/);
  if (req.method === "POST" && denyMatch) {
    if (!(await adminAllowed(options))) return true;
    const pairing = await denyPairing(denyMatch[1]);
    if (!pairing) {
      sendJson(res, 409, { error: "Pairing is not pending (unknown, expired or already resolved)" });
      return true;
    }
    sendJson(res, 200, { pairing });
    return true;
  }

  if (req.method === "GET" && pathname === "/pairings") {
    if (!(await adminAllowed(options))) return true;
    sendJson(res, 200, { pairings: await listPairings() });
    return true;
  }

  const revokeMatch = pathname.match(/^\/pairings\/([^/]+)\/?$/);
  if (req.method === "DELETE" && revokeMatch) {
    if (!(await adminAllowed(options))) return true;
    const pairing = await revokePairing(revokeMatch[1]);
    if (!pairing) {
      sendJson(res, 404, { error: "Pairing not found" });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
```

- [ ] **Step 4: Wire it into the proxy**

In `gateway/proxy-server.ts`:

1. Add imports next to the other `proxy-routes-*` imports:

```ts
import { getAgent } from "./agent-store.js";
import { handlePairingRoutes } from "./proxy-routes-pairing.js";
```

(if `getAgent` is already imported from `./agent-store.js`, extend that import instead).

2. Insert immediately before the `if (await handleAgentsTokenRoutes({` block:

```ts
      if (
        await handlePairingRoutes({
          guard,
          req,
          res,
          pathname,
          controlPlaneAuth,
          agentExists: async (clientId) => (await getAgent(clientId)) !== null,
        })
      ) {
        return;
      }
```

3. In the header comment route list (around line 17), add after the `POST /token` line:

```
 *   POST   /pair, GET /pair/:id — Claude Code agent pairing (no auth; id is the nonce)
 *   POST   /pair/:id/approve|deny, GET /pairings, DELETE /pairings/:id — (gateway:admin)
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/pairing-routes.test.mjs && npm run typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 6: Commit**

Append to the Task 1 CHANGELOG entry: ` Routes in \`gateway/proxy-routes-pairing.ts\`: \`POST /pair\` and \`GET /pair/:id\` (unauthenticated; the id is the nonce), \`POST /pair/:id/approve|deny\`, \`GET /pairings\` and \`DELETE /pairings/:id\` (gateway:admin).`

```bash
git add gateway/proxy-routes-pairing.ts gateway/proxy-server.ts gateway/tests/pairing-routes.test.mjs CHANGELOG.md
git commit -m "feat(pairing): add /pair and /pairings routes"
```

---

### Task 3: Pairing token as a second auth path for token vending

**Files:**
- Modify: `gateway/proxy-routes-agents-token.ts` (imports at top; the `agentTokenMatch` branch, lines ~131-161)
- Test: `gateway/tests/pairing-token-auth.test.mjs`

**Interfaces:**
- Consumes: `verifyPairingToken(token, clientId)` (Task 1); `header(req, name)` from `gateway/http-helpers.ts`.
- Produces: `POST /agents/:clientId/token` accepts either the existing `gateway:admin` bearer or `X-Pairing-Token`. A pairing token bound to a different agent, revoked, or unknown gets 401 and never falls back to the admin check.

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/pairing-token-auth.test.mjs`. The vending step itself needs stored agent credentials in KV, so these tests prove the auth gate: a valid pairing token gets past it (the next outcome is 404 "no stored credentials"), anything else is rejected with 401.

```js
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { handleAgentsTokenRoutes } = await import("../dist/proxy-routes-agents-token.js");
const { approvePairing, createPairing, pollPairing, revokePairing } = await import("../dist/pairing-store.js");

const guard = {
  jwtValidator: {
    async validateToken(token) {
      if (token !== "admin-token") throw new Error("bad token");
      return { payload: {}, scopes: ["gateway:admin"] };
    },
    hasScope: (scopes, scope) => scopes.includes(scope),
  },
};

const idpAdapter = {
  providerId: "entra",
  isVendingConfigured: () => true,
  vendingConfigError: () => "",
  vendToken: async () => ({ token: "jwt", expiresIn: 60 }),
  invalidateToken: () => {},
};

let server;
let base;

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    const handled = await handleAgentsTokenRoutes({ guard, req, res, pathname, controlPlaneAuth: true, idpAdapter });
    if (!handled) {
      res.statusCode = 404;
      res.end("unhandled");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function pairedToken(clientId) {
  const created = await createPairing({ serverName: "ghprod", serverUrl: "" });
  await approvePairing(created.id, clientId);
  const { pairingToken } = await pollPairing(created.id);
  return { id: created.id, pairingToken };
}

function vend(clientId, headers = {}) {
  return fetch(`${base}/agents/${clientId}/token`, { method: "POST", headers, body: "{}" });
}

test("a valid pairing token passes the auth gate for its own agent", async () => {
  const { pairingToken } = await pairedToken("agent-a");
  const res = await vend("agent-a", { "X-Pairing-Token": pairingToken });
  assert.equal(res.status, 404); // past auth; this test env has no stored agent credentials
});

test("a pairing token for another agent is rejected", async () => {
  const { pairingToken } = await pairedToken("agent-b");
  const res = await vend("agent-other", { "X-Pairing-Token": pairingToken });
  assert.equal(res.status, 401);
});

test("an unknown pairing token is rejected and does not fall back to admin auth", async () => {
  const res = await vend("agent-a", { "X-Pairing-Token": "pc_garbage", Authorization: "Bearer admin-token" });
  assert.equal(res.status, 401);
});

test("a revoked pairing token is rejected", async () => {
  const { id, pairingToken } = await pairedToken("agent-c");
  await revokePairing(id);
  assert.equal((await vend("agent-c", { "X-Pairing-Token": pairingToken })).status, 401);
});

test("the admin bearer path still works and no credentials is still 401", async () => {
  assert.equal((await vend("agent-a", { Authorization: "Bearer admin-token" })).status, 404);
  assert.equal((await vend("agent-a")).status, 401);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w @mcp-tool-guard/gateway && node --test gateway/tests/pairing-token-auth.test.mjs`
Expected: FAIL. The first test gets 401 (the pairing header is ignored today).

- [ ] **Step 3: Implement the second auth path**

In `gateway/proxy-routes-agents-token.ts`:

1. Add imports:

```ts
import { header } from "./http-helpers.js";
import { verifyPairingToken } from "./pairing-store.js";
```

(extend the existing `./http-helpers.js` import to `{ header, readJson, sendJson }` rather than adding a second line).

2. In the `agentTokenMatch` branch, move `const clientId = agentTokenMatch[1];` above the auth check and replace the existing `if (controlPlaneAuth && !(await requireGatewayAdmin(...))) { return true; }` block with:

```ts
    const clientId = agentTokenMatch[1];
    const pairingToken = header(req, "x-pairing-token");
    if (pairingToken) {
      if (!(await verifyPairingToken(pairingToken, clientId))) {
        sendJson(res, 401, { error: "Invalid or revoked pairing token" });
        return true;
      }
    } else if (
      controlPlaneAuth &&
      !(await requireGatewayAdmin(guard, req, res, sendJson))
    ) {
      return true;
    }
```

Delete the now-duplicate `const clientId = agentTokenMatch[1];` further down in the same branch. Update the JSDoc line above the branch to: `/** POST /agents/:clientId/token — vend JWT using secret stored at create. Auth: gateway:admin bearer, or X-Pairing-Token bound to this agent. */`. Also update the doc comment list at the top of the file: `- POST /agents/:clientId/token (gateway:admin or X-Pairing-Token)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build -w @mcp-tool-guard/gateway && npm test -w @mcp-tool-guard/gateway && npm run typecheck`
Expected: all gateway tests PASS (existing 134 + 20 new), typecheck clean.

- [ ] **Step 5: Commit**

Append to the CHANGELOG entry: ` \`POST /agents/:clientId/token\` now also accepts \`X-Pairing-Token\` (valid only for the agent it was approved for; a bad token never falls back to the admin check).`

```bash
git add gateway/proxy-routes-agents-token.ts gateway/tests/pairing-token-auth.test.mjs CHANGELOG.md
git commit -m "feat(pairing): accept a pairing token on POST /agents/:clientId/token"
```

---

### Task 4: claude-ops.html pairing panels

**Files:**
- Create: `ui/src/pairing-html.ts`, `ui/src/pairing-html.test.mjs`
- Modify: `ui/package.json` (the `pretest` script), `ui/src/proxy-api.ts` (append functions), `ui/claude-ops.html`, `ui/src/claude-ops-main.ts`

**Interfaces:**
- Consumes: gateway routes from Task 2 (`GET /pairings`, `POST /pair/:id/approve`, `POST /pair/:id/deny`, `DELETE /pairings/:id`); existing `listAgents()` (`ListedAgent.auth0ClientId`, `.name`, `.serverId`, `.scopes`) and `adminAuthHeaders`/`proxyFetch` inside `proxy-api.ts`.
- Produces: `pendingPairingsHtml(items, agents, now)`, `activePairingsHtml(items, agentLabelFor, now)`, `escapeHtml(text)` from `ui/src/pairing-html.ts`; `listPairings`, `approvePairing`, `denyPairing`, `revokePairing` and the `PairingRecord` type from `proxy-api.ts`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/pairing-html.test.mjs` (the UI test script compiles TS to `dist-test/` first; see Step 3 for the `pretest` change):

```js
import assert from "node:assert/strict";
import { test } from "node:test";

const { activePairingsHtml, escapeHtml, pendingPairingsHtml } = await import("../dist-test/pairing-html.js");

const now = Date.parse("2026-10-18T12:00:00Z");
const base = { id: "pg_abc", serverName: "ghprod", serverUrl: "https://x/mcp", status: "pending", createdAt: "2026-10-18T11:59:00Z" };
const agents = [{ clientId: "agent-1", label: "github-prod (github, repo:read)" }];

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
});

test("pending list shows only pending requests and escapes server-supplied text", () => {
  const html = pendingPairingsHtml(
    [
      { ...base, serverName: "<script>alert(1)</script>", serverUrl: '"><b>x</b>' },
      { ...base, id: "pg_done", status: "approved" },
    ],
    agents,
    now,
  );
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<b>x</b>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.includes("pg_done"), false);
  assert.match(html, /data-approve-pairing="pg_abc"/);
  assert.match(html, /data-deny-pairing="pg_abc"/);
  assert.match(html, /<option value="agent-1">github-prod \(github, repo:read\)<\/option>/);
});

test("pending list with no agents explains why approval is unavailable", () => {
  const html = pendingPairingsHtml([base], [], now);
  assert.match(html, /Create an agent first/);
  assert.equal(html.includes("data-approve-pairing"), false);
});

test("empty pending list has a friendly message", () => {
  assert.match(pendingPairingsHtml([], agents, now), /No pairing requests/);
});

test("active list shows approved pairings with the bound agent and a revoke button", () => {
  const html = activePairingsHtml(
    [
      { ...base, status: "approved", clientId: "agent-1", approvedAt: "2026-10-18T11:59:30Z", lastUsedAt: "2026-10-18T11:59:50Z" },
      { ...base, id: "pg_revoked", status: "revoked" },
    ],
    (clientId) => (clientId === "agent-1" ? "github-prod" : "(unknown agent)"),
    now,
  );
  assert.match(html, /ghprod/);
  assert.match(html, /github-prod/);
  assert.match(html, /data-revoke-pairing="pg_abc"/);
  assert.equal(html.includes("pg_revoked"), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @mcp-tool-guard/ui`
Expected: FAIL, `Cannot find module '../dist-test/pairing-html.js'` (the existing `pretest` only compiles `auth-provider.ts`).

- [ ] **Step 3: Implement the HTML builders and extend `pretest`**

Create `ui/src/pairing-html.ts`:

```ts
export interface PairingLike {
  id: string;
  serverName: string;
  serverUrl: string;
  status: "pending" | "approved" | "denied" | "revoked";
  clientId?: string;
  createdAt: string;
  approvedAt?: string;
  lastUsedAt?: string;
}

export interface AgentOption {
  clientId: string;
  label: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ago(iso: string | undefined, now: number): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

export function pendingPairingsHtml(items: PairingLike[], agents: AgentOption[], now: number): string {
  const pending = items.filter((p) => p.status === "pending");
  if (pending.length === 0) return '<p class="admin-hint">No pairing requests.</p>';
  return pending
    .map((p) => {
      const picker =
        agents.length === 0
          ? '<div class="card-meta">Create an agent first (Agent gateway page), then approve this request.</div>'
          : `<div style="display:flex;gap:.5rem;margin-top:.4rem;flex-wrap:wrap">
          <select data-pairing-agent="${escapeHtml(p.id)}">${agents
            .map((a) => `<option value="${escapeHtml(a.clientId)}">${escapeHtml(a.label)}</option>`)
            .join("")}</select>
          <button type="button" data-approve-pairing="${escapeHtml(p.id)}" style="background:#2a5;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Approve</button>
          <button type="button" data-deny-pairing="${escapeHtml(p.id)}" style="background:#a22;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Deny</button>
        </div>`;
      return `<div class="card" style="border-left:3px solid #f90">
        <div><strong>${escapeHtml(p.serverName)}</strong></div>
        <div class="card-meta mono" style="font-size:.7rem">${escapeHtml(p.serverUrl || "(no url)")}</div>
        <div class="card-meta mono" style="font-size:.7rem">${escapeHtml(p.id)} &nbsp;·&nbsp; requested ${ago(p.createdAt, now)}</div>
        ${picker}
      </div>`;
    })
    .join("");
}

export function activePairingsHtml(
  items: PairingLike[],
  agentLabelFor: (clientId: string | undefined) => string,
  now: number,
): string {
  const active = items.filter((p) => p.status === "approved");
  if (active.length === 0) return '<p class="admin-hint">No active pairings.</p>';
  return active
    .map(
      (p) => `<div class="card" style="border-left:3px solid #4c4">
        <div><strong>${escapeHtml(p.serverName)}</strong> &rarr; ${escapeHtml(agentLabelFor(p.clientId))}</div>
        <div class="card-meta">approved ${ago(p.approvedAt, now)} &nbsp;·&nbsp; last used ${ago(p.lastUsedAt, now)}</div>
        <div class="card-meta mono" style="font-size:.7rem">${escapeHtml(p.id)}</div>
        <div style="margin-top:.4rem"><button type="button" data-revoke-pairing="${escapeHtml(p.id)}" style="background:#a22;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Revoke</button></div>
      </div>`,
    )
    .join("");
}
```

In `ui/package.json`, change the `pretest` script so it compiles both files:

```json
"pretest": "tsc src/auth-provider.ts src/pairing-html.ts --outDir dist-test --module ESNext --target ES2022 --moduleResolution bundler --skipLibCheck --ignoreConfig",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @mcp-tool-guard/ui`
Expected: PASS (existing 4 + 5 new).

- [ ] **Step 5: Add the API client functions**

Append to `ui/src/proxy-api.ts`:

```ts
export interface PairingRecord {
  id: string;
  serverName: string;
  serverUrl: string;
  status: "pending" | "approved" | "denied" | "revoked";
  clientId?: string;
  createdAt: string;
  approvedAt?: string;
  lastUsedAt?: string;
}

export async function listPairings(): Promise<PairingRecord[]> {
  const res = await proxyFetch("/pairings", { headers: await adminAuthHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { pairings: PairingRecord[] };
  return data.pairings ?? [];
}

export async function approvePairing(id: string, clientId: string): Promise<void> {
  const res = await proxyFetch(`/pair/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: await adminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ clientId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function denyPairing(id: string): Promise<void> {
  const res = await proxyFetch(`/pair/${encodeURIComponent(id)}/deny`, {
    method: "POST",
    headers: await adminAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function revokePairing(id: string): Promise<void> {
  const res = await proxyFetch(`/pairings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await adminAuthHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}
```

- [ ] **Step 6: Add the panels and wire them up**

In `ui/claude-ops.html`, insert these two sections after the "Pending approvals" `</section>` and before the "Recent activity" section:

```html
      <section class="panel">
        <h2>Pairing requests</h2>
        <p class="admin-hint">A Claude Code server registration is asking to act as one of your agents. Pick the agent and approve; no credential is typed or pasted.</p>
        <div id="ops-pairing-requests" class="card-list"></div>
      </section>

      <section class="panel">
        <h2>Active pairings</h2>
        <p class="admin-hint">Claude Code registrations currently bound to an agent. Revoke makes the next connection ask for pairing again.</p>
        <div id="ops-pairings-active" class="card-list"></div>
      </section>
```

In `ui/src/claude-ops-main.ts`:

1. Extend the `./proxy-api.js` import with `approvePairing, denyPairing, listAgents, listPairings, revokePairing` and add:

```ts
import { activePairingsHtml, escapeHtml, pendingPairingsHtml, type AgentOption } from "./pairing-html.js";
```

2. Next to the other `getElementById` constants:

```ts
const opsPairingRequestsEl = document.getElementById("ops-pairing-requests")!;
const opsPairingsActiveEl = document.getElementById("ops-pairings-active")!;
```

3. Add this function after `refreshOpsPending`:

```ts
async function refreshOpsPairings(): Promise<void> {
  if (!opsEnabled) {
    opsPairingRequestsEl.innerHTML = '<p class="admin-hint">Sign in to view pairing requests.</p>';
    opsPairingsActiveEl.innerHTML = "";
    return;
  }
  try {
    const [pairings, agents] = await Promise.all([listPairings(), listAgents()]);
    const options: AgentOption[] = agents.map((a) => ({
      clientId: a.auth0ClientId,
      label: `${a.name} (${a.serverId}, ${a.scopes.join(" ")})`,
    }));
    const labelFor = (clientId?: string) =>
      options.find((o) => o.clientId === clientId)?.label ?? "(unknown agent)";
    const now = Date.now();
    opsPairingRequestsEl.innerHTML = pendingPairingsHtml(pairings, options, now);
    opsPairingsActiveEl.innerHTML = activePairingsHtml(pairings, labelFor, now);
  } catch (err) {
    const message = escapeHtml(err instanceof Error ? err.message : String(err));
    opsPairingRequestsEl.innerHTML = `<div class="log-error">${message}</div>`;
  }
}

function pairingAction(action: () => Promise<void>): void {
  void action()
    .then(() => refreshOpsPairings())
    .catch((err) => {
      opsPairingRequestsEl.innerHTML = `<div class="log-error">${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    });
}

opsPairingRequestsEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const approveId = target.dataset.approvePairing;
  const denyId = target.dataset.denyPairing;
  if (approveId) {
    const select = opsPairingRequestsEl.querySelector<HTMLSelectElement>(`select[data-pairing-agent="${CSS.escape(approveId)}"]`);
    if (select?.value) pairingAction(() => approvePairing(approveId, select.value));
  } else if (denyId) {
    pairingAction(() => denyPairing(denyId));
  }
});

opsPairingsActiveEl.addEventListener("click", (event) => {
  const revokeId = (event.target as HTMLElement).dataset.revokePairing;
  if (revokeId) pairingAction(() => revokePairing(revokeId));
});
```

4. Add `void refreshOpsPairings();` next to every existing `void refreshOpsPending();` call (the poll interval callback, the client-type `change` listener, and the initial `syncOpsAdminGate().then(...)` block).

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run test -w @mcp-tool-guard/ui && npm run build -w @mcp-tool-guard/ui`
Expected: typecheck clean, UI tests pass, Vite build succeeds.

Append to the CHANGELOG entry: ` \`ui/claude-ops.html\` gains "Pairing requests" (pick an agent, approve or deny) and "Active pairings" (revoke) panels; server-supplied names and URLs are HTML-escaped (tested in \`ui/src/pairing-html.test.mjs\`).`

```bash
git add ui/package.json ui/claude-ops.html ui/src/pairing-html.ts ui/src/pairing-html.test.mjs ui/src/proxy-api.ts ui/src/claude-ops-main.ts CHANGELOG.md
git commit -m "feat(pairing): add pairing request and active pairing panels to claude-ops"
```

---

### Task 5: Helper script, docs, and live verification

**Files:**
- Create: `scripts/lib/pairing-helper.mjs`
- Test: `gateway/tests/pairing-helper.test.mjs` (imports `../../scripts/lib/pairing-helper.mjs`)
- Modify: `scripts/claude-mcp-token-helper.sh`, `docs/claude-code-integration.md`, `docs/claude-code-demo.md`, `scripts/dev.env.example`, `backlog.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `POST /pair`, `GET /pair/:id`, `POST /agents/:clientId/token` with `X-Pairing-Token` (Tasks 2 and 3).
- Produces: `getHeaders(options)` returning `{ Authorization, "X-Trace-Id", "X-Wait-For-Approval" }`, plus `pairingPaths`, `PairingError`; CLI entry that prints that JSON to stdout (what Claude Code's `headersHelper` expects).

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/pairing-helper.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { PairingError, getHeaders, pairingPaths } = await import("../../scripts/lib/pairing-helper.mjs");

function reply(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function makeEnv(extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "pairing-"));
  return {
    home,
    env: {
      CLAUDE_CODE_MCP_SERVER_NAME: "ghprod",
      CLAUDE_CODE_MCP_SERVER_URL: "https://proxy.example/github/mcp",
      PROXY_URL: "https://proxy.example",
      MCP_TOOL_GUARD_HOME: home,
      MCP_PAIRING_WAIT_MS: "0",
      ...extra,
    },
  };
}

const noLog = () => {};
const noSleep = async () => {};

test("fast path: an existing pairing file mints a token without any pairing calls", async () => {
  const { home, env } = makeEnv();
  const paths = pairingPaths("ghprod", home);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pairing, JSON.stringify({ clientId: "agent-1", pairingToken: "pc_abc" }));

  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return reply(200, { token: "jwt-1", expiresIn: 60 });
  };
  const headers = await getHeaders({ env, fetchFn, log: noLog, sleep: noSleep });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://proxy.example/agents/agent-1/token");
  assert.equal(calls[0].init.headers["X-Pairing-Token"], "pc_abc");
  assert.equal(headers.Authorization, "Bearer jwt-1");
  assert.match(headers["X-Trace-Id"], /^cc-/);
  assert.equal(headers["X-Wait-For-Approval"], "true");
});

test("first run: requests a pairing, writes the pending id, and reports it is waiting", async () => {
  const { home, env } = makeEnv();
  const fetchFn = async (url) => {
    if (url.endsWith("/pair")) return reply(200, { pairingId: "pg_111111111111" });
    return reply(200, { status: "pending" });
  };
  await assert.rejects(getHeaders({ env, fetchFn, log: noLog, sleep: noSleep }), (err) => {
    assert.ok(err instanceof PairingError);
    assert.match(err.message, /pg_111111111111/);
    return true;
  });
  const paths = pairingPaths("ghprod", home);
  assert.equal(JSON.parse(readFileSync(paths.pending, "utf8")).pairingId, "pg_111111111111");
});

test("a later run resumes the pending request and, once approved, saves the pairing with 0600 permissions", async () => {
  const { home, env } = makeEnv();
  const paths = pairingPaths("ghprod", home);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pending, JSON.stringify({ pairingId: "pg_222222222222" }));

  const urls = [];
  const fetchFn = async (url, init) => {
    urls.push(url);
    if (url.endsWith("/pair/pg_222222222222")) {
      return reply(200, { status: "approved", clientId: "agent-9", pairingToken: "pc_fresh" });
    }
    if (url.endsWith("/agents/agent-9/token")) {
      assert.equal(init.headers["X-Pairing-Token"], "pc_fresh");
      return reply(200, { token: "jwt-9", expiresIn: 60 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const headers = await getHeaders({ env, fetchFn, log: noLog, sleep: noSleep });

  assert.equal(headers.Authorization, "Bearer jwt-9");
  assert.equal(urls.some((u) => u.endsWith("/pair")), false); // resumed, did not start a new request
  assert.deepEqual(JSON.parse(readFileSync(paths.pairing, "utf8")), { clientId: "agent-9", pairingToken: "pc_fresh" });
  assert.equal(existsSync(paths.pending), false);
  assert.equal(statSync(paths.pairing).mode & 0o777, 0o600);
});

test("a denied pairing clears the pending file and fails clearly", async () => {
  const { home, env } = makeEnv();
  const paths = pairingPaths("ghprod", home);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pending, JSON.stringify({ pairingId: "pg_333333333333" }));
  const fetchFn = async () => reply(200, { status: "denied" });
  await assert.rejects(getHeaders({ env, fetchFn, log: noLog, sleep: noSleep }), /denied/);
  assert.equal(existsSync(paths.pending), false);
});

test("an expired or unknown pending request is cleared so the next run starts fresh", async () => {
  const { home, env } = makeEnv();
  const paths = pairingPaths("ghprod", home);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pending, JSON.stringify({ pairingId: "pg_444444444444" }));
  const fetchFn = async () => reply(404, { error: "Pairing not found or expired" });
  await assert.rejects(getHeaders({ env, fetchFn, log: noLog, sleep: noSleep }), /expired|not found/i);
  assert.equal(existsSync(paths.pending), false);
});

test("a revoked pairing (401) deletes the local file so the next connection re-pairs", async () => {
  const { home, env } = makeEnv();
  const paths = pairingPaths("ghprod", home);
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.pairing, JSON.stringify({ clientId: "agent-1", pairingToken: "pc_old" }));
  const fetchFn = async () => reply(401, { error: "Invalid or revoked pairing token" });
  await assert.rejects(getHeaders({ env, fetchFn, log: noLog, sleep: noSleep }), /revoked|no longer valid/i);
  assert.equal(existsSync(paths.pairing), false);
});

test("without CLAUDE_CODE_MCP_SERVER_NAME the helper refuses to guess", async () => {
  const { env } = makeEnv({ CLAUDE_CODE_MCP_SERVER_NAME: "" });
  await assert.rejects(getHeaders({ env, fetchFn: async () => reply(200, {}), log: noLog, sleep: noSleep }), /CLAUDE_CODE_MCP_SERVER_NAME/);
});

test("server names with path characters cannot escape the pairings directory", () => {
  const paths = pairingPaths("../../etc/passwd", "/home/u/.mcp-tool-guard");
  assert.equal(paths.pairing.startsWith("/home/u/.mcp-tool-guard/pairings/"), true);
  assert.equal(paths.pairing.includes(".."), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test gateway/tests/pairing-helper.test.mjs`
Expected: FAIL, `Cannot find module '../../scripts/lib/pairing-helper.mjs'`.

- [ ] **Step 3: Implement the helper**

Create `scripts/lib/pairing-helper.mjs`:

```js
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export class PairingError extends Error {}

export function safeName(serverName) {
  return serverName.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^\.+/, "") || "server";
}

export function pairingPaths(serverName, home = join(homedir(), ".mcp-tool-guard")) {
  const dir = join(home, "pairings");
  const base = join(dir, safeName(serverName));
  return { dir, pairing: `${base}.json`, pending: `${base}.pending.json` };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeSecretFile(dir, path, data) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function removeFile(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

async function mint({ fetchFn, proxyUrl, pairing }) {
  const res = await fetchFn(`${proxyUrl}/agents/${encodeURIComponent(pairing.clientId)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pairing-Token": pairing.pairingToken },
    body: "{}",
  });
  if (res.status === 401) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new PairingError(`Token request failed: ${body.error ?? res.status}`);
  }
  return body.token;
}

async function completePairing({ fetchFn, proxyUrl, serverName, serverUrl, paths, waitMs, sleep, log }) {
  let pending = readJsonFile(paths.pending);
  if (!pending?.pairingId) {
    const res = await fetchFn(`${proxyUrl}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverName, serverUrl }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.pairingId) {
      throw new PairingError(`Could not start pairing: ${body.error ?? res.status}`);
    }
    pending = { pairingId: body.pairingId };
    writeSecretFile(paths.dir, paths.pending, pending);
    log(`Pairing requested. Approve pairing ${pending.pairingId} for '${serverName}' on claude-ops.html (Pairing requests), then reconnect.`);
  }

  const deadline = Date.now() + waitMs;
  for (;;) {
    const res = await fetchFn(`${proxyUrl}/pair/${encodeURIComponent(pending.pairingId)}`);
    if (res.status === 404) {
      removeFile(paths.pending);
      throw new PairingError("Pairing request expired or was not found; reconnect to start a new one.");
    }
    const body = await res.json().catch(() => ({}));
    if (body.status === "approved") {
      removeFile(paths.pending);
      if (!body.pairingToken) {
        throw new PairingError("Pairing was approved but its credential was already delivered; reconnect to pair again.");
      }
      const pairing = { clientId: body.clientId, pairingToken: body.pairingToken };
      writeSecretFile(paths.dir, paths.pairing, pairing);
      return pairing;
    }
    if (body.status === "denied" || body.status === "revoked") {
      removeFile(paths.pending);
      throw new PairingError(`Pairing was ${body.status}.`);
    }
    if (Date.now() >= deadline) {
      throw new PairingError(`Pairing ${pending.pairingId} is still waiting for approval on claude-ops.html; approve it, then reconnect.`);
    }
    await sleep(1000);
  }
}

export async function getHeaders({
  env = process.env,
  fetchFn = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const serverName = env.CLAUDE_CODE_MCP_SERVER_NAME;
  if (!serverName) {
    throw new PairingError("CLAUDE_CODE_MCP_SERVER_NAME is not set (this helper must be run by Claude Code as a headersHelper).");
  }
  const serverUrl = env.CLAUDE_CODE_MCP_SERVER_URL ?? "";
  const proxyUrl = (env.PROXY_URL || "http://localhost:8787").replace(/\/$/, "");
  const waitMs = Number(env.MCP_PAIRING_WAIT_MS ?? 8000);
  const paths = pairingPaths(serverName, env.MCP_TOOL_GUARD_HOME || undefined);

  let pairing = readJsonFile(paths.pairing);
  if (!pairing?.clientId || !pairing?.pairingToken) {
    pairing = await completePairing({ fetchFn, proxyUrl, serverName, serverUrl, paths, waitMs, sleep, log });
  }

  const token = await mint({ fetchFn, proxyUrl, pairing });
  if (!token) {
    removeFile(paths.pairing);
    throw new PairingError("Pairing was revoked or is no longer valid; reconnect to pair again.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "X-Trace-Id": `cc-${randomUUID()}`,
    "X-Wait-For-Approval": "true",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  getHeaders()
    .then((headers) => process.stdout.write(JSON.stringify(headers)))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test gateway/tests/pairing-helper.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Use pairing mode from the bash helper**

In `scripts/claude-mcp-token-helper.sh`, add this block immediately after `set -euo pipefail` (before the existing dev.env fallback block):

```bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Pairing mode: Claude Code identifies the server it is connecting, so use the pairing flow
# and never read a static credential. Static MCP_AGENT_CLIENT_ID/SECRET is only for manual runs.
if [ -n "${CLAUDE_CODE_MCP_SERVER_NAME:-}" ]; then
  exec node "$script_dir/lib/pairing-helper.mjs"
fi
```

Then delete the later `script_dir="$(cd ...)"` line inside the existing dev.env fallback `if` (it is now defined above) and update the header comment to add: `# When run by Claude Code (CLAUDE_CODE_MCP_SERVER_NAME set) it uses agent pairing (scripts/lib/pairing-helper.mjs); the MCP_AGENT_CLIENT_ID/SECRET path below is only for manual runs.`

Run: `bash -n scripts/claude-mcp-token-helper.sh`
Expected: no output (syntax OK).

- [ ] **Step 6: Document it**

Add this section to `docs/claude-code-integration.md` (after the existing helper setup section; if that file has no such heading, append it at the end) and add a one-paragraph pointer to it in `docs/claude-code-demo.md` where it currently tells the reader to paste `clientId`/`clientSecret` into `scripts/dev.env`:

```markdown
## Pairing (no credential copy-paste)

When Claude Code runs `scripts/claude-mcp-token-helper.sh` it sets `CLAUDE_CODE_MCP_SERVER_NAME` and `CLAUDE_CODE_MCP_SERVER_URL`, and the helper uses pairing instead of a static credential:

1. Point the MCP server's `headersHelper` at the helper and set `PROXY_URL` to your proxy (for example `https://<your-proxy>.onrender.com`).
2. Connect from Claude Code. The first time, the helper asks the proxy for a pairing and prints `Approve pairing pg_... for '<server>' on claude-ops.html`. The connection fails once, on purpose.
3. Open `claude-ops.html`, sign in as an operator, find the request under **Pairing requests**, pick the agent it may act as, and click **Approve**.
4. Reconnect from Claude Code. The helper receives its credential once, stores it in `~/.mcp-tool-guard/pairings/<server>.json` (mode 0600), and mints short-lived tokens from then on.

Revoke from **Active pairings** on the same page; the next connection asks to pair again. A pairing token only works for the one agent it was approved for. Set `MCP_TOOL_GUARD_HOME` to move the storage directory and `MCP_PAIRING_WAIT_MS` to change how long the first call waits for approval (default 8000).
```

In `scripts/dev.env.example`, if `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET` appear, add above them: `# Only for running scripts/claude-mcp-token-helper.sh by hand. Claude Code uses pairing instead (docs/claude-code-integration.md).`

- [ ] **Step 7: Full verification, then commit**

Run: `npm run typecheck && npm test -w @mcp-tool-guard/gateway && npm run test -w @mcp-tool-guard/ui && npm run check:demo-policy`
Expected: all green.

Update `CHANGELOG.md`: change the in-progress entry's title from "**Claude Code agent pairing (BL-055), in progress**" to "**Claude Code agent pairing (BL-055)**" and append: ` \`scripts/lib/pairing-helper.mjs\` is the client: first run requests a pairing, keeps a local \`<server>.pending.json\` so the next connection resumes the same request if approval takes longer than the first call's wait, saves the delivered credential with 0600 permissions, and deletes it on a 401 so a revoked pairing re-pairs automatically. \`scripts/claude-mcp-token-helper.sh\` uses it whenever Claude Code sets \`CLAUDE_CODE_MCP_SERVER_NAME\`. Documented in \`docs/claude-code-integration.md\`.`

In `backlog.md`, set BL-055 `status: in-progress` and add to its acceptance a trailing note `(code merged; live Claude Code proof and removal of the stale dev.env credential still open)`.

```bash
git add scripts/lib/pairing-helper.mjs scripts/claude-mcp-token-helper.sh scripts/dev.env.example gateway/tests/pairing-helper.test.mjs docs/claude-code-integration.md docs/claude-code-demo.md backlog.md CHANGELOG.md
git commit -m "feat(pairing): helper script pairing mode, docs"
```

- [ ] **Step 8: Live verification (run by the user, with Claude Code; unit tests cannot prove this)**

After the branch is merged and deployed (or against a local `make dev` proxy with `PROXY_URL=http://localhost:8787`):

1. Check Claude Code's MCP documentation for the `headersHelper` time limit. If it is shorter than the approval wait, keep `MCP_PAIRING_WAIT_MS` below it (the resume design already tolerates a short limit).
2. Delete the stale `MCP_AGENT_CLIENT_ID` / `MCP_AGENT_CLIENT_SECRET` lines from the local, gitignored `scripts/dev.env` (BL-055 item 2).
3. In `.mcp.json`, point the server's `headersHelper` at `scripts/claude-mcp-token-helper.sh`, with `PROXY_URL` set.
4. Start Claude Code, connect: expect a one-time failure printing the pairing id.
5. Approve on `claude-ops.html` and pick an existing read-only agent (for example one with `repo:read` or `slack:read`).
6. Reconnect: expect success; run a read tool (allowed) and a write tool (denied, then approvable in the Pending approvals panel). Confirm the audit shows `cc-` trace ids for the same turn across agent/proxy/MCP.
7. Revoke the pairing in **Active pairings**; reconnect: expect a fresh pairing request, not a silent failure.
8. If anything differs from the plan, fix it before closing BL-055. When it all passes, remove BL-055 from `backlog.md` and add the line `BL-055 closed: Claude Code agent pairing shipped and proven live.` to the CHANGELOG entry, in a follow-up PR.

---

## Self-Review

**Spec coverage:**
- pairing-store with KV + memory fallback, 5-min TTL, hash-only token, one-time delivery: Task 1.
- `POST /pair`, `GET /pair/:id`, approve, deny, `GET /pairings`, `DELETE /pairings/:id`: Task 2.
- `POST /agents/:clientId/token` second auth path: Task 3.
- `claude-ops.html` Pairing requests + Active pairings panels: Task 4.
- Helper: fast path, first-run pairing loop, local file, revoked-401 cleanup, denied/expired handling: Task 5.
- Error handling (nobody approves, denied, revoked): Tasks 1 (TTL), 2 (409/404), 5 (helper messages, 401 cleanup).
- Testing (unit, routes, one live run): Tasks 1-3, 5 step 8.
- Out of scope items are not built (no auto-expiry, no create-agent UI, no other harnesses).
- Added beyond the spec, with reason: pending cap (public unauthenticated endpoint), HTML escaping (admin UI renders unauthenticated input), `.pending.json` resume (headersHelper may time out before a human approves). BL-055 item 2 (stale dev.env credential) is a manual step in Task 5 Step 8.

**Placeholder scan:** no TBD/TODO; every code step has complete code; the only "if present" conditionals are for edits to existing files whose exact current text the engineer must check (`dev.env.example`, `claude-code-integration.md` heading, existing `getAgent` import).

**Type consistency:** `createPairing/pollPairing/approvePairing/denyPairing/revokePairing/verifyPairingToken/listPairings/PublicPairing/MAX_PENDING_PAIRINGS/PENDING_PAIRING_TTL_MS/hashPairingToken` are defined in Task 1 and used with the same names and signatures in Tasks 2, 3 and the tests. `HandlePairingRoutesOptions` fields match the wiring in Task 2 step 4. UI `PairingRecord` (proxy-api) is structurally compatible with `PairingLike`; `AgentOption {clientId,label}` is produced in `claude-ops-main.ts` exactly as `pendingPairingsHtml` consumes it. Helper `getHeaders/pairingPaths/PairingError` names match between implementation and tests.
