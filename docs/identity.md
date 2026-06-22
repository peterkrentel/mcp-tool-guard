# Identity — demo tokens, IdP, and `/audit` auth

**Navigation:** [Auth0 setup](auth0-setup.md) · [CONCEPT → JWT](CONCEPT.md#jwt--demo-tokens) · [Roadmap](ROADMAP.md) · [Next steps](NEXT-STEPS.md)

MCPToolGuard’s product pitch: **bring your identity provider; we enforce JWT scopes at the MCP tool layer.** This doc compares the two ways to close the public **`GET /audit`** gap and how **Auth0** (demo) vs **Keycloak** (enterprise) fit the same code path.

---

## Scopes vs roles (how admins grant access)

**At enforcement time:** users and agents present a token with **scope rights** (`flights:read`, `docs:write`, …). MCPToolGuard checks those strings against per-tool policy in `gateway/config.yaml` — not usernames, not group names, not MCP server URLs.

**At admin time:** assign **roles or groups** in your IdP; each role grants a **bundle of scopes**. Token issuance flattens roles into the access token (`permissions` on Auth0, `scope` on many OIDC providers). MCPToolGuard does not need a separate “group” concept.

```
Admin:  Alice → role flight-readers → [flights:read, docs:read]
Login:  access token carries permissions[]
Call:   publish_document_tool requires docs:write → DENY (expected for read-only persona)
```

| Pattern | When to use |
|---------|-------------|
| **User → scope** (direct) | Demos, one-off test users |
| **Role/group → scopes** | Production — onboarding, SoD, many users |
| **Wildcard scopes** (`flights:*`, `*`) | Admin or break-glass bundles |

One token works across **all MCP servers** the agent calls (flight, documents, future proxied vendors) as long as the token includes the scopes those tools require.

Rationale and wildcards: [CONCEPT → Scopes, roles, and identity](CONCEPT.md#scopes-roles-and-identity).

---

## Admin vs agent tokens (agent gateway) {#admin-vs-agent-tokens-agent-gateway}

The [`/agents.html`](../ui/agents.html) page uses **two different identities** — do not conflate them.

| Who | Token | Used for |
|-----|-------|----------|
| **Human admin** (target) | Auth0 SPA **user** access token with `gateway:admin` | Register MCPs, create/revoke M2M agents (control plane) |
| **M2M agent** (today) | `client_credentials` token with **tool scopes** (`flights:read`, …) | `tools/call` + client `ToolGuard` pre-check (runtime) |

**Implemented:** `/agents.html` requires Auth0 SPA sign-in with **`gateway:admin`** on the control plane when the proxy has IdP trust (`MCP_JWT_*`) and guard enabled. Mutating routes (`POST/DELETE /servers`, `/agents`, `POST /token`) verify your user access token; chat still uses the **selected M2M agent** token for `tools/call`.

**Local dev:** Set `MCP_GUARD_ENABLED=false` or omit `MCP_JWT_ISSUER` to keep the control plane open without sign-in.

**Auth0 setup (sketch):**

1. On API `https://mcp-tool-guard`, add permission `gateway:admin`.
2. Role `platform-admin` → `gateway:admin` (+ `audit:read` if needed).
3. Assign operator users to that role — **not** the M2M agents you create for workloads.
4. M2M client grants only include tool scopes from the create form (e.g. `flights:read`).

Implementation backlog: [NEXT-STEPS → Agent gateway admin auth](NEXT-STEPS.md#agent-gateway-admin-auth-sketch).

**Registry sync:** Stage 1 creates one Auth0 Application per **Create agent** (`mcp-agent-${name}`) with no server-side agent list — see [Agent registry + Auth0 sync](NEXT-STEPS.md#agent-registry-auth0-sync-sketch) for KV source-of-truth, unique Auth0 names, and reuse/templates to avoid tenant client limits.

---

## Current state (shipped)

| Piece | Today |
|-------|--------|
| MCP `tools/call` | `Authorization: Bearer` + dual trust: **JWKS** (`MCP_JWT_*`) or **demo PEM** |
| Scopes | `flights:*`, `repo:read` / `repo:write` (GitHub MCP), `docs:*`, stubs `slack:*` in policy — JWT `permissions` / `scope` |
| UI tokens | **Guest:** `demo-tokens.json` dropdown · **Auth0:** SPA login (`VITE_AUTH0_*`) |
| `GET /audit` | **Bearer JWT required** when guard enabled (guest or Auth0 token) |
| `iss` / `aud` | Validated on IdP path only |
| JWKS | Auth0 (or any OIDC issuer via env) + PEM fallback for guest |

---

## Two directions for `/audit` + hygiene

### Path A — Real IdP (**chosen for shipped release**)

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

The **enforcement code is issuer-agnostic**. Configure issuer URL, audience, and JWKS; scope namespaces (`flights:*`, `docs:*`, …) come from your API permissions and policy yaml.

| | **Auth0** (current demo) | **Keycloak** (later / enterprise) |
|--|----------------------|-------------------------------------|
| **Speed** | Fast — hosted, free tier, SPA + API wizard | You run realm; you know it |
| **Demo story** | “Login → scoped agent” in minutes | “Same app, your Keycloak realm” |
| **Issuer** | `https://<tenant>.auth0.com/` | `https://<host>/realms/<realm>` |
| **Audience (`aud`)** | Auth0 API identifier | Client audience / resource |
| **Scopes** | API permissions | Client roles / mappers → `scope` |
| **UI login** | Auth0 SPA SDK (PKCE) | Keycloak JS adapter or generic OIDC |
| **When to use** | **Now** — shipped identity layer | Second environment; customer slide |

Swap IdP = change env vars + issuer dashboard — **no change** to scope middleware or tool policy YAML.

---

## Target architecture (current)

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
3. Same scope enforcement either way (`flights:read`, `docs:write`, etc.).

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

## Code (shipped)

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
