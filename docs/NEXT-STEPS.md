# Next steps (post–0.4.0)

**Navigation:** [Deploy overview](deploy-overview.md) · [Roadmap](ROADMAP.md) · [**Cursor guide**](cursor-guide.md) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [Render deploy](render-deploy.md) · [Guard proxy](guard-proxy.md) · [Demo script](demo-proxy.md) · [CONCEPT](CONCEPT.md)

Shipped in **v0.4.0** (2026-06-22): KV persistence for server registry, GitHub MCP with upstream token auth, approval queue with human-in-the-loop, Gemini server-side proxy. See [CHANGELOG.md](../CHANGELOG.md) and [track2-github-proof.md](track2-github-proof.md) / [track3-approval-queue-proof.md](track3-approval-queue-proof.md).

> Canonical open-work tracker: [backlog.md](../backlog.md). Use this doc for context and design notes; track active status in backlog.

---

## 0.3.0 — done

### Phase A — identity

- [x] Auth0 SPA login + guest demo (`demo-tokens.json` dropdown)
- [x] Flight + SDK: JWKS (Auth0) + PEM (guest); `iss` / `aud` for IdP tokens
- [x] `GET /audit` requires Bearer JWT
- [x] `MCP_GUARD_ENABLED=false` loud startup warning
- [x] UI: server audit fetch error state
- [x] Auth0 `permissions` claim in guards
- [x] Prod: `VITE_AUTH0_*` + `MCP_JWT_*` on Vercel

### Phase B — serverless durability

- [x] Vercel KV / Upstash REST — audit lists + booking blobs ([kv-design.md](kv-design.md))
- [x] `/health` → `kv_enabled: true` on flight when KV linked
- [x] Prod smoke: book → cancel same `BK-…` across invocations

### Docs / release

- [x] [auth0-setup.md](auth0-setup.md) testing learnings, README demo screenshots
- [x] Tag **`v0.3.0`**

### Shipped in [0.3.1](../CHANGELOG.md#031---2026-06-02) (tag `v0.3.1`)

- [x] **#11** WebLLM heuristics + anti-hallucination ([PR #22](https://github.com/peterkrentel/mcp-tool-guard/pull/22))
- [x] Read-only Auth0 scope demo on prod (`demo-read@…` — search ALLOW, book client DENY)
- [x] Demo screenshots: [prod-scope-deny-read-only](images/demo/prod-scope-deny-read-only.png), [read-only jwt.io](images/demo/auth0-access-token-read-only-jwtio.png)

## 0.4.0 — done

### Three tracks + hardening

- [x] **Track 1 — KV persistence** — `gateway/kv.ts`, server registry + agents survive Render restart, `GET /agents` from server, kv_enabled health check
- [x] **Track 2 — GitHub MCP** — First real external upstream with `upstream_token_env` substitution, proxy scope enforcement, curl write deny proof ([track2-github-proof.md](track2-github-proof.md), [demo-proxy Demo 6](demo-proxy.md#demo-6--github-mcp-external-upstream))
- [x] **Track 3 — Approval queue** — Opaque single-use tokens, human-in-the-loop, agent retry path, operator approval panel on `/agents.html` ([track3-approval-queue-proof.md](track3-approval-queue-proof.md))
- [x] **Gemini server-side proxy** — `POST /llm/complete` keeps `GEMINI_API_KEY` off browser; `x-goog-api-key` header pattern
- [x] **#8** UI policy from `gateway/config.yaml`; `check:demo-policy` for demo flight embedded guard
- [x] **Agent trace** panel — collapsible audit section, correlated by `trace_id`
- [x] **#12** Guard HTTP proxy — `gateway/proxy-server.ts`, local `make proxy`, Vite dev proxy to `:8787` ([guard-proxy.md](guard-proxy.md))
- [x] **Deploy guard proxy to prod** — Render ([render-deploy.md](render-deploy.md)); UI `VITE_MCP_URL` → proxy; curl deny proof ([demo-proxy.md](demo-proxy.md))
- [x] **Agent gateway (stage 1)** — KV-backed registry, Auth0 M2M lifecycle, token vending, three-layer audit, [`/agents.html`](../ui/agents.html) UI, LLM selector (WebLLM + Gemini/Groq/Mistral). Prod env: [render-deploy.md § Agent gateway](render-deploy.md#agent-gateway-env-render--vercel)
- [x] **Documentation accuracy pass** — guard-proxy, demo-proxy, CONCEPT, identity, auth0-setup, render-deploy, vercel-deploy, ROADMAP updated; demo trust caveats documented

---

## Implementation backlog (post-0.4.0) {#implementation-backlog-post-040}

Branch per task; update `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). ROADMAP reference: [ROADMAP.md](ROADMAP.md).

Active and deferred statuses are maintained in [backlog.md](../backlog.md). This section remains for context links and design references.

**Deploy map:** [deploy-overview.md](deploy-overview.md) — local `make dev` vs prod UI → Render proxy → Vercel flight.

**Build filter:** Before adding scope, ask whether it improves **enforcement + audit credibility** or only **demo UX**. Full rule: [ROADMAP → Build filter](ROADMAP.md#build-filter).

### Implementation guide — three tracks (canonical order) {#cursor-guide-three-tracks}

**For Cursor / contributors:** [cursor-guide.md](cursor-guide.md) documents the shipped Track 1 → 2 → 3 sequencing and rationale. Keep new active tasks in [backlog.md](../backlog.md).

**Demo surfaces:** [Flight demo `/`](../ui/index.html) — **Server enforcement** audit panel (canonical enforce story). [`/agents.html`](../ui/agents.html) — operator provisioning GUI plus shipped approval queue panel.

### Production hardening priorities (review)

Highest leverage next items are now tracked in [backlog.md](../backlog.md) (P0/P1/deferred). Keep this heading as a stable context anchor for historical references.

### Tasks

The active task list moved to [backlog.md](../backlog.md). This heading remains as an anchor used by existing references.

### Agent gateway admin auth (sketch) {#agent-gateway-admin-auth-sketch}

When IdP trust is configured (`MCP_JWT_*`) and guard is enabled, the **control plane** requires a human SPA token with **`gateway:admin`**: `POST/DELETE /servers`, `POST/DELETE /agents`, `POST /token`. Local dev can disable via `MCP_GUARD_ENABLED=false` or `MCP_GATEWAY_ADMIN_AUTH=false`. **Runtime** tool enforcement (M2M `flights:read` → search ALLOW, book DENY) is unchanged.

**Target — two planes:**

| Plane | Identity | Today | Target |
| ----- | -------- | ----- | ------ |
| **Control** | Human operator | Auth0 SPA login + `gateway:admin` when control-plane auth is enabled | Auth0 SPA login + `gateway:admin` (or finer permissions) |
| **Runtime** | M2M agent | Scoped JWT on `tools/call` | Unchanged |

**Proposed API permissions** (same audience `https://mcp-tool-guard`, separate from tool scopes like `flights:read`):

| Permission | Routes (v1) |
| ---------- | ----------- |
| `gateway:admin` | `POST/DELETE /servers`, `POST/DELETE /agents`, `POST /token` (or remove public token route) |
| `audit:read` | `GET /audit` (optional; may overlap flight demo) |

Optional finer split later: `gateway:mcp:write`, `gateway:agents:write`. M2M agents created via mgmt API must **not** receive `gateway:admin` — only tool scopes granted in the create form.

**`POST /token`:** Lock down or fold into authenticated `POST /agents` (vend server-side; do not leave open client_credentials exchange on a public URL).

**Acceptance:**

- [x] `/agents.html` — Sign in required before Add MCP / Create agent / Revoke (reuse `ui/src/auth.ts` SPA flow).
- [x] Proxy — verify admin Bearer on mutating registry + agent routes + `/token`; 403 without `gateway:admin`.
- [x] Chat / Initialize — still uses **selected M2M agent token**, not the human admin token.
- [ ] Deny proof — user without `gateway:admin` cannot `POST /agents`; user with `gateway:admin` can; agent token still denied on book without `flights:write` (smoke in prod after Auth0 permission added).

Details: [identity.md → Admin vs agent tokens](identity.md#admin-vs-agent-tokens-agent-gateway).

### Agent registry + Auth0 sync (sketch) {#agent-registry-auth0-sync-sketch}

Stage 1 creates a **new Auth0 Application** on every **Create agent** click (`mcp-agent-${name}`), stores credentials only in browser memory, and never lists agents from the server. Problems: Auth0 **`too_many_entities`** on free tenants, duplicate names like `mcp-agent-test-flight` in the dashboard, orphans after refresh, no reconciliation.

**Principle:** **App registry (KV) is source of truth**; Auth0 is the credential backend. Auth0 Application = OAuth client — not “sub-clients of one app.” Different scope bundles → different clients (or grant updates), not unlimited duplicate apps.

**Proposed Auth0 application naming** (replace bare `mcp-agent-${name}`):

```text
mcp-agent-{displayName}-{serverId}-{shortId}
```

Example: `mcp-agent-test-flight-flight-a1b2c3d4`. Optional `app_metadata`: `agent_name`, `server_id`, `gateway_version`. Display name stays `test-flight` in KV/UI.

**KV keys** (Render / Upstash — see [kv-design.md](kv-design.md#guard-proxy-kv-agent-gateway)):

| Key | Value |
| --- | ----- |
| `gateway:servers:{id}` | MCP registry entry (url, tool scopes) |
| `gateway:agents:{id}` | `{ name, serverId, scopes[], auth0ClientId, auth0AppName, status, createdAt }` |
| `gateway:audit:…` | Proxy three-layer audit (same pattern as flight) |

Store `clientSecret` encrypted at create time only (Auth0 shows it once); never expose mgmt credentials.

**Create agent flow (target):**

1. Admin auth (future `gateway:admin`).
2. **Idempotent reuse** — same `(name, serverId, scopes)` → return existing KV record (no new Auth0 app).
3. Or **template pool** — map to pre-created clients (`mcp-agent-flight-read`, `mcp-agent-flight-write`) to avoid sprawl.
4. Else allocate unique Auth0 `name` → `POST /clients` + client grant → write KV → vend token.
5. On grant failure, compensate (delete Auth0 client — already done today).

**Revoke:** KV tombstone/delete + `DELETE` Auth0 client + `TokenVendor.invalidate`.

**Sync / API:**

- `GET /agents` — list from KV (UI on load, not browser-only memory).
- Reconciliation job (optional): Auth0 `mcp-agent-*` clients not in KV → delete or import; KV rows with missing Auth0 client → mark orphaned.

**Acceptance:**

- [ ] Unique Auth0 application names; no pile of identical `mcp-agent-test-flight` labels.
- [ ] Page refresh still shows agents (`GET /agents`).
- [ ] Revoke removes both KV row and Auth0 client.
- [ ] Second create with same logical agent + scopes reuses credential (no new Auth0 app) — or documents template-only path.
- [ ] Document Auth0 tenant client limits; cleanup via Revoke + dashboard.

### Still open after 0.3.x

Open follow-on items are tracked in [backlog.md](../backlog.md). This section is retained for continuity with older references.

### Tier 2 (later)

Tiering is tracked in [backlog.md](../backlog.md) with P0/P1/deferred categories.

---

## Known limitations

| Topic | Detail |
| ----- | ------ |
| `POST /audit/agent` | Requires Bearer (`audit:write` or `gateway:admin`) unless explicit trusted mode (`MCP_AUDIT_AGENT_TRUSTED_MODE=true`) is enabled for demo/trusted-network use. |
| WebLLM (1B) | May still mis-route; heuristics shipped (#11) — prefer explicit `book FL505 for …` / `Cancel booking BK-…` |
| Guest JWTs in repo | Public demo; Auth0 is the IdP story |
| Policy | `gateway/config.yaml` canonical; flight `guard_config.yaml` demo-only embedded guard on Vercel |
| Prod proxy audit | Recent rows persist in KV when configured; this is not yet a full external audit sink |
| Approval queue flow | End-to-end: `202` (`pending_id` + `pending_poll_token`) → agent polls `/pending/:id` with `X-Pending-Token` → admin approves/denies in `/agents.html` → agent retries with `X-Approval-Token` |
| `GET /pending/:id` | Requires short-lived poll token (`pending_poll_token` via `X-Pending-Token`) or `gateway:admin` when control-plane auth is enabled. |
| Agent gateway registry | **KV-backed** when `KV_REST_API_*` on Render — UI-added MCPs + agents survive restart; yaml seed always loads |
| Agents page WebLLM (1B) | Prefer explicit prompts (*Search flights from JFK to MIA*) or cloud LLM API keys; no flight heuristics on `/agents.html` |
| Agent gateway control plane | **`gateway:admin`** Bearer when IdP trust + guard on — [admin auth sketch](#agent-gateway-admin-auth-sketch) |
| Agent list | **`GET /agents`** reloads persisted agent metadata; session tokens still live in browser session storage until re-vended |
| Auth0 client quota | Each **Create agent** = new Application; free tenant `too_many_entities` — reuse/revoke ([registry sketch](#agent-registry-auth0-sync-sketch)) |
| Auth0 app names | Duplicate `mcp-agent-${name}` per click — use suffixed names ([registry sketch](#agent-registry-auth0-sync-sketch)) |
| Flight seat counts | In-memory seed; only **bookings** use KV |

---

## Related

- [deploy-overview.md](deploy-overview.md) — three services, traffic paths
- [render-deploy.md](render-deploy.md) — guard proxy on Render
- [demo-proxy.md](demo-proxy.md) — live demo script
- [vercel-deploy.md](vercel-deploy.md) — flight + UI on Vercel
- [guard-proxy.md](guard-proxy.md) — proxy routes and env
- [identity.md](identity.md) — Path A, dual trust
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
