# Auth0 setup (0.3)

**Navigation:** [Identity overview](identity.md) · [Env template](auth0-env.example) · [Next steps](NEXT-STEPS.md) · [Screenshots folder](images/auth0/README.md)

End-to-end Auth0 configuration for the demo UI and flight MCP server: dashboard checklist, **local dev**, Vercel env, token verification, and troubleshooting.

**Example tenant** (replace with yours): `dev-p5fg6ldthdyeom16.us.auth0.com`

---

## Overview

```mermaid
flowchart LR
  subgraph auth0 [Auth0]
    User[User login]
    API[API permissions]
  end
  subgraph ui [UI localhost or Vercel]
    SPA[Sign in / guest]
  end
  subgraph flight [Flight MCP]
    Guard[JWKS + PEM guard]
  end
  User --> SPA
  API --> SPA
  SPA -->|Bearer access token| Guard
```

| Component | Auth0 role |
|-----------|------------|
| **SPA** (`mcp-tool-guard`) | User logs in; gets access token |
| **API** (`https://mcp-tool-guard`) | Defines `flights:*` permissions + audience |
| **Flight server** | Validates token (JWKS + scopes); **not** an Auth0 app |

---

## Part 1 — Auth0 dashboard

### Step 1 — Note your tenant domain

1. Log in at [auth0.com](https://auth0.com)
2. Top-left tenant menu → note **Tenant Name** + **Region**

Full domain is usually:

```text
<TENANT_NAME>.us.auth0.com
```

Example: `dev-p5fg6ldthdyeom16.us.auth0.com`

Confirm under **Settings → Tenant Settings → General** (Tenant Name + Region).

![Tenant selector](images/auth0/01-tenant-selector.png)

---

### Step 2 — Create the API (audience + permissions)

**Applications → APIs → Create API**

| Field | Value |
|-------|--------|
| Name | `api-for-mcp-tool-guard` (friendly name; any label OK) |
| **Identifier** | `https://mcp-tool-guard` ← this is **`aud`** everywhere |
| Signing algorithm | RS256 |

**API → Permissions tab** — add (scope rights MCPToolGuard enforces per tool):

| Permission | Domain | Demo profile |
|------------|--------|--------------|
| `flights:read` | Flight MCP | read_only |
| `flights:write` | Flight MCP | booking |
| `flights:delete` | Flight MCP | admin cancel |
| `docs:read` | Documents MCP | read_only |
| `docs:write` | Documents MCP | booking |
| `docs:delete` | Documents MCP | admin archive |

These are **capabilities**, not “access to a server URL.” Policy in `gateway/config.yaml` maps each tool to one permission. One access token can carry flight + document scopes together.

![API permissions](images/auth0/02-api-permissions-tab.png)

*Screenshots may show only `flights:*` — add `docs:*` the same way for multi-server demo.*

---

### Step 3 — Enable RBAC on the API

**API → Settings** → scroll to **RBAC Settings**

Turn **both** toggles **ON**, then **Save**:

| Toggle | Required |
|--------|----------|
| **Enable RBAC** | ON |
| **Add Permissions in the Access Token** | ON |

Without the second toggle, access tokens only get `scope: openid profile email` — **no** `flights:*`.

![RBAC settings](images/auth0/03-api-rbac-settings.png)

**Application Access Policy** (same Settings page):

| Setting | Value |
|---------|--------|
| User-delegated Access | **Per-app authorization** |
| Client Access | Per-app authorization (or Unauthorized — M2M not used) |

---

### Step 4 — Authorize the SPA on the API

**API → Application Access** tab

Find **`mcp-tool-guard`** (Single Page Application). Set:

| Column | Target |
|--------|--------|
| **User-delegated Access** | **Authorized** — **6 / 6 permissions granted** (or subset per test persona) |
| Client Access | Unauthorized (0/6) is fine |

![Application Access on API](images/auth0/04-api-application-access.png)

**Alternate path (same result):** **Applications → Applications → `mcp-tool-guard` → API Access** → authorize `api-for-mcp-tool-guard` with user-delegated permissions.

### Roles vs direct user permissions (recommended at scale)

For demos you can assign permissions **directly on a user** (Step 6). For production, use **Auth0 Roles** that bundle scopes, then assign users to roles:

| Role (example) | Permissions |
|----------------|-------------|
| `mcp-read-only` | `flights:read`, `docs:read` |
| `mcp-operator` | above + `flights:write`, `docs:write` |
| `mcp-admin` | all six (or `flights:*` / `docs:*` if you define wildcards in Auth0) |

MCPToolGuard only sees the flattened `permissions` array in the token — not role names. See [identity.md → Scopes vs roles](identity.md#scopes-vs-roles-how-admins-grant-access).

![SPA API Access](images/auth0/05-spa-api-access.png)

---

### Step 5 — Create / configure the SPA

**Applications → Applications → Create Application**

| Field | Value |
|-------|--------|
| Name | `mcp-tool-guard` |
| Type | **Single Page Application** |

**Settings:**

| Setting | Values |
|---------|--------|
| Allowed Callback URLs | `http://localhost:5173`, `https://mcp-tool-guard-ui.vercel.app` |
| Allowed Logout URLs | same |
| Allowed Web Origins | same |

Copy **Client ID** → `VITE_AUTH0_CLIENT_ID`.

![SPA callback URLs](images/auth0/07-spa-callback-urls.png)

---

### Step 6 — Create a test user and assign permissions

**User Management → Users → Create User** (email + password).

Open the user → **Permissions** tab → **Assign Permissions**:

- API: `https://mcp-tool-guard` (shown as `api-for-mcp-tool-guard`)
- Permissions: e.g. all six for admin testing, or a subset per persona below

| Persona | Permissions | Flight demo | Documents demo |
|---------|-------------|-------------|----------------|
| Read-only | `flights:read`, `docs:read` | Search | List/get DOC-42 |
| Booking | + `flights:write`, `docs:write` | Book | Publish |
| Admin | + `flights:delete`, `docs:delete` | Cancel | Archive |

Create **separate users** (or roles) for read-only and booking personas — a user with all permissions will **allow** every demo action and will not show scope **deny** in the audit panel.

![User permissions](images/auth0/06-user-permissions.png)

**Authorized Applications** tab showing the SPA is **not** the same as Permissions — both should exist, but only Permissions puts `flights:*` in the token.

---

## Part 2 — Local development

### Two places for env vars (common gotcha)

| Where | Read by | Variables |
|-------|---------|-----------|
| **`ui/.env.local`** | Vite (UI only) | `VITE_*` only |
| **Shell before `make flight`** | Python flight server | `MCP_JWT_*`, `MCP_GUARD_*` |

**Do not put `MCP_JWT_*` in `ui/.env.local`** — Vite does not pass them to `make flight`, so Auth0 tokens will fail on the server (client ALLOW, server DENY). Same split on Vercel: flight project vs UI project.

Do **not** store Auth0 user passwords in `.env.local` — only public SPA/API config (`VITE_*`, issuer URLs).

### Step 7 — UI env file

Copy [auth0-env.example](auth0-env.example) → **`ui/.env.local`** (gitignored):

```bash
VITE_AUTH0_DOMAIN=dev-p5fg6ldthdyeom16.us.auth0.com
VITE_AUTH0_CLIENT_ID=<SPA Client ID>
VITE_AUTH0_AUDIENCE=https://mcp-tool-guard
VITE_MCP_URL=http://localhost:5173/mcp
```

Restart **`make ui`** after any change (Vite reads env at startup).

### Step 8 — Flight server env (Auth0 path)

Guest demo works without these. For **Sign in** tokens, export in the **same terminal** before **`make flight`** (or one line):

```bash
export MCP_JWT_ISSUER=https://dev-p5fg6ldthdyeom16.us.auth0.com/
export MCP_JWT_AUDIENCE=https://mcp-tool-guard
make flight
```

Or:

```bash
MCP_JWT_ISSUER=https://dev-p5fg6ldthdyeom16.us.auth0.com/ \
MCP_JWT_AUDIENCE=https://mcp-tool-guard \
make flight
```

Restart flight after changing env — a stale process without `MCP_JWT_*` causes server scope DENY while the UI client guard ALLOWs.

![Local flight terminal](images/auth0/09-local-flight-env.png)

Terminal 2: `make ui` → open `http://localhost:5173`

### Step 9 — Sign in and smoke test

1. Click **Sign in** → Auth0 login → return to localhost
2. **Initialize** (WebLLM may take ~1 min first load)
3. *Search flights from SFO to JFK* → **allow** (needs `flights:read`)
4. *book FL101 Name, email@example.com* → **allow** (needs `flights:write`)
5. *Cancel booking BK-…* using the ID from step 4 → **allow** (needs `flights:delete`)

Use **`Cancel booking BK-…`** (include the word *booking*). Bare `delete BK-…` can work but is easier to mis-route.

Guest mode still works: use JWT dropdown without signing in. The guest dropdown may still show while signed in — Auth0 token is used when you clicked Sign in.

**In-memory bookings** reset when the flight process restarts; book and cancel in one session without restarting `make flight`. On Vercel, bookings may not persist across requests (serverless) — see troubleshooting below.

![Signed-in UI success](images/auth0/10-local-ui-signed-in.png)

---

## Part 3 — Verify the access token

Use the **access token**, not the ID token.

### Where to find it in the browser

**DevTools → Application → Local Storage → `http://localhost:5173`**

Use the row whose key contains **`https://mcp-tool-guard`**. Copy `body.access_token` (the long `eyJ…` string).

Do **not** use the `@@user@@` row — that is the **ID token** (`aud` = Client ID, has `email` / `picture`).

![Local Storage access token row](images/auth0/08-localstorage-access-token.png)

Decode at [jwt.io](https://jwt.io). **Good access token payload:**

```json
{
  "iss": "https://dev-p5fg6ldthdyeom16.us.auth0.com/",
  "aud": ["https://mcp-tool-guard", "https://…/userinfo"],
  "scope": "openid profile email",
  "permissions": ["docs:delete", "docs:read", "docs:write", "flights:delete", "flights:read", "flights:write"]
}
```

| Claim | Meaning |
|-------|---------|
| `aud` includes `https://mcp-tool-guard` | Correct API token |
| `permissions` | Auth0 RBAC — **enforced by MCPToolGuard** |
| `scope` | Often only OIDC scopes; `flights:*` live in `permissions` |

After changing RBAC or user permissions: **Sign out → Sign in** (old tokens do not update).

**Read-only persona** — same token row in Local Storage; payload should show only `flights:read`:

![Read-only access token on jwt.io](images/demo/auth0-access-token-read-only-jwtio.png)

```json
{
  "permissions": ["flights:read"]
}
```

Search → allow; book/cancel → **deny** (client blocks before MCP when scopes are missing):

![Read-only scope deny in prod UI](images/demo/prod-scope-deny-read-only.png)

---

## Part 4 — Vercel environment variables

Deploy **flight first**, then **UI**. See [vercel-deploy.md](vercel-deploy.md).

### Flight (`mcp-tool-guard-flight-server`)

| Variable | Example |
|----------|---------|
| `MCP_GUARD_PUBLIC_KEY_PEM` | Keep — guest demo PEM |
| `MCP_JWT_ISSUER` | `https://dev-p5fg6ldthdyeom16.us.auth0.com/` |
| `MCP_JWT_AUDIENCE` | `https://mcp-tool-guard` |
| `MCP_JWT_JWKS_URL` | Optional — derived from issuer |

### UI (`mcp-tool-guard-ui`)

| Variable | Example |
|----------|---------|
| `VITE_MCP_URL` | `https://mcp-tool-guard-flight-server.vercel.app/mcp` |
| `VITE_AUTH0_DOMAIN` | `dev-p5fg6ldthdyeom16.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | SPA Client ID |
| `VITE_AUTH0_AUDIENCE` | `https://mcp-tool-guard` |

Redeploy **both** after env changes (UI needs a **rebuild**).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|--------|-----|
| Sign in redirect error | Callback URL mismatch | Add exact `http://localhost:5173` to SPA Settings |
| Token `aud` = Client ID, has `email` | Decoded **ID token** | Use access token from localStorage key with `https://mcp-tool-guard` |
| No `permissions` in token | RBAC off or not saved | Step 3 toggles ON + Save; Sign out/in |
| Client ALLOW, server DENY (missing scope) | Flight without `MCP_JWT_*` or old process | Step 8: export in flight terminal; restart `make flight` on current `main` |
| Deny with empty scopes | User lacks API permissions | Step 6 — user Permissions tab |
| SPA 3/3 but token empty | Add Permissions in Access Token off | Step 3 |
| Server audit 401 locally | No Bearer on `/audit` | Initialize first; same token as MCP |
| Guest works, Auth0 fails on server | Dual trust | Keep PEM **and** set `MCP_JWT_*` on flight |
| Audit ALLOW but chat says cancel failed / not found | Scope passed; mock booking missing | Same flight process; use `Cancel booking BK-…`; on Vercel = in-memory split |
| `curl …/health` → `jwt_trust_enabled: false` | `MCP_JWT_*` not set in that terminal | Re-export and restart flight |

Verify flight Auth0 config: `curl http://localhost:8000/health` → `"jwt_trust_enabled": true` when using Sign in locally.

---

## Smoke test checklist

- [ ] Guest: dropdown → Initialize → search allow, cancel deny
- [ ] Auth0: Sign in → Initialize → search → book → **Cancel booking BK-…** (all allow with full permissions)
- [ ] Auth0 read-only user: search allow, book/cancel **deny** ([UI](images/demo/prod-scope-deny-read-only.png), [token](images/demo/auth0-access-token-read-only-jwtio.png))
- [ ] Access token has `permissions` array after RBAC enabled (not only OIDC `scope`)
- [ ] Client and server audit rows **match** (no mismatch banner)
- [ ] `curl http://localhost:8000/health` → `jwt_trust_enabled: true` (local Auth0)
- [ ] `curl /audit` without Bearer → 401 (when guard enabled)

---

## Keycloak later

Same env semantics — swap issuer/JWKS URLs only:

| Auth0 | Keycloak |
|-------|----------|
| `MCP_JWT_ISSUER` | `https://<host>/realms/<realm>` |
| `MCP_JWT_JWKS_URL` | From OpenID discovery `jwks_uri` |
| `MCP_JWT_AUDIENCE` | Client / resource audience |

---

## Related

- [identity.md](identity.md) — dual trust (guest PEM + Auth0 JWKS)
- [auth0-env.example](auth0-env.example) — copy-paste env template
- [images/auth0/README.md](images/auth0/README.md) — screenshot filenames for this doc
