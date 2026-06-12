# Cursor implementation guide

**Navigation:** [Next steps](NEXT-STEPS.md) · [Roadmap](ROADMAP.md) · [KV design](kv-design.md) · [Demo script](demo-proxy.md) · [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp) · [Render deploy](render-deploy.md)

Three sequential tracks. **Tracks 1–2 are done** on `main` ([Track 2 proof](track2-github-proof.md)); start **Track 3** next.

**Principle from the [build filter](ROADMAP.md#build-filter):** every change must strengthen enforcement + audit credibility, not demo UX.

| Track | Outcome | Depends on |
|-------|---------|------------|
| **1 — KV registry** | Servers + agents survive proxy restart | — |
| **2 — GitHub MCP** | First real external upstream + upstream credential | Track 1 |
| **3 — Approval queue** | On-demand scope with human-in-the-loop | Tracks 1–2; Gemini native function-calling before agent retry |

---

## Track 1 — KV-persist the server registry

**Status: done** — registry + agents persist when `KV_REST_API_*` is set on Render.

**Why first (historical):** The proxy's `ServerRegistry` was in-memory. Any MCP server added via `POST /servers` (including GitHub) was lost on Render restart or redeploy. Track 1 fixed this before wiring external MCPs.

**What already exists:**
- `gateway/server-registry.ts` — clean in-memory class with `add`, `remove`, `list`, `getServer`
- `docs/kv-design.md` — KV key design already specified: `{prefix}gateway:servers:{id}`
- Upstash REST client pattern already proven in `servers/flight/` (booking + audit KV)
- `kv-design.md` specifies local fallback: in-memory when `KV_REST_API_URL` unset

**What to build:**

### 1a. KV client for the proxy

Create `gateway/kv.ts` — thin Upstash REST wrapper. Model it on how flight uses KV. Needs:
- `kvGet(key)` → `T | null`
- `kvSet(key, value)` — no TTL for registry entries
- `kvDel(key)`
- `kvScan(prefix)` → `string[]` — to load all `gateway:servers:*` on startup
- Export `kvEnabled()` — returns `Boolean(process.env.KV_REST_API_URL)`

Use `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars. Same vars flight uses; Render can share the same Upstash store or use a separate one — use `GATEWAY_KV_PREFIX` defaulting to `mcp-tool-guard:gateway:` to namespace keys.

No KV dependency in the module — if `KV_REST_API_URL` is unset, all ops are no-ops and return null/undefined.

### 1b. Persist registry writes in proxy-server.ts

In `proxy-server.ts`, after `registry.add(body)` and `registry.remove(id)`, write through to KV:
- `POST /servers` success → `kvSet('gateway:servers:{id}', { url, scopes })`
- `DELETE /servers/:id` success → `kvDel('gateway:servers:{id}')`

### 1c. Load KV on startup

In `main()`, after constructing `ServerRegistry(seedConfig)`, scan `gateway:servers:*` from KV and call `registry.add()` for each entry not already present from yaml. Log how many KV entries were loaded. Then call `syncGuardConfig`.

### 1d. GET /agents persistence (stub)

`GET /agents` currently returns nothing from the server (agents are browser-memory only). Add `GET /agents` route that reads `gateway:agents:*` from KV and returns the list. `POST /agents` already creates Auth0 clients — add a KV write after successful Auth0 creation using the agent record shape from `kv-design.md`. `DELETE /agents/:clientId` → KV delete.

This resolves the known limitation: "Agent list: browser memory only — refresh loses cards."

### 1e. /health update

Add `kv_enabled: kvEnabled()` to the `/health` response so it's visible in smoke tests.

### Acceptance

- Add a server via `POST /servers`, restart the proxy process locally, `GET /servers` still returns it
- `GET /health` shows `kv_enabled: true` when `KV_REST_API_URL` is set
- `GET /agents` returns agents after page refresh
- Local dev without KV env vars: proxy starts, registry works from yaml seed, no crash

---

## Track 2 — Wire GitHub MCP as the first external upstream

**Status: done** — prod proof: [track2-github-proof.md](track2-github-proof.md) · [demo-proxy Demo 6](demo-proxy.md#demo-6--github-mcp-external-upstream).

**Why:** The proxy is live on Render but enforcing only your own flight server. Wiring a vendor MCP you don't control is the credibility jump — it proves the guard proxy pattern works against real external tools.

**What already exists:**
- Guard proxy deployed on Render, routing `POST /:serverId/mcp` to any registered upstream
- `gateway/config.yaml` has server entries — add `github` here
- `CONCEPT.md#third-party--unowned-mcp` describes exactly this pattern
- `demo-proxy.md` has the curl deny proof format

**What to build:**

### 2a. Add GitHub to config.yaml

Add a `github` server block to `gateway/config.yaml`:

```yaml
servers:
  github:
    url: https://api.githubcopilot.com/mcp/
    tools:
      get_file_contents:
        required_scope: "repo:read"
      search_code:
        required_scope: "repo:read"
      create_or_update_file:
        required_scope: "repo:write"
      push_files:
        required_scope: "repo:write"
      create_pull_request:
        required_scope: "repo:write"
```

Adjust tool names to match what the GitHub MCP server actually exposes — run `GET /servers/github/tools` after wiring to discover the real list.

### 2b. GitHub MCP authentication

GitHub MCP requires a GitHub Personal Access Token (PAT) or OAuth token as the Bearer. The proxy currently forwards the caller's Bearer token as-is to the upstream. For GitHub MCP, the upstream needs a GitHub token, not your Auth0 JWT.

Options (pick one for now):
- **Per-server upstream credential**: add optional `upstream_token` to `ServerConfig` in `gateway/types.ts`. When set, proxy substitutes it on the `Authorization` header before forwarding to upstream. Store as env var `GITHUB_MCP_TOKEN` on Render; set via `POST /servers` body or yaml env interpolation.
- Simpler: hardcode substitution in `handleMcp` when `serverId === 'github'` reading from `process.env.GITHUB_MCP_TOKEN`. Less clean but unblocks the demo.

The per-server upstream credential is the right design — it generalises to any vendor MCP that needs its own token. Add `upstream_token?: string` to `ServerConfig` and `AddServerInput`. In `handleMcp`, when `serverCfg.upstream_token` is set, replace the `Authorization` header on the upstream request with `Bearer {upstream_token}`.

### 2c. Smoke test

With proxy running locally (`make dev` or `make proxy`):

```bash
# Should allow (repo:read scope in JWT)
curl -X POST http://localhost:8787/github/mcp \
  -H "Authorization: Bearer <read-scoped-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_file_contents","arguments":{"owner":"...","repo":"...","path":"README.md"}},"id":1}'

# Should deny at proxy (repo:write not in JWT)
curl -X POST http://localhost:8787/github/mcp \
  -H "Authorization: Bearer <read-scoped-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_or_update_file","arguments":{}},"id":2}'

# Verify audit row
curl http://localhost:8787/audit -H "Authorization: Bearer <jwt>"
```

### 2d. Update demo-proxy.md

Add a GitHub section with the curl deny proof. Same format as the existing flight deny example. This is the new canonical demo.

### 2e. Add GITHUB_MCP_TOKEN to Render env

Add to Render environment variables. Redeploy proxy. Repeat smoke test against `mcp-tool-guard-proxy.onrender.com`.

### Acceptance

- `GET /servers/github/tools` returns the real GitHub MCP tool list
- Read-scoped JWT: `get_file_contents` proxied through, audit shows `allow`
- Read-scoped JWT: `create_or_update_file` denied at proxy before reaching GitHub, audit shows `deny`
- No GitHub PAT exposed in any response or log

**Prod proof:** [track2-github-proof.md](../track2-github-proof.md) (curl allow + Render logs; optional proxy deny with `repo:read`-only agent).

---

## Track 3 — Approval queue (on-demand scope)

**Why:** This is the novel capability. Hard-deny is table stakes. The interesting pattern is: agent attempts a tool it lacks scope for → human is notified → human approves or denies → agent resumes or aborts. This is the "do the task then die" ephemeral token idea.

**What already exists:**
- `gateway/token-vendor.ts` — can vend short-lived tokens
- `gateway/server-registry.ts` — KV now backing it (Track 1)
- Three-layer audit with `trace_id` correlation
- Auth0 M2M agent lifecycle

**Nothing exists yet for approval queue.** Build from scratch.

### 3a. Pending request store

Create `gateway/pending-store.ts`:

```typescript
interface PendingRequest {
  id: string;           // "pr_" + random
  trace_id: string;
  session_id: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
  requested_at: string;
  status: "pending" | "approved" | "denied";
  resolved_at?: string;
  resolved_by?: string;  // admin sub claim
}
```

KV key: `gateway:pending:{id}`. Index: `gateway:pending:index` → Redis list of ids (append on create, do not remove — status is the filter).

Methods:
- `create(data)` → `PendingRequest`
- `get(id)` → `PendingRequest | null`
- `list(status?: string)` → `PendingRequest[]`
- `resolve(id, status, resolvedBy)` → `PendingRequest`

### 3b. Deny behaviour change in handleMcp

Currently: scope mismatch → `sendJsonRpcError(403)` immediately.

New behaviour when `MCP_APPROVAL_QUEUE=true` env is set:
1. Create a pending request via `PendingStore.create`
2. Return a `202 Accepted` JSON-RPC response (not an error) with `{ pending_id, message: "Awaiting approval" }`
3. Log the pending decision to audit with `decision: "pending"`

When `MCP_APPROVAL_QUEUE` is not set: existing hard-deny behaviour unchanged.

### 3c. Approval endpoints

Add to `proxy-server.ts`:

```
GET    /pending              — list pending requests (auth: gateway:admin)
GET    /pending/:id          — get one request (auth: gateway:admin)
POST   /pending/:id/approve  — approve; vend short-lived token (auth: gateway:admin)
POST   /pending/:id/deny     — deny (auth: gateway:admin)
```

`POST /pending/:id/approve`:
1. Validate gateway:admin
2. Load pending request
3. Vend a short-lived token with the requested scope added (use `token-vendor.ts`)
4. Mark resolved: `status: "approved"`
5. Return `{ token, expires_in, pending_id }`

The agent polls `GET /pending/:id` or the UI surfaces the approval. Agent receives the token out-of-band (simple path: UI shows it; agent retries with it).

### 3d. Agent retry on approval

In `ui/src/agent.ts` (or whichever runner handles `tools/call`), when a `202` with `pending_id` is returned:
- Display "Waiting for approval..." in the trace panel
- Poll `GET /pending/:id` every few seconds
- On `status: "approved"`, retry the tool call with the vended token
- On `status: "denied"` or timeout, surface the block to the user

### 3e. Approval UI panel

Add a minimal approval panel to `agents.html` (admin-only, behind Auth0 login):
- `GET /pending?status=pending` on load and on interval
- Each row shows: tool name, required scope, agent id, timestamp — and Approve / Deny buttons
- Approve calls `POST /pending/:id/approve`, copies the token into the UI for the agent session

### Acceptance

- Agent calls a tool it lacks scope for, `202` response with `pending_id` appears in trace panel
- Approval UI shows the pending request
- Admin approves → agent automatically retries and the tool call completes
- Admin denies → agent shows blocked message
- Audit log shows: `pending` row, then `allow` (if approved) correlated by `trace_id`
- Hard-deny behaviour unchanged when `MCP_APPROVAL_QUEUE` is not set

---

## What not to build

- More mock MCP servers (flight is sufficient as a demo prop)
- WebLLM improvements — use Gemini Flash via native function-calling API instead of text-parsed JSON
- Additional LLM providers beyond what exists
- UX polish on the flight chat interface
- Full OTel / Grafana integration (Tier 2, post-concept)

## LLM note for the agent

The existing `parseToolCallFromText` regex works but is fragile. When you get to Track 3 (agent retry on approval), switch the Gemini runner to use the native `tools` parameter in the Gemini API instead of text parsing. This makes multi-step agentic flows reliable enough to demo the approval queue without the agent hallucinating tool call JSON.
