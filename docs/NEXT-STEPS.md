# Next steps (post–0.2.0)

**Navigation:** [Roadmap](ROADMAP.md) · [Identity](identity.md) · [Auth0 setup](auth0-setup.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [CONCEPT](CONCEPT.md)

Post–0.2.0 work and **0.3.0** priorities. Task numbers: [ROADMAP → 0.3.0](ROADMAP.md#release-030--hardening--multi-server).

---

## 0.2.0 — done

- [x] Merged to `main`; Vercel prod (UI + flight)
- [x] Tag `v0.2.0`
- [x] Live smoke test (scope deny, dual audit, admin cancel)

---

## Strategic choice (0.3)

**Path A — Real IdP (Auth0)** is the primary 0.3 track: login → access token → MCP + `/audit`. Matches “bring your IdP.”

**Path B — toy audit secret** is **not** pursuing (see [identity.md](identity.md)). If IdP slips, **disable public `/audit`** temporarily instead.

**Auth0 now, Keycloak later** — same JWKS + `iss`/`aud` code; swap issuer env ([identity → Auth0 vs Keycloak](identity.md#auth0-vs-keycloak-same-gateway-different-issuer)).

**Before deploy:** complete [auth0-setup.md](auth0-setup.md) and set env from [auth0-env.example](auth0-env.example).

---

## 0.3.0 Phase A — done

- [x] Auth0 SPA login + guest demo (`demo-tokens.json` dropdown)
- [x] Flight + SDK: JWKS (Auth0) + PEM (guest); `iss` / `aud` for IdP tokens
- [x] `GET /audit` requires Bearer JWT
- [x] `MCP_GUARD_ENABLED=false` loud startup warning
- [x] UI: server audit fetch error state

**Deploy:** set env from [auth0-env.example](auth0-env.example) on **both** Vercel projects; redeploy UI + flight.

---

## 0.3.0 Phase B — code shipped {#phase-b}

- [x] Vercel KV / Upstash REST for server audit (`audit:recent`, `audit:session:{id}`)
- [x] KV booking store (`booking:{BK-…}`) — book/cancel across serverless invocations
- [x] In-memory fallback when `KV_REST_API_*` unset (local dev)
- [ ] **Deploy:** link KV store to flight project — [vercel-deploy → KV](vercel-deploy.md#vercel-kv-phase-b)

Design: [kv-design.md](kv-design.md).

## 0.3.0 — remaining (Phase C+) {#030--remaining-phase-b}

| ROADMAP # | Work |
|-----------|------|
| 7 | Middleware max request body size |
| 8 | Single policy source + CI drift test |
| 9 | Multi-server UI (`gateway/config.yaml` routing) |
| 10 | Optional second mock MCP (`servers/notes/`) |

**Not in 0.3:** Real vendor MCP URLs without **guard proxy** (Tier 2). Client-only scoping is not authoritative for unowned MCP — [CONCEPT](CONCEPT.md#third-party--unowned-mcp).

### Phase D — Production platform (Tier 2)

- **Keycloak / Azure AD** — same env as Auth0; second demo environment
- Audit export to Loki/Datadog/OTel
- HTTP **guard gateway** for unowned upstream MCP
- Rate limiting

---

## Demo tokens — guest + Auth0

| Mode | Tokens |
|------|--------|
| **Guest (default)** | `demo-tokens.json` dropdown — keep on public Vercel |
| **Auth0 login** | Access token from IdP — product demo |
| **Flight** | **Both** PEM (guest) and JWKS (Auth0) validators |

See [identity.md → Guest demo](identity.md#guest-demo-existing-jwts--auth0).

---

## Known limitations (post–Phase B deploy)

| Topic | Detail |
|-------|--------|
| Server audit on Vercel | Fixed when KV linked (`kv_enabled: true` on `/health`) |
| Guest JWTs in repo | Public demo credentials; Auth0 path is the IdP story |
| Policy in three files | Until ROADMAP #8 |
| Flight seat counts | Still in-memory seed data; only bookings use KV |

---

## Client scoping for remote MCP

SDK supports multiple servers in `gateway/config.yaml`; UI wires `flight` only. **#9** adds routing; **Tier 2 proxy** adds authoritative enforcement for vendors you do not control — [CONCEPT → Third-party / unowned MCP](CONCEPT.md#third-party--unowned-mcp).

---

## Related

- [identity.md](identity.md) — Path A vs B, architecture, env vars
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
