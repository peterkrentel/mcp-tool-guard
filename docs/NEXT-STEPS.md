# Next steps (post–0.3.0)

**Navigation:** [Roadmap](ROADMAP.md) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [CONCEPT](CONCEPT.md)

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

---

## Implementation backlog (post-0.3.0) {#implementation-backlog-post-030}

Branch per task; update `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). ROADMAP numbers in [ROADMAP.md](ROADMAP.md#release-030--hardening--multi-server).

### Recommended build order

| Step | # | Why |
|------|---|-----|
| **1** | **#12** | Guard HTTP proxy — **primary product path** for MCP you do not host ([CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp)); authoritative enforce + audit in front of vendor/customer URLs |
| Anytime | **#7** | Max request body — hardening on flight demo server |
| **Deferred** | **#9 + #10** | Multi-server UI + second owned mock MCP — optional; `gateway/config.yaml` stubs + flight demo suffice until proxy |

Agent-vs-chat UI and external SDK agents are optional polish; they do not change the authoritative enforcement story.

### Tasks

| # | Task | Status | Touch | Acceptance |
|---|------|--------|-------|------------|
| 7 | Max request body size | Open | [`servers/flight/guard_middleware.py`](../servers/flight/guard_middleware.py) | Oversized POST rejected before JSON parse |
| 9 | Multi-server UI | **Deferred** | [`ui/src/agent.ts`](../ui/src/agent.ts), [`gateway/config.yaml`](../gateway/config.yaml) | Second server id in `authorize(server, …)` |
| 10 | Second mock MCP | **Deferred** | New server + UI routing | Two servers in demo (explored on branch; not merged) |
| 12 | Guard HTTP proxy (Tier 2) | **Next** | New gateway service | Unowned MCP URL behind proxy + audit |

### Not in 0.3.x

- Real vendor MCP without **guard proxy** (#12) — [CONCEPT → unowned MCP](CONCEPT.md#third-party--unowned-mcp)

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
| Policy | `gateway/config.yaml` canonical; flight `guard_config.yaml` demo-only until proxy #12 |
| Flight seat counts | In-memory seed; only **bookings** use KV |

---

## Related

- [identity.md](identity.md) — Path A, dual trust
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
