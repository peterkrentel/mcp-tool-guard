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

---

## Implementation backlog (post-0.3.0) {#implementation-backlog-post-030}

Branch per task; update `[Unreleased]` in [CHANGELOG.md](../CHANGELOG.md). ROADMAP numbers in [ROADMAP.md](ROADMAP.md#release-030--hardening--multi-server).

| # | Task | Touch | Acceptance |
|---|------|-------|------------|
| **11** | **WebLLM heuristics** (recommended first) | [`ui/src/tool-args.ts`](../ui/src/tool-args.ts), [`ui/src/agent.ts`](../ui/src/agent.ts) | `FL 505` → `FL505` book; `search all flights` → real tool; fake booking JSON intercepted |
| 7 | Max request body size | [`servers/flight/guard_middleware.py`](../servers/flight/guard_middleware.py) | Oversized POST rejected before JSON parse |
| 8 | Single policy source + CI drift | `guard_config.yaml`, `gateway/config.yaml`, `ui/guard-config.ts`, CI script | Drift fails CI |
| 9 | Multi-server UI | [`ui/src/agent.ts`](../ui/src/agent.ts), [`gateway/config.yaml`](../gateway/config.yaml) | Second server id in `authorize(server, …)` |
| 10 | Second mock MCP (`servers/notes/`) | New server + UI routing | Two servers in demo |
| 12 | Guard HTTP proxy (Tier 2) | New gateway service | Unowned MCP URL behind proxy + audit |

### WebLLM heuristics (#11) — detail

| Change | File | Notes |
|--------|------|--------|
| `FL\s*(\d+)` → `FL505` | `tool-args.ts` | `FLIGHT_ID` regex + normalize before `create_booking_tool` |
| `search all flights` / bare `search` | `tryHeuristicIntent` | `search_flights_tool` with no filters (all seed flights) |
| Intercept invented booking JSON | `interceptNonToolReply` | `"booking_id"`, `"flight_details"` without `Tool \`…\` result` |
| Stronger system prompt | `agent.ts` `systemPrompt()` | Never emit raw flight/booking JSON — only `{"tool":…}` or plain text |

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
| WebLLM (1B) | May invent JSON; use heuristics (#11) or explicit `book FL505 for …` phrasing |
| Guest JWTs in repo | Public demo; Auth0 is the IdP story |
| Policy in three files | Until #8 |
| Flight seat counts | In-memory seed; only **bookings** use KV |

---

## Related

- [identity.md](identity.md) — Path A, dual trust
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
