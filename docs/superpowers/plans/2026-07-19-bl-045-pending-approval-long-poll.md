# BL-045: Pending-Approval Long-Poll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an approved MCP write actually reach the upstream server when the calling client opts in, instead of being silently lost because the client can't remember its own arguments and retry with an approval token.

**Architecture:** When a `tools/call` needs approval and the caller sends `X-Wait-For-Approval: true`, `handleMcpRoute` (`gateway/proxy-routes-mcp.ts`) does not respond with `202 pending` immediately. Instead it polls the just-created `PendingRequest` (`gateway/pending-store.ts`) on an interval until it resolves or a configurable max wait elapses, then either forwards the already-in-memory original request body on the same held connection (approved) or returns a real JSON-RPC deny/timeout error (denied/timed out). Callers that don't send the header (the existing browser GUI, `ui/src/gateway-agent.ts`) get today's unchanged immediate-202-then-poll behavior. `scripts/claude-mcp-token-helper.sh` sends the opt-in header automatically so Claude Code benefits with no config changes on the user's part.

**Tech Stack:** TypeScript (gateway workspace), Node's built-in `node --test` runner (`.test.mjs`), no new dependencies.

## Global Constraints

- Design already decided in `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md` — implement Option A exactly as reasoned there; do not re-litigate Option B (client-side wrapper) or Option C (webhook/push).
- The browser GUI's existing immediate-202-then-poll behavior (`ui/src/gateway-agent.ts`) must be byte-for-byte unchanged for any caller that does not send `X-Wait-For-Approval: true` — this is an opt-in, not a behavior change.
- No new persistence — the original request `body`/`forwardHeaders` already sit in local variables in `handleMcpRoute`; the long-poll path must reuse them directly, never re-fetch or reconstruct them.
- `MCP_PENDING_LONGPOLL_MAX_MS` must be configurable via env var with a conservative default (120000ms / 2 minutes) — production tuning against real Render edge-timeout behavior is explicitly a manual follow-up (Task 5), not something to guess at in code.
- This touches the authoritative enforcement path (`gateway/proxy-routes-mcp.ts`) — every behavioral change needs a real `node --test` test proving it, no "trust me it compiles."
- Before running gateway tests, the workspace must be rebuilt: `npm run build -w @mcp-tool-guard/gateway` (tests spawn `dist/proxy-server.js`, not the `.ts` source).
- Every commit must update `CHANGELOG.md` under `[Unreleased]` (repo-wide pre-commit/CI rule) and must land on a feature branch, never directly on `main`.
- No comments explaining *what* code does — only ones capturing non-obvious *why*, matching this repo's existing style.

---

### Task 1: Long-poll primitives — env config + pending-store polling helper

**Files:**
- Modify: `gateway/env.ts`
- Modify: `gateway/pending-store.ts`
- Modify: `scripts/dev.env.example`
- Test: `gateway/tests/pending-longpoll.test.mjs` (new)

**Interfaces:**
- Consumes: `gateway/pending-store.ts`'s existing `PendingRequest`, `getPendingRequest`, `createPendingRequest`, `resolvePendingRequest` (all already exported, unchanged).
- Produces: `pendingLongPollMaxMs(): number` (exported from `gateway/env.ts`) and `waitForPendingResolution(id: string, maxWaitMs: number, pollIntervalMs?: number): Promise<PendingRequest | null>` (exported from `gateway/pending-store.ts`) — both consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `gateway/tests/pending-longpoll.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingLongPollMaxMs } from "../dist/env.js";
import {
  createPendingRequest,
  resolvePendingRequest,
  waitForPendingResolution,
} from "../dist/pending-store.js";

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

test("pendingLongPollMaxMs() defaults to 120000ms when unset", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", undefined, () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
});

test("pendingLongPollMaxMs() parses a valid override", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "5000", () => {
    assert.equal(pendingLongPollMaxMs(), 5000);
  });
});

test("pendingLongPollMaxMs() falls back to default on invalid value", () => {
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "not-a-number", () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
  withEnv("MCP_PENDING_LONGPOLL_MAX_MS", "-100", () => {
    assert.equal(pendingLongPollMaxMs(), 120_000);
  });
});

test("waitForPendingResolution() returns the record immediately when already resolved", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });
  await resolvePendingRequest(pending.id, "approved", "unit-test");

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 3000, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "approved");
  assert.ok(elapsed < 200, `expected near-instant return, took ${elapsed}ms`);
});

test("waitForPendingResolution() detects approval that happens mid-wait", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });

  setTimeout(() => {
    resolvePendingRequest(pending.id, "approved", "unit-test-async");
  }, 150);

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 3000, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "approved");
  assert.ok(elapsed >= 150, `expected to wait at least 150ms, took ${elapsed}ms`);
  assert.ok(elapsed < 1000, `expected prompt detection, took ${elapsed}ms`);
});

test("waitForPendingResolution() returns the still-pending record after max wait elapses", async () => {
  const pending = await createPendingRequest({
    server_id: "unit-test-server",
    tool: "unit_test_tool",
    required_scope: "unit:write",
    token_scopes: ["unit:read"],
  });

  const start = Date.now();
  const resolved = await waitForPendingResolution(pending.id, 300, 50);
  const elapsed = Date.now() - start;

  assert.equal(resolved?.status, "pending");
  assert.ok(elapsed >= 280, `expected to wait out the max, took ${elapsed}ms`);
});

test("waitForPendingResolution() returns null for an unknown pending id", async () => {
  const resolved = await waitForPendingResolution("pr_does_not_exist", 200, 50);
  assert.equal(resolved, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build -w @mcp-tool-guard/gateway
node --test gateway/tests/pending-longpoll.test.mjs
```

Expected: FAIL — `pendingLongPollMaxMs is not a function` / `waitForPendingResolution is not a function` (neither exists yet).

- [ ] **Step 3: Implement `pendingLongPollMaxMs()`**

In `gateway/env.ts`, add after `jwtTrustFromEnv()` (before `corsAllowOrigins()`):

```ts
export function pendingLongPollMaxMs(): number {
  const raw = process.env.MCP_PENDING_LONGPOLL_MAX_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}
```

- [ ] **Step 4: Add the `wait_for_approval` flag to `PendingRequest`**

In `gateway/pending-store.ts`, add a `wait_for_approval` field so the approval-queue GUI can later show "someone is actively waiting live on this one" — set whenever the original caller sent `X-Wait-For-Approval: true`. Modify the `PendingRequest` interface:

```ts
export interface PendingRequest {
  id: string;
  trace_id?: string;
  session_id?: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
  wait_for_approval?: boolean;
  requested_at: string;
  status: PendingStatus;
  resolved_at?: string;
  resolved_by?: string;
}
```

Modify the `CreatePendingInput` interface:

```ts
interface CreatePendingInput {
  trace_id?: string;
  session_id?: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
  wait_for_approval?: boolean;
}
```

Modify `createPendingRequest()`'s object literal to carry the field through:

```ts
export async function createPendingRequest(input: CreatePendingInput): Promise<PendingRequest> {
  const pending: PendingRequest = {
    id: newPendingId(),
    trace_id: input.trace_id,
    session_id: input.session_id,
    server_id: input.server_id,
    tool: input.tool,
    required_scope: input.required_scope,
    token_scopes: input.token_scopes,
    agent_id: input.agent_id,
    wait_for_approval: input.wait_for_approval,
    requested_at: new Date().toISOString(),
    status: "pending",
  };

  if (kvEnabled()) {
    await kvSet(pendingKey(pending.id), pending);
    await addToPendingIndex(pending.id);
  } else {
    memPending.set(pending.id, pending);
  }
  return pending;
}
```

- [ ] **Step 5: Implement `waitForPendingResolution()`**

In `gateway/pending-store.ts`, add after `resolvePendingRequest()` (before the `APPROVAL_TOKEN_TTL_MS` constant block):

```ts
/**
 * Poll a pending request until it resolves (approved/denied) or maxWaitMs elapses.
 * Detects resolution promptly (bounded by pollIntervalMs), not just at maxWaitMs.
 * Returns the latest known record — still "pending" if it timed out — or null if
 * the id was never found.
 */
export async function waitForPendingResolution(
  id: string,
  maxWaitMs: number,
  pollIntervalMs = 750,
): Promise<PendingRequest | null> {
  const deadline = Date.now() + maxWaitMs;
  let current = await getPendingRequest(id);
  while (current && current.status === "pending" && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    current = await getPendingRequest(id);
  }
  return current;
}
```

- [ ] **Step 6: Document the new env var**

In `scripts/dev.env.example`, add after the `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET` block added for BL-037:

```bash
# Max time (ms) the guard proxy holds an MCP write request open awaiting human
# approval when the caller sends X-Wait-For-Approval: true (BL-045). Default: 120000 (2min).
# export MCP_PENDING_LONGPOLL_MAX_MS=120000
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm run build -w @mcp-tool-guard/gateway
node --test gateway/tests/pending-longpoll.test.mjs
```

Expected: all 7 tests PASS.

- [ ] **Step 8: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`, one line: "**BL-045 long-poll primitives** — `pendingLongPollMaxMs()` (`gateway/env.ts`) and `waitForPendingResolution()` (`gateway/pending-store.ts`), the building blocks for holding an MCP write open until a human approves it."

```bash
git add gateway/env.ts gateway/pending-store.ts scripts/dev.env.example gateway/tests/pending-longpoll.test.mjs CHANGELOG.md
git commit -m "feat(gateway): add pending-approval long-poll primitives (BL-045)"
```

---

### Task 2: Wire opt-in long-poll into the guard proxy's MCP route

**Files:**
- Modify: `gateway/proxy-routes-mcp.ts`
- Modify: `gateway/telemetry.ts`
- Modify: `gateway/http-helpers.ts`
- Test: `gateway/tests/proxy-auth.test.mjs` (extend existing file)

**Interfaces:**
- Consumes: `pendingLongPollMaxMs()` and `waitForPendingResolution()` from Task 1.
- Produces: the `X-Wait-For-Approval: true` opt-in contract that Task 3's `headersHelper` relies on.

- [ ] **Step 1: Write the failing tests**

In `gateway/tests/proxy-auth.test.mjs`, add `import http from "node:http";` at the top (after the existing `jose` import), and add `MCP_PENDING_LONGPOLL_MAX_MS: "800"` to the `env` object passed to `spawn(...)` inside `before()` (alongside the existing `MCP_APPROVAL_QUEUE: "true"` line) — this keeps the timeout test fast without affecting any other test, since only tests sending the new header exercise this code path.

Then add this helper near the top, after `addServer()`:

```js
function startFakeUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { content: [{ type: "text", text: "fake-upstream-ok" }] },
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function findPendingIdFor(serverId, tool, adminToken) {
  for (let i = 0; i < 40; i++) {
    const listRes = await fetch(`${BASE_URL}/pending?status=pending`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listBody = await listRes.json();
    const match = listBody.pending.find((p) => p.server_id === serverId && p.tool === tool);
    if (match) return match.id;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`pending record for ${serverId}/${tool} never appeared`);
}
```

Then add these four tests at the end of the file:

```js
test("POST /:serverId/mcp with X-Wait-For-Approval forwards for real once approved mid-wait", async () => {
  const fakeUpstream = await startFakeUpstream();
  const upstreamPort = fakeUpstream.address().port;
  try {
    const serverId = `longpoll-approve-${Date.now()}`;
    const createRes = await addServer(serverId, {
      url: `http://127.0.0.1:${upstreamPort}/mcp`,
      scopes: { write_tool: ["thing:write"] },
    });
    assert.equal(createRes.status, 201);

    const readToken = await makeToken(["thing:read"]);
    const callPromise = fetch(`${BASE_URL}/${serverId}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readToken}`,
        "X-Wait-For-Approval": "true",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "write_tool", arguments: { foo: "bar" } },
      }),
    });

    const adminToken = await makeToken(["gateway:admin"]);
    const pendingId = await findPendingIdFor(serverId, "write_tool", adminToken);

    const approveRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ resolvedBy: "test-admin" }),
    });
    assert.equal(approveRes.status, 200);

    const callRes = await callPromise;
    assert.equal(callRes.status, 200);
    const callBody = await callRes.json();
    assert.equal(callBody.result.content[0].text, "fake-upstream-ok");
  } finally {
    fakeUpstream.close();
  }
});

test("POST /:serverId/mcp with X-Wait-For-Approval times out when never approved", async () => {
  const serverId = `longpoll-timeout-${Date.now()}`;
  const createRes = await addServer(serverId, { scopes: { write_tool: ["thing:write"] } });
  assert.equal(createRes.status, 201);

  const readToken = await makeToken(["thing:read"]);
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/${serverId}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${readToken}`,
      "X-Wait-For-Approval": "true",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: { name: "write_tool", arguments: {} },
    }),
  });
  const elapsed = Date.now() - start;

  assert.equal(res.status, 504);
  const body = await res.json();
  assert.match(String(body?.error?.message ?? ""), /Approval wait timed out/i);
  assert.ok(elapsed >= 750, `expected to wait out the ~800ms max, got ${elapsed}ms`);
});

test("POST /:serverId/mcp with X-Wait-For-Approval denies promptly once explicitly denied", async () => {
  const serverId = `longpoll-deny-${Date.now()}`;
  const createRes = await addServer(serverId, { scopes: { write_tool: ["thing:write"] } });
  assert.equal(createRes.status, 201);

  const readToken = await makeToken(["thing:read"]);
  const callPromise = fetch(`${BASE_URL}/${serverId}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${readToken}`,
      "X-Wait-For-Approval": "true",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 44,
      method: "tools/call",
      params: { name: "write_tool", arguments: {} },
    }),
  });

  const adminToken = await makeToken(["gateway:admin"]);
  const pendingId = await findPendingIdFor(serverId, "write_tool", adminToken);

  const denyRes = await fetch(`${BASE_URL}/pending/${encodeURIComponent(pendingId)}/deny`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ resolvedBy: "test-admin" }),
  });
  assert.equal(denyRes.status, 200);

  const callRes = await callPromise;
  assert.equal(callRes.status, 403);
  const callBody = await callRes.json();
  assert.match(String(callBody?.error?.message ?? ""), /Pending request denied/i);
});

test("OPTIONS /:serverId/mcp preflight allows X-Wait-For-Approval header", async () => {
  const preflightRes = await fetch(`${BASE_URL}/flight/mcp`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-wait-for-approval",
    },
  });
  assert.equal(preflightRes.status, 204);
  const allowHeaders = (preflightRes.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  assert.ok(allowHeaders.includes("x-wait-for-approval"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run build -w @mcp-tool-guard/gateway
node --test gateway/tests/proxy-auth.test.mjs
```

Expected: the four new tests FAIL (no `X-Wait-For-Approval` handling exists yet — the first two get an immediate `202` instead of forwarding/timing out, the CORS one is missing the header from the allow-list).

- [ ] **Step 3: Add the `approvalViaLongPoll` telemetry attribute**

In `gateway/telemetry.ts`:

Modify the `ProxyDecisionAttrs` interface (around line 16):

```ts
export interface ProxyDecisionAttrs {
  toolName: string;
  serverId: string;
  decision: ProxyDecision;
  agentScopes: string[];
  traceId?: string;
  pendingId?: string;
  approvalViaToken?: boolean;
  approvalViaLongPoll?: boolean;
}
```

Modify `proxySpanAttributes()` (around line 145):

```ts
function proxySpanAttributes(attrs: ProxyDecisionAttrs): Record<string, string | boolean> {
  return {
    "mcp.tool.name": attrs.toolName,
    "server.id": attrs.serverId,
    "mcp.decision": attrs.decision,
    "agent.scopes": attrs.agentScopes.join(","),
    ...(attrs.traceId ? { "mcp.trace_id": attrs.traceId } : {}),
    ...(attrs.pendingId ? { pending_id: attrs.pendingId } : {}),
    ...(attrs.approvalViaToken ? { "approval.via_token": true } : {}),
    ...(attrs.approvalViaLongPoll ? { "approval.via_long_poll": true } : {}),
  };
}
```

Modify `withProxyAllowSpan()`'s parameter type (around line 276):

```ts
export async function withProxyAllowSpan<T>(
  attrs: Omit<ProxyDecisionAttrs, "decision"> & {
    decision?: "allow";
    pendingId?: string;
    approvalViaToken?: boolean;
    approvalViaLongPoll?: boolean;
  },
  fn: () => Promise<T>,
): Promise<T> {
```

- [ ] **Step 4: Allow the new header in CORS preflight**

In `gateway/http-helpers.ts`, modify the `Access-Control-Allow-Headers` line inside `applyCors()` (around line 25):

```ts
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, X-Trace-Id, X-Session-Id, X-Approval-Token, X-Pending-Token, X-Agent-Id, X-Wait-For-Approval",
    );
```

- [ ] **Step 5: Wire the long-poll branch into `handleMcpRoute`**

In `gateway/proxy-routes-mcp.ts`:

Add `waitForPendingResolution` to the `pending-store.js` import (line 15-20):

```ts
import {
  createPendingRequest,
  generatePendingPollToken,
  getPendingRequest,
  validateApprovalToken,
  waitForPendingResolution,
} from "./pending-store.js";
```

Add `pendingLongPollMaxMs` to the imports from `./env.js` (line 4):

```ts
import { guardEnabled, pendingLongPollMaxMs } from "./env.js";
```

Modify the `allowSpan` type declaration (lines 97-106) to add the new field:

```ts
  let allowSpan:
    | {
        toolName: string;
        serverId: string;
        agentScopes: string[];
        traceId?: string;
        pendingId?: string;
        approvalViaToken?: boolean;
        approvalViaLongPoll?: boolean;
      }
    | undefined;
```

Replace the entire `if (!result.allowed) { ... }` block (lines 124-207) with:

```ts
    if (!result.allowed) {
      let approved = false;
      let approvalPendingId: string | undefined;
      let approvalViaToken = false;
      let approvalViaLongPoll = false;

      if (result.reason?.startsWith("Missing required scope")) {
        const approvalToken = header(req, "x-approval-token");
        if (approvalToken && APPROVAL_QUEUE_ENABLED) {
          const pendingId = await validateApprovalToken(approvalToken, serverId, toolName);
          if (pendingId) {
            const pending = await getPendingRequest(pendingId);
            if (pending && pending.status === "approved") {
              guard.logger.log({
                timestamp: new Date().toISOString(),
                decision: "allow",
                server: serverId,
                tool: toolName,
                required_scope: result.required_scope,
                token_scopes: result.entry.token_scopes,
                source: "proxy",
                trace_id: traceId,
                session_id: sessionId,
                reason: `Approved via token (${pendingId})`,
              });
              approved = true;
              approvalViaToken = true;
              approvalPendingId = pendingId;
            } else {
              recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
              sendJsonRpcError(res, payload.id, "Approval token invalid or expired");
              return;
            }
          } else {
            recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
            sendJsonRpcError(res, payload.id, "Approval token invalid");
            return;
          }
        } else if (APPROVAL_QUEUE_ENABLED) {
          const waitForApproval =
            header(req, "x-wait-for-approval")?.trim().toLowerCase() === "true";

          const pending = await createPendingRequest({
            trace_id: traceId,
            session_id: sessionId,
            server_id: serverId,
            tool: toolName,
            required_scope: result.required_scope,
            token_scopes: result.entry.token_scopes,
            agent_id: header(req, "x-agent-id"),
            wait_for_approval: waitForApproval,
          });

          guard.logger.log({
            timestamp: new Date().toISOString(),
            decision: "pending",
            server: serverId,
            tool: toolName,
            required_scope: result.required_scope,
            token_scopes: result.entry.token_scopes,
            source: "proxy",
            trace_id: traceId,
            session_id: sessionId,
            reason: `Awaiting approval (${pending.id})`,
          });

          recordProxyDecision(
            { ...decisionBase, decision: "pending", pendingId: pending.id },
            requestCtx,
          );

          if (!waitForApproval) {
            const pendingPollToken = await generatePendingPollToken(pending.id);
            sendJsonRpcPending(res, payload.id, pending.id, pendingPollToken);
            return;
          }

          const resolved = await waitForPendingResolution(pending.id, pendingLongPollMaxMs());
          if (resolved?.status === "approved") {
            approved = true;
            approvalViaLongPoll = true;
            approvalPendingId = pending.id;
          } else {
            const reason =
              resolved?.status === "denied"
                ? `Pending request denied (${pending.id})`
                : `Approval wait timed out (${pending.id})`;
            recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
            sendJsonRpcError(
              res,
              payload.id,
              reason,
              resolved?.status === "denied" ? 403 : 504,
            );
            return;
          }
        }
      }
      if (!approved) {
        recordProxyDecision({ ...decisionBase, decision: "deny" }, requestCtx);
        sendJsonRpcError(res, payload.id, result.reason ?? "Access denied");
        return;
      }
      allowSpan = {
        ...decisionBase,
        pendingId: approvalPendingId,
        approvalViaToken,
        approvalViaLongPoll,
      };
    } else {
      allowSpan = decisionBase;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run build -w @mcp-tool-guard/gateway
node --test gateway/tests/proxy-auth.test.mjs
```

Expected: all tests PASS, including the four new ones. Also run the full suite to confirm no regressions:

```bash
npm run test -w @mcp-tool-guard/gateway
npm run typecheck -w @mcp-tool-guard/gateway
```

Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`: "**BL-045: pending-approval long-poll** — the guard proxy (`gateway/proxy-routes-mcp.ts`) now holds a write request open when the caller sends `X-Wait-For-Approval: true`, polling the pending record and forwarding the already-in-memory original request automatically once a human approves it via `/pending/:id/approve` — instead of requiring the caller to remember its own arguments and retry with an `X-Approval-Token`. Configurable via `MCP_PENDING_LONGPOLL_MAX_MS` (default 120000ms). The browser GUI's existing immediate-202-then-poll behavior is unchanged for callers that don't send the opt-in header."

```bash
git add gateway/proxy-routes-mcp.ts gateway/telemetry.ts gateway/http-helpers.ts gateway/tests/proxy-auth.test.mjs CHANGELOG.md
git commit -m "feat(gateway): hold pending-approval writes open and auto-forward on approval (BL-045)"
```

---

### Task 3: Claude Code opts in automatically via `headersHelper`

**Files:**
- Modify: `scripts/claude-mcp-token-helper.sh`

**Interfaces:**
- Consumes: the `X-Wait-For-Approval` header contract from Task 2.
- Produces: nothing downstream — this is the last piece connecting Claude Code's actual traffic to the new behavior.

- [ ] **Step 1: Add the header to the script's stdout JSON**

In `scripts/claude-mcp-token-helper.sh`, modify the final `node -e` block's `process.stdout.write` line from:

```js
    process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}`, "X-Trace-Id": traceId }));
```

to:

```js
    process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}`, "X-Trace-Id": traceId, "X-Wait-For-Approval": "true" }));
```

- [ ] **Step 2: Verify the script's output shape manually**

```bash
export MCP_AGENT_CLIENT_ID="<a valid clientId>"
export MCP_AGENT_CLIENT_SECRET="<its clientSecret>"
./scripts/claude-mcp-token-helper.sh | node -e '
  let d="";
  process.stdin.on("data",c=>d+=c);
  process.stdin.on("end",()=>{
    const j = JSON.parse(d);
    if (!j.Authorization || !j.Authorization.startsWith("Bearer ")) throw new Error("missing/malformed Authorization");
    if (!j["X-Trace-Id"] || !j["X-Trace-Id"].startsWith("cc-")) throw new Error("missing/malformed X-Trace-Id");
    if (j["X-Wait-For-Approval"] !== "true") throw new Error("missing X-Wait-For-Approval opt-in header");
    console.log("PASS:", JSON.stringify(j));
  });
'
```

Expected: `PASS: {"Authorization":"Bearer eyJ...","X-Trace-Id":"cc-...","X-Wait-For-Approval":"true"}` — no thrown error. Requires `make dev` running locally and a real local M2M agent's credentials (reuse the same env vars/agent pattern from BL-037 if one still exists, or create a fresh one via `POST /agents`).

- [ ] **Step 3: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`: "**Claude Code opts into pending-approval long-poll (BL-045)** — `scripts/claude-mcp-token-helper.sh` now sends `X-Wait-For-Approval: true`, so an approved write actually reaches GitHub instead of being lost — no user-facing config change required."

```bash
git add scripts/claude-mcp-token-helper.sh CHANGELOG.md
git commit -m "feat(scripts): opt Claude Code into pending-approval long-poll (BL-045)"
```

---

### Task 4: Update docs to reflect the fix, update backlog status

**Files:**
- Modify: `docs/claude-code-integration.md`
- Modify: `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md`
- Modify: `backlog.md`

**Interfaces:**
- Consumes: nothing new — this is a documentation-only task closing the loop on what Tasks 1-3 built.
- Produces: nothing downstream — Task 5 is the manual production-verification step that actually closes BL-045.

- [ ] **Step 1: Update the integration doc's gap section**

In `docs/claude-code-integration.md`, replace the paragraph starting `**No `source:"mcp"` row followed it...` (in the "Write-deny-then-pending" section) — keep the historical transcript as-is (it's an accurate record of what was observed *before* this fix), but add a note directly after it:

```markdown
**Fixed by BL-045** (see `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md`): `scripts/claude-mcp-token-helper.sh` now sends `X-Wait-For-Approval: true`, so the guard proxy holds this exact call open instead of returning `202` immediately, and forwards it automatically the moment a human approves — Claude Code's own tool call now just waits and gets the real result, no manual replay required.
```

Replace the "## The approval-then-lost-write gap" section's closing paragraph (the one starting "This is filed as its own backlog item...") with:

```markdown
This was filed as BL-045 and is now fixed: the guard proxy (`gateway/proxy-routes-mcp.ts`) holds the connection open when the caller opts in via `X-Wait-For-Approval: true` and auto-forwards the already-in-memory original request once approved. The browser GUI's existing immediate-202-then-poll behavior (`ui/src/gateway-agent.ts`) is unchanged for callers that don't send that header. See `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md` for the full design rationale.
```

- [ ] **Step 2: Update the design spec's status line**

In `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md`, replace:

```markdown
## Status

Design decision only — no code changes in this doc.
```

with:

```markdown
## Status

Implemented in `gateway/proxy-routes-mcp.ts`, `gateway/pending-store.ts`, `gateway/env.ts`, `gateway/telemetry.ts`, `gateway/http-helpers.ts`, and `scripts/claude-mcp-token-helper.sh` (see `backlog.md`'s BL-045). Production verification of the `MCP_PENDING_LONGPOLL_MAX_MS` default against Render's real edge-timeout behavior is still outstanding — tracked as BL-045's remaining manual step.
```

- [ ] **Step 3: Update backlog status**

In `backlog.md`, change BL-045's `status: todo` line to `status: in-progress`, and append to its `acceptance` line:

```markdown
  acceptance: Implement the recommended design from `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md` (Option A) — the guard proxy holds a write request open (long-poll) when the calling client opts in via a static header (e.g. `X-Wait-For-Approval: true`), and forwards the already-in-memory original request automatically once a human approves via `/pending/:id/approve`, instead of requiring the caller to remember its own arguments and manually replay with an `X-Approval-Token`. Add a configurable max-wait (`MCP_PENDING_LONGPOLL_MAX_MS`) verified against real Render edge-timeout behavior before picking a production default. The browser GUI's existing immediate-202-then-poll behavior (`ui/src/gateway-agent.ts`) must remain unchanged for callers that don't send the opt-in header. **Implemented** (gateway code + Claude Code opt-in shipped) — remaining: verify the chosen `MCP_PENDING_LONGPOLL_MAX_MS` default survives Render's real edge-timeout behavior in production before this closes.
```

- [ ] **Step 4: Commit**

```bash
git add docs/claude-code-integration.md docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md backlog.md CHANGELOG.md
git commit -m "docs(bl-045): document shipped long-poll fix, flag remaining prod verification"
```

(Note: this step also needs a `CHANGELOG.md` line, e.g. under `### Changed`: "**BL-045 status: implemented, pending prod verification** — gateway code and Claude Code opt-in shipped; production `MCP_PENDING_LONGPOLL_MAX_MS` tuning against Render's real edge-timeout behavior remains open.")

---

### Task 5: Manual production verification (human, not closing BL-045 until done)

**This task cannot be automated by an agent** — it requires deploying this branch's changes to the real Render guard proxy and observing real network timeout behavior there, which no agent in this session can do.

- [ ] **Step 1 (human): Deploy and smoke-test**

After this branch merges and Render redeploys, register a `-prod`-suffixed M2M agent (per this project's naming convention) against the deployed proxy, and repeat a write-call-with-`X-Wait-For-Approval` scenario against it (e.g. via the `smoke-deployed` pattern or a manual `curl`/`node fetch`, mirroring Task 2's test shape). Confirm the held connection survives Render's real edge/reverse-proxy timeout for the current `MCP_PENDING_LONGPOLL_MAX_MS` default (120000ms) — approve the pending request within that window and confirm the original caller actually receives the forwarded result rather than a dropped connection.

- [ ] **Step 2 (human): Tune if needed**

If Render's real timeout is shorter than 120000ms, lower `MCP_PENDING_LONGPOLL_MAX_MS` on the Render service's environment config to a safe value under that measured limit, and note the measured limit in `docs/superpowers/specs/2026-07-19-pending-approval-long-poll-design.md`'s self-review notes (replacing the "biggest unverified assumption" line with the actual measured number).

- [ ] **Step 3: Close out BL-045**

Once verified, remove the `BL-045` entry from `backlog.md`'s open list (per the file's own completed-item rule) and add a `CHANGELOG.md` entry confirming production verification, following the exact two-step pattern used to close out BL-037.

```bash
git add backlog.md CHANGELOG.md
git commit -m "docs(backlog): close out BL-045, long-poll verified in production"
```

- [ ] **Step 4:** Push and report the compare URL — per this repo's workflow rules, do not merge or open the PR via `gh`.
