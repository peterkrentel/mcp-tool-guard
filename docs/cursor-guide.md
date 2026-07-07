# Cursor implementation guide

**Navigation:** [Next steps](NEXT-STEPS.md) · [Roadmap](ROADMAP.md) · [KV design](kv-design.md) · [Demo script](demo-proxy.md) · [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp) · [Render deploy](render-deploy.md)

Three sequential tracks. **Tracks 1–3 are done** on `main` ([Track 2 proof](track2-github-proof.md), [Track 3 proof](track3-approval-queue-proof.md)). This doc is now a concise implementation reference for what shipped.

**Principle from the [build filter](ROADMAP.md#build-filter):** every change must strengthen enforcement + audit credibility, not demo UX.

| Track | Outcome | Depends on |
| ----- | ------- | ---------- |
| **1 — KV registry** | Servers + agents survive proxy restart | — |
| **2 — GitHub MCP** | First real external upstream + upstream credential | Track 1 |
| **3 — Approval queue** | On-demand scope with human-in-the-loop | Tracks 1–2; Gemini native function-calling before agent retry |

Track status snapshot:

- **Track 1 shipped:** KV-backed server registry + agent list on the proxy.
- **Track 2 shipped:** GitHub MCP wired through the guard proxy with upstream credential substitution and scope enforcement.
- **Track 3 shipped:** approval queue, one-time approval token, agent poll/retry path, and operator approval panel on `/agents.html`.

---

## Track 1 — KV-persist the server registry

**Status: done** — registry + agents persist when `KV_REST_API_*` is set on Render.

**Why first (historical):** The proxy's `ServerRegistry` was in-memory. Any MCP server added via `POST /servers` (including GitHub) was lost on Render restart or redeploy. Track 1 fixed this before wiring external MCPs.

**What already exists:**

- `gateway/server-registry.ts` — clean in-memory class with `add`, `remove`, `list`, `getServer`
- `docs/kv-design.md` — KV key design already specified: `{prefix}gateway:servers:{id}`
- Upstash REST client pattern already proven in `servers/flight/` (booking + audit KV)
- `kv-design.md` specifies local fallback: in-memory when `KV_REST_API_URL` unset

**What shipped:**

### 1a. KV client for the proxy

`gateway/kv.ts` now provides the Upstash REST wrapper used by the proxy. It backs registry persistence, agent persistence, audit persistence, and distributed rate limiting when `KV_REST_API_*` is configured.

### 1b. Persist registry writes in proxy-server.ts

`POST /servers` and `DELETE /servers/:id` write through to KV, so runtime-registered MCP servers survive Render restarts and redeploys.

### 1c. Load KV on startup

The proxy loads persisted server entries on startup, merges them with yaml seed config, and then syncs the guard configuration.

### 1d. GET /agents persistence

`GET /agents` reads persisted agent metadata from KV. `POST /agents` stores the agent record and encrypted secret material needed for later token vending; `DELETE /agents/:clientId` removes the KV record.

### 1e. /health update

`GET /health` reports `kv_enabled` so deploy smoke tests can verify the persistence path is active.

### Track 1 acceptance

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

**What shipped:**

### 2a. GitHub policy and upstream routing

`gateway/config.yaml` and `config.prod.yaml` now include a `github` server entry with `repo:read` / `repo:write` policy mapping.

### 2b. GitHub MCP authentication

The proxy substitutes `GITHUB_MCP_TOKEN` for upstream GitHub auth while still enforcing caller JWT scopes from the incoming M2M agent token.

### 2c. Smoke test

The canonical smoke test is now recorded in [track2-github-proof.md](track2-github-proof.md): read-scoped allow for `get_file_contents`, proxy deny for `create_or_update_file`, and matching Render logs.

### 2d. Demo surface

[demo-proxy.md](demo-proxy.md) contains the canonical curl proof for the external upstream path.

### 2e. Production env

Render carries `GITHUB_MCP_TOKEN`; `GET /health` reports upstream auth status so the deploy can be verified without exposing credentials.

### Track 2 acceptance

- `GET /servers/github/tools` returns the real GitHub MCP tool list
- Read-scoped JWT: `get_file_contents` proxied through, audit shows `allow`
- Read-scoped JWT: `create_or_update_file` denied at proxy before reaching GitHub, audit shows `deny`
- No GitHub PAT exposed in any response or log

**Prod proof:** [track2-github-proof.md](../track2-github-proof.md) (curl allow + **proxy write deny** + Render logs).

---

## Track 3 — Approval queue (on-demand scope)

**Why:** This is the novel capability. Hard-deny is table stakes. The interesting pattern is: agent attempts a tool it lacks scope for → human is notified → human approves or denies → agent resumes or aborts. This is the "do the task then die" ephemeral token idea.

**Status: done** — prod proof: [track3-approval-queue-proof.md](track3-approval-queue-proof.md).

**What shipped:**

- `gateway/pending-store.ts` stores pending approval records and approval tokens.
- `MCP_APPROVAL_QUEUE=true` converts eligible scope denies into `202` pending responses.
- `GET /pending`, `GET /pending/:id`, `POST /pending/:id/approve`, and `POST /pending/:id/deny` exist on the proxy.
- Gateway agents poll for approval, accept `approval_token`, retry with `X-Approval-Token`, and stop on deny/timeout.
- `/agents.html` includes an operator approval panel.

### 3a. Pending request store

`pending-store.ts` implements the pending-request lifecycle, including persisted request metadata, resolution state, and one-time approval tokens bound to server + tool.

### 3b. Deny behaviour in handleMcp

When approval queue is enabled and the tool is eligible, scope mismatch becomes a `202` pending response plus a `pending` audit row. Hard-deny remains the fallback when approval queue is off or not applicable.

### 3c. Approval endpoints

The proxy now exposes the full pending lifecycle. Listing and resolve routes require `gateway:admin` when control-plane auth is enabled; `GET /pending/:id` requires a short-lived pending poll token (`X-Pending-Token` from the `202` pending response), with `gateway:admin` as an operator fallback when enabled.

### 3d. Agent retry on approval

`ui/src/gateway-agent.ts` polls for pending status, attaches `X-Approval-Token` when approved, retries the original tool call, and stops cleanly on deny, timeout, or upstream tool error.

### 3e. Approval UI panel

`ui/src/agents-main.ts` now renders a refreshable pending-request panel on `/agents.html`, with Approve / Deny actions backed by the proxy API.

### Track 3 acceptance

- Agent calls a tool it lacks scope for, receives `202` + `pending_id` + `pending_poll_token`, and begins polling with `X-Pending-Token`.
- Approval UI shows the pending request.
- Admin approves and the agent retries automatically with a one-time token.
- Admin denies and the agent surfaces a blocked result.
- Audit log shows `pending`, approval, and final allow/deny rows correlated by `trace_id`.

---

## What not to build

- More mock MCP servers (flight is sufficient as a demo prop)
- WebLLM improvements — use Gemini Flash via native function-calling API instead of text-parsed JSON
- Additional LLM providers beyond what exists
- UX polish on the flight chat interface
- Full OTel / Grafana integration (Tier 2, post-concept)

## LLM note for the agent

The gateway now proxies Gemini server-side (`POST /llm/complete`), which keeps the API key off the browser and improves deploy ergonomics. For future multi-step agent flows, keep preferring explicit structured tool-call paths over brittle free-text parsing.
