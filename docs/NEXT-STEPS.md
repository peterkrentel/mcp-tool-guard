# Next steps (post–0.3.0)

**Navigation:** [Deploy overview](deploy-overview.md) · [Roadmap](ROADMAP.md) · [**Cursor guide**](cursor-guide.md) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [Render deploy](render-deploy.md) · [Guard proxy](guard-proxy.md) · [Demo script](demo-proxy.md) · [CONCEPT](CONCEPT.md)

Shipped in **v0.3.0** (2026-06-02): Auth0 + guest dual trust, Bearer `/audit`, Vercel KV for server audit + bookings. Tag: [RELEASE.md](RELEASE.md).

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

### On `main` ([Unreleased](../CHANGELOG.md#unreleased))

- [x] **#8** UI policy from `gateway/config.yaml`; `check:demo-policy` for demo flight embedded guard
- [x] **Agent trace** panel — collapsible audit section, correlated by `trace_id`
- [x] **#12** Guard HTTP proxy — `gateway/proxy-server.ts`, local `make proxy`, Vite dev proxy to `:8787` ([guard-proxy.md](guard-proxy.md))
- [x] **Deploy guard proxy to prod** — Render ([render-deploy.md](render-deploy.md)); UI `VITE_MCP_URL` → proxy; curl deny proof ([demo-proxy.md](demo-proxy.md))
- [x] **Agent gateway (stage 1)** — in-memory registry, Auth0 M2M lifecycle, token vending, three-layer audit, [`/agents.html`](../ui/agents.html) UI, LLM selector (WebLLM + Gemini/Groq/Mistral). Prod env: [render-deploy.md § Agent gateway](render-deploy.md#agent-gateway-env-render--vercel)

---

## Implementation backlog (post-0.3.0) {#implementation-backlog-post-030}

Branch per task; update `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). ROADMAP numbers in [ROADMAP.md](ROADMAP.md#release-030--hardening--multi-server).

**Deploy map:** [deploy-overview.md](deploy-overview.md) — local `make dev` vs prod UI → Render proxy → Vercel flight.

**Build filter:** Before adding a task, ask whether it improves **enforcement + audit credibility** or only **demo UX**. Credibility wins (KV, registry, external MCP, approval queue). UX-only items stay deferred (#9/#10, proxy audit UI, extra LLMs unless needed for reliable tool JSON). Full rule: [ROADMAP → Build filter](ROADMAP.md#build-filter).

### Implementation guide — three tracks (canonical order) {#cursor-guide-three-tracks}

**For Cursor / contributors:** [cursor-guide.md](cursor-guide.md) — complete **Track 1 → 2 → 3** before starting the next. Key designs already live in [kv-design.md](kv-design.md#guard-proxy-kv-agent-gateway) and [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp); the guide references them instead of duplicating.

| Track | Focus | Why this order |
|-------|--------|----------------|
| **1 — KV-persist registry + agents** | `gateway/kv.ts`, `GET /agents`, startup load, `kv_enabled` on `/health` | Without KV, `POST /servers` (and GitHub) is lost on every Render redeploy |
| **2 — Wire GitHub MCP** | `upstream_token` on `ServerConfig`, policy in yaml, curl deny demo | First vendor MCP you don't control — credibility jump beyond flight |
| **3 — Approval queue** | `pending-store.ts`, `MCP_APPROVAL_QUEUE`, `/pending/*`, admin UI | On-demand ephemeral scope + human-in-the-loop; **prerequisite:** Gemini native function-calling (not `parseToolCallFromText`) for reliable agent retry on `202` |

**Demo surfaces:** [Flight demo `/`](../ui/index.html) — **Server enforcement** audit panel (canonical enforce story). [`/agents.html`](../ui/agents.html) — operator provisioning GUI; approval panel lands in Track 3.

### Production hardening priorities (review)

Highest leverage before more prod exposure or external MCP demos:

| Priority | Item | Effort | Notes |
|----------|------|--------|-------|
| ✅ | **Admin auth** (`gateway:admin` on control plane) | **Done** | `POST/DELETE /servers`, `/agents`, `POST /token` — gated when IdP trust + guard on |
| ✅ | **Gate `POST /token`** | **Done** | Same `gateway:admin` Bearer as other control-plane routes |
| 🟡 | **Track 1 — KV registry + agents** | ~2–3 hrs | [cursor-guide Track 1](cursor-guide.md#track-1--kv-persist-the-server-registry) · [kv-design](kv-design.md#guard-proxy-kv-agent-gateway) |
| 🟡 | **Track 2 — GitHub MCP** | ~2 hrs | [cursor-guide Track 2](cursor-guide.md#track-2--wire-github-mcp-as-the-first-external-upstream) · upstream credential forwarding |
| 🟡 | **Track 3 — Approval queue** | ~3–4 hrs | [cursor-guide Track 3](cursor-guide.md#track-3--approval-queue-on-demand-scope) · planned KV keys in [kv-design](kv-design.md#approval-queue-track-3-planned) |
| 🟡 | **Upstream error handling** | ~1 hr | Structured `upstream_unavailable` on connect/discovery failures — partial in proxy |

Agent-vs-chat UI and external SDK agents are optional polish; they do not change the authoritative enforcement story.

### Tasks

| # | Task | Status | Touch | Acceptance |
|---|------|--------|-------|------------|
| — | **Deploy guard proxy to prod** | **Done** | Render: `config.prod.yaml`, env vars, `VITE_MCP_URL` — [render-deploy.md](render-deploy.md) | `GET /health` on proxy; UI chat via proxy; `/audit` `source: guard-proxy` |
| — | **Agent gateway stage 1** | **Done** | `gateway/proxy-server.ts`, `ui/agents.html`, `AUTH0_MGMT_*` on Render, `VITE_PROXY_BASE_URL` on Vercel | Local: search ALLOW + book DENY; prod smoke on `/agents.html` |
| — | **Agent gateway admin auth** | **Done** | `gateway/admin-auth.ts`, `gateway/proxy-server.ts`, `ui/agents-main.ts` — [sketch](#agent-gateway-admin-auth-sketch) | SPA login on `/agents.html`; `gateway:admin` on registry + agent CRUD + `/token`; M2M agents unchanged on `tools/call` |
| — | **Agent gateway KV persistence (Track 1)** | **Next** | [cursor-guide Track 1](cursor-guide.md#track-1--kv-persist-the-server-registry) · [kv-design](kv-design.md#guard-proxy-kv-agent-gateway) | UI-added MCPs + agents survive proxy restart; `GET /agents` from server |
| — | **Wire GitHub MCP (Track 2)** | **Next** | [cursor-guide Track 2](cursor-guide.md#track-2--wire-github-mcp-as-the-first-external-upstream) | Real upstream behind `POST /github/mcp`; scope enforced; PAT not exposed |
| — | **Approval queue (Track 3)** | **Planned** | [cursor-guide Track 3](cursor-guide.md#track-3--approval-queue-on-demand-scope) | `202` + admin approve/deny; audit `pending` → `allow`; Gemini function-calling prerequisite |
| — | **Agent registry + Auth0 sync** | **Open** (part of Track 1) | [sketch](#agent-registry-auth0-sync-sketch) | App store is source of truth; unique Auth0 app names; optional reuse |
| 7 | Max request body size | **Done** | [`servers/flight/guard_middleware.py`](../servers/flight/guard_middleware.py) | Oversized POST rejected before JSON parse (1 MiB) |
| — | Gate `POST /token` | **Done** | `gateway/proxy-server.ts`, `ui/proxy-api.ts` | `gateway:admin` Bearer required when `control_plane_auth` |
| — | Upstream structured errors | **Partial** | `gateway/mcp-upstream.ts`, `gateway/proxy-server.ts` | Connect/discovery → `upstream_unavailable`; upstream HTTP errors still pass through on `tools/call` |
| 9 | Multi-server UI | **Deferred** | [`ui/src/agent.ts`](../ui/src/agent.ts), [`gateway/config.yaml`](../gateway/config.yaml) | Second server id in `authorize(server, …)` |
| 10 | Second mock MCP | **Deferred** | New server + UI routing | Two servers in demo (explored on branch; not merged) |
| 12 | Guard HTTP proxy (implementation + prod) | **Done** | [`gateway/proxy-server.ts`](../gateway/proxy-server.ts), Render | Local + prod; [demo-proxy.md](demo-proxy.md) |

### Agent gateway admin auth (sketch) {#agent-gateway-admin-auth-sketch}

When IdP trust is configured (`MCP_JWT_*`) and guard is enabled, the **control plane** requires a human SPA token with **`gateway:admin`**: `POST/DELETE /servers`, `POST/DELETE /agents`, `POST /token`. Local dev can disable via `MCP_GUARD_ENABLED=false` or `MCP_GATEWAY_ADMIN_AUTH=false`. **Runtime** tool enforcement (M2M `flights:read` → search ALLOW, book DENY) is unchanged.

**Target — two planes:**

| Plane | Identity | Today | Target |
|-------|----------|-------|--------|
| **Control** | Human operator | No auth on admin routes | Auth0 SPA login + `gateway:admin` (or finer permissions) |
| **Runtime** | M2M agent | Scoped JWT on `tools/call` | Unchanged |

**Proposed API permissions** (same audience `https://mcp-tool-guard`, separate from tool scopes like `flights:read`):

| Permission | Routes (v1) |
|------------|----------------|
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
|-----|--------|
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

### Not in 0.3.x

- Real vendor MCP without **deployed guard proxy** — proxy is live; wire vendor URL next ([CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp))
- **Agent gateway admin auth** — control plane gated by human login ([sketch](#agent-gateway-admin-auth-sketch))
- **Agent registry + Auth0 sync** — KV agent list, naming, reuse ([sketch](#agent-registry-auth0-sync-sketch))

### Tier 2 (later)

- Keycloak / Azure AD (same `MCP_JWT_*` env)
- Audit export → Loki / Datadog / OTel
- Rate limiting on MCP + `/audit`

---

## Known limitations

| Topic | Detail |
|-------|--------|
| WebLLM (1B) | May still mis-route; heuristics shipped (#11) — prefer explicit `book FL505 for …` / `Cancel booking BK-…` |
| Guest JWTs in repo | Public demo; Auth0 is the IdP story |
| Policy | `gateway/config.yaml` canonical; flight `guard_config.yaml` demo-only embedded guard on Vercel |
| Prod proxy audit | In-memory on Render process; resets on redeploy / spin-down |
| Agent gateway registry | In-memory on proxy — UI-added MCPs lost on restart; seeded yaml entries survive |
| Agents page WebLLM (1B) | Prefer explicit prompts (*Search flights from JFK to MIA*) or cloud LLM API keys; no flight heuristics on `/agents.html` |
| Agent gateway control plane | `POST /servers`, `POST /agents` unauthenticated (demo) — [admin auth sketch](#agent-gateway-admin-auth-sketch) |
| Agent list | Browser memory only — refresh loses cards; Auth0 clients may remain ([registry sketch](#agent-registry-auth0-sync-sketch)) |
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
