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

**Before coding:** complete [auth0-setup.md](auth0-setup.md) and set env from [auth0-env.example](auth0-env.example).

---

## 0.3.0 — recommended order

### Phase A — Identity + Auth0 (primary PRs)

| ROADMAP # | Work |
|-----------|------|
| 1 | Auth0 SPA login **+ guest demo** (`demo-tokens.json` dropdown) | Dual trust on flight |
| 2 | Flight + SDK: JWKS (Auth0) **and** PEM (guest); `iss` / `aud` for IdP tokens only |
| 3 | `GET /audit` requires same Bearer JWT (+ optional `audit:read`) |
| 4 | `MCP_GUARD_ENABLED=false` — fail-closed or loud startup warning |
| 5 | UI: show when server audit fetch fails |

### Phase B — Reliable server audit on Vercel (PR after A)

| ROADMAP # | Work |
|-----------|------|
| 6 | Vercel KV (or Redis) for server audit — fixes serverless instance split |

### Phase C — Hardening & multi-server

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

## Known limitations (until Phase A ships)

| Topic | Detail |
|-------|--------|
| `GET /audit` | Unauthenticated on public flight — fixed by Phase A (#3) |
| Server audit on Vercel | Intermittent until KV (Phase B) |
| Demo tokens in repo | Replaced by Auth0 on public UI after Phase A |
| Policy in three files | Until #8 |

---

## Client scoping for remote MCP

SDK supports multiple servers in `gateway/config.yaml`; UI wires `flight` only. **#9** adds routing; **Tier 2 proxy** adds authoritative enforcement for vendors you do not control — [CONCEPT → Third-party / unowned MCP](CONCEPT.md#third-party--unowned-mcp).

---

## Related

- [identity.md](identity.md) — Path A vs B, architecture, env vars
- [auth0-setup.md](auth0-setup.md) — dashboard checklist
- [ROADMAP.md](ROADMAP.md) — full task table
