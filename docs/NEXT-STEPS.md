# Next steps (post–0.3.0)

**Navigation:** [Deploy overview](deploy-overview.md) · [Roadmap](ROADMAP.md) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [Guard proxy](guard-proxy.md) · [CONCEPT](CONCEPT.md)

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

---

## Implementation backlog (post-0.3.0) {#implementation-backlog-post-030}

Branch per task; update `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). ROADMAP numbers in [ROADMAP.md](ROADMAP.md#release-030--hardening--multi-server).

**Deploy map:** [deploy-overview.md](deploy-overview.md) — local `make dev` vs Vercel prod today vs target UI → proxy → flight.

### Recommended build order

| Step | # | Why |
|------|---|-----|
| **1** | **Deploy proxy** | Code is on `main`; prod still UI → flight direct. Host proxy (not Vercel), point yaml at Vercel flight, flip `VITE_MCP_URL` — [checklist](deploy-overview.md#prod-proxy-checklist-next-work) |
| Anytime | **#7** | Max request body — hardening on flight demo server |
| After proxy prod | **Proxy audit UI** | Path banner + terminal view (stashed locally); merge when `VITE_MCP_URL` hits proxy |
| **Deferred** | **#9 + #10** | Multi-server UI + second owned mock MCP — optional |

Agent-vs-chat UI and external SDK agents are optional polish; they do not change the authoritative enforcement story.

### Tasks

| # | Task | Status | Touch | Acceptance |
|---|------|--------|-------|------------|
| — | **Deploy guard proxy to prod** | **Next** | Host + `gateway/config.yaml` upstream URL + UI `VITE_MCP_URL` | `GET /health` on proxy; UI chat via proxy; `/audit` `source: guard-proxy` |
| 7 | Max request body size | Open | [`servers/flight/guard_middleware.py`](../servers/flight/guard_middleware.py) | Oversized POST rejected before JSON parse |
| 9 | Multi-server UI | **Deferred** | [`ui/src/agent.ts`](../ui/src/agent.ts), [`gateway/config.yaml`](../gateway/config.yaml) | Second server id in `authorize(server, …)` |
| 10 | Second mock MCP | **Deferred** | New server + UI routing | Two servers in demo (explored on branch; not merged) |
| 12 | Guard HTTP proxy (implementation) | **Done** | [`gateway/proxy-server.ts`](../gateway/proxy-server.ts) | Local + `make proxy`; prod deploy tracked above |

### Not in 0.3.x

- Real vendor MCP in prod without **deployed guard proxy** — [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp)

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
| Prod proxy | Implemented on `main`; not deployed — Vercel demo bypasses proxy ([deploy-overview.md](deploy-overview.md)) |
| Flight seat counts | In-memory seed; only **bookings** use KV |

---

## Related

- [deploy-overview.md](deploy-overview.md) — three services, traffic paths, prod checklist
- [vercel-deploy.md](vercel-deploy.md) — flight + UI on Vercel
- [guard-proxy.md](guard-proxy.md) — proxy routes and env
- [identity.md](identity.md) — Path A, dual trust
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
