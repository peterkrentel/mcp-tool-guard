# Identity — demo tokens, IdP, and `/audit` auth

**Navigation:** [Auth0 setup](auth0-setup.md) · [CONCEPT → JWT](CONCEPT.md#jwt--demo-tokens) · [Roadmap 0.3](ROADMAP.md#release-030--hardening--multi-server) · [Next steps](NEXT-STEPS.md)

MCPToolGuard’s product pitch: **bring your identity provider; we enforce JWT scopes at the MCP tool layer.** This doc compares the two ways to close the public **`GET /audit`** gap and how **Auth0** (demo) vs **Keycloak** (enterprise) fit the same code path.

---

## Current state (0.3.0)

| Piece | Today |
|-------|--------|
| MCP `tools/call` | `Authorization: Bearer` + dual trust: **JWKS** (`MCP_JWT_*`) or **demo PEM** |
| Scopes | `flights:read`, `flights:write`, `flights:delete` in JWT `scope` claim |
| UI tokens | **Guest:** `demo-tokens.json` dropdown · **Auth0:** SPA login (`VITE_AUTH0_*`) |
| `GET /audit` | **Bearer JWT required** when guard enabled (guest or Auth0 token) |
| `iss` / `aud` | Validated on IdP path only |
| JWKS | Auth0 (or any OIDC issuer via env) + PEM fallback for guest |

---

## Two directions for `/audit` + hygiene

### Path A — Real IdP (**chosen for 0.3**)

Use the **same access token** for MCP and `/audit` (optional `audit:read` permission). Demonstrates the product; no throwaway secret.

| Pros | Cons |
|------|------|
| Matches “bring your IdP” pitch | More work than a secret |
| Fixes `iss`/`aud`, JWKS, login flow in one arc | Auth0 tenant + Vercel env setup |
| `/audit` gated by Bearer JWT | Requires UI login before agent demo |
| Replaces committed demo tokens on public deploy | Local dev needs Auth0 app or fallback |

**Implementation:** [auth0-setup.md](auth0-setup.md) → deploy env from [auth0-env.example](auth0-env.example).

### Path B — Shared audit secret (not pursuing)

`MCP_AUDIT_SECRET` + `VITE_AUDIT_SECRET`; plain Bearer on `GET /audit` only.

| Pros | Cons |
|------|------|
| Shippable in hours | Contradicts IdP product story |
| Closes casual `/audit` scraping | Secret in frontend bundle — not real security |
| | Throwaway when IdP lands |

**Use only** as a temporary bridge if IdP is delayed: disable public `/audit` (404) instead of shipping Path B to prod.

---

## Auth0 vs Keycloak (same gateway, different issuer)

The **enforcement code is issuer-agnostic**. Configure issuer URL, audience, and JWKS; scopes stay `flights:*`.

| | **Auth0** (0.3 demo) | **Keycloak** (later / enterprise) |
|--|----------------------|-------------------------------------|
| **Speed** | Fast — hosted, free tier, SPA + API wizard | You run realm; you know it |
| **Demo story** | “Login → scoped agent” in minutes | “Same app, your Keycloak realm” |
| **Issuer** | `https://<tenant>.auth0.com/` | `https://<host>/realms/<realm>` |
| **Audience (`aud`)** | Auth0 API identifier | Client audience / resource |
| **Scopes** | API permissions | Client roles / mappers → `scope` |
| **UI login** | Auth0 SPA SDK (PKCE) | Keycloak JS adapter or generic OIDC |
| **When to use** | **Now** — ship 0.3 identity | Second environment; customer slide |

Swap IdP = change env vars + issuer dashboard — **no change** to scope middleware or tool policy YAML.

---

## Target architecture (0.3.0)

```
User → Auth0 login (PKCE) → access token (aud + scopes)
         │
         ├─► POST /mcp  Authorization: Bearer <access_token>
         │         └─► guard: JWKS + iss + aud + scope → allow/deny
         │
         └─► GET /audit Authorization: Bearer <access_token>
                   └─► same verify (+ optional audit:read permission)
```

**Local dev:** Auth0 SPA callbacks include `http://localhost:5173`. **Guest mode** uses existing `demo-tokens.json` when user skips login (see below).

---

## Guest demo (existing JWTs) + Auth0

**Yes — keep both.** Recommended for the public UI:

| Mode | UI | Token | Server verify |
|------|-----|-------|----------------|
| **Guest** | “Try demo” / scope dropdown (today’s UX) | `demo-tokens.json` JWT | Demo **PEM** (`MCP_GUARD_PUBLIC_KEY_PEM`) — same as 0.2 |
| **Signed in** | Auth0 login button | Auth0 **access token** | **JWKS** + `iss` / `aud` |

```
                    ┌─ Guest ──► demo JWT ──► PEM verify ──► scopes
User opens UI ──────┤
                    └─ Login ──► Auth0 token ──► JWKS verify ──► scopes
```

**Flight server (dual trust):**

1. Decode JWT header → try **JWKS** path if `iss` matches `MCP_JWT_ISSUER`.
2. Else verify with **demo public PEM** (no `iss`/`aud` required for guest tokens, or fixed demo `iss` if you add one later).
3. Same scope enforcement either way (`flights:read`, etc.).

**`/audit`:** Accept **either** token type in `Authorization: Bearer` — closes public unauthenticated scrape without forcing Auth0 for casual visitors.

**UI:**

- Default or prominent **“Continue as guest”** → existing dropdown (`read_only` / `booking` / `admin`).
- **“Sign in”** → Auth0; hide or de-emphasize dropdown when logged in.
- Optional: `VITE_ENABLE_GUEST_DEMO=true` (default on) to hide guest on strict prod later.

**Security (honest):**

- Guest JWTs stay in `ui/public/demo-tokens.json` — **public demo credentials**, same as today. Fine for “try it”; Auth0 path shows real IdP.
- Do **not** treat guest mode as production identity.

**Vercel env:** Keep **`MCP_GUARD_PUBLIC_KEY_PEM`** on flight **and** add `MCP_JWT_*` for Auth0 — both trust paths active.

---

## Env vars (see [auth0-env.example](auth0-env.example))

| Where | Variable | Purpose |
|-------|----------|---------|
| UI | `VITE_AUTH0_DOMAIN` | Tenant domain |
| UI | `VITE_AUTH0_CLIENT_ID` | SPA client id |
| UI | `VITE_AUTH0_AUDIENCE` | API identifier (= `aud`) |
| Flight | `MCP_JWT_ISSUER` | Expected `iss` |
| Flight | `MCP_JWT_AUDIENCE` | Expected `aud` |
| Flight | `MCP_JWT_JWKS_URL` | JWKS URI (or derive from issuer `/.well-known/openid-configuration`) |

When `MCP_JWT_*` unset, flight uses **PEM mode only** (guest demo / CI). Set all three JWKS vars on Vercel flight for Auth0 alongside `MCP_GUARD_PUBLIC_KEY_PEM`.

---

## Code (0.3.0 — shipped)

| Area | Change |
|------|--------|
| `servers/flight/guard.py` | Dual trust: JWKS (Auth0) or PEM (guest); `validate_token()` |
| `gateway/guard.ts` | Same for client pre-check |
| `ui/src/auth.ts`, `main.ts` | Auth0 login + guest mode |
| `ui/src/audit-view.ts` | Bearer on `/audit`; error banner |
| `servers/flight/server.py` | `/audit` requires valid JWT when guard enabled |

---

## Demo tokens — guest mode (keep)

| Mode | When |
|------|------|
| **Guest** | Always on public demo by default — `demo-tokens.json` + PEM on flight |
| **Auth0** | Optional login — proves IdP pitch |
| **Local / CI** | Guest works without Auth0 env; Auth0 when `ui/.env.local` set |

No shorter expiry — guest JWTs remain committed for zero-friction try-it; IdP is the “real” path for customers.

---

## Related

- [auth0-setup.md](auth0-setup.md) — dashboard checklist + deploy
- [auth0-env.example](auth0-env.example) — copy to Vercel / local `.env`
- [CONCEPT → Third-party / unowned MCP](CONCEPT.md#third-party--unowned-mcp) — proxy for MCP you don’t own (separate from identity)
