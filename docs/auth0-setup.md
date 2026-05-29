# Auth0 setup (0.3 prep)

**Navigation:** [Identity overview](identity.md) · [Env template](auth0-env.example) · [Next steps → Phase A](NEXT-STEPS.md#phase-a--identity--auth0-primary)

Step-by-step **Auth0 dashboard** configuration before implementing OIDC login in the UI and JWKS validation on the flight server. Keycloak uses the same env shape later — see [identity.md → Auth0 vs Keycloak](identity.md#auth0-vs-keycloak-same-gateway-different-issuer).

---

## 1. Create Auth0 account

- [auth0.com](https://auth0.com) — **Free** tier is enough for the demo.
- Note your **tenant domain**: `YOUR_TENANT.us.auth0.com` (region may vary).

---

## 2. Create an API (audience + permissions)

**Applications → APIs → Create API**

| Field | Value |
|-------|--------|
| Name | `MCPToolGuard` |
| Identifier | `https://mcp-tool-guard` (this is **`aud`** — use in env as `VITE_AUTH0_AUDIENCE` / `MCP_JWT_AUDIENCE`) |
| Signing algorithm | RS256 |

**Permissions** (add under the API):

| Permission | Maps to demo profile |
|------------|-------------------|
| `flights:read` | read_only |
| `flights:write` | booking (+ read) |
| `flights:delete` | admin cancel |
| `audit:read` | optional — read server `/audit` (or reuse admin permissions) |

Enable **RBAC** and **Add Permissions in the Access Token** if your tenant offers it (so `scope` or `permissions` appear on the access token).

---

## 3. Create SPA application (login UI)

**Applications → Applications → Create Application**

| Field | Value |
|-------|--------|
| Name | `MCPToolGuard UI` |
| Type | **Single Page Application** |

**Settings:**

| Setting | Values |
|---------|--------|
| Allowed Callback URLs | `http://localhost:5173`, `https://mcp-tool-guard-ui.vercel.app` |
| Allowed Logout URLs | same as above |
| Allowed Web Origins | same as above |
| Grant types | Authorization Code, **Refresh Token** (optional), PKCE required for SPA |

**APIs tab:** Authorize this app to call the **MCPToolGuard** API.

Copy **Client ID** → `VITE_AUTH0_CLIENT_ID`.

---

## 4. Test users / roles (mirror demo profiles)

Create users or roles that receive different API permissions:

| Persona | Permissions |
|---------|-------------|
| Read-only | `flights:read` |
| Booking | `flights:read`, `flights:write` |
| Admin | `flights:read`, `flights:write`, `flights:delete`, `audit:read` (if used) |

Assign via **User Management → Users → Permissions** or **Roles**.

---

## 5. Verify token shape (before coding)

Use Auth0 **Test** tab or a quick SPA login:

Access token (decode at [jwt.io](https://jwt.io)) should include:

- `iss`: `https://YOUR_TENANT.us.auth0.com/`
- `aud`: `https://mcp-tool-guard` (or array containing it)
- `scope` or `permissions`: includes `flights:read` etc.

Use the **access token** (not ID token) for MCP `Authorization: Bearer`.

**JWKS URL:** `https://YOUR_TENANT.us.auth0.com/.well-known/jwks.json`

---

## 6. Vercel environment variables

### UI project (`mcp-tool-guard-ui`)

| Variable | Example |
|----------|---------|
| `VITE_AUTH0_DOMAIN` | `YOUR_TENANT.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | from SPA app |
| `VITE_AUTH0_AUDIENCE` | `https://mcp-tool-guard` |
| `VITE_MCP_URL` | `https://mcp-tool-guard-flight-server.vercel.app/mcp` (unchanged) |

### Flight project (`mcp-tool-guard-flight-server`)

| Variable | Example |
|----------|---------|
| `MCP_JWT_ISSUER` | `https://YOUR_TENANT.us.auth0.com/` |
| `MCP_JWT_AUDIENCE` | `https://mcp-tool-guard` |
| `MCP_JWT_JWKS_URL` | `https://YOUR_TENANT.us.auth0.com/.well-known/jwks.json` |

During migration keep **`MCP_GUARD_PUBLIC_KEY_PEM`** for **guest demo** JWTs (`demo-tokens.json`) alongside Auth0 JWKS — see [identity → Guest demo](identity.md#guest-demo-existing-jwts--auth0).

Redeploy **both** projects after setting env vars.

---

## 7. Local development

Copy [auth0-env.example](auth0-env.example) to `ui/.env.local` (gitignored) with your tenant values.

Until UI code uses Auth0, local dev continues with `make keys` and `demo-tokens.json`.

---

## 8. Smoke test (after implementation PR)

1. Open UI → **Log in** (Auth0).
2. User with read-only → search works, book/cancel denied in audit.
3. Admin user → book + cancel work; server + client audit correlate.
4. `GET /audit` without token → 401.
5. `curl /audit` with access token → JSON entries.

---

## Keycloak later

Same env semantics:

| Auth0 | Keycloak |
|-------|----------|
| `MCP_JWT_ISSUER` | `https://<kc>/realms/<realm>` |
| `MCP_JWT_JWKS_URL` | `<issuer>/.well-known/openid-configuration` → `jwks_uri` |
| `MCP_JWT_AUDIENCE` | client / audience configured in realm |

No enforcement code fork — dashboard and URLs only.

---

## Related

- [identity.md](identity.md) — Path A vs Path B, architecture
- [ROADMAP 0.3](ROADMAP.md#release-030--hardening--multi-server) — task list
