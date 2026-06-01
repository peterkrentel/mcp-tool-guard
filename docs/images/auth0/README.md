# Auth0 walkthrough screenshots

PNG files referenced from [auth0-setup.md](../../auth0-setup.md). Capture from your Auth0 tenant and local demo; **do not commit secrets** (tokens, `.env.local` values).

| File | What to capture |
|------|-----------------|
| `01-tenant-selector.png` | Auth0 top-left tenant menu showing tenant name + region (e.g. `dev-….us.auth0.com`) |
| `02-api-permissions-tab.png` | API → **Permissions** tab: `flights:read`, `flights:write`, `flights:delete` |
| `03-api-rbac-settings.png` | API → **Settings** → RBAC: both toggles **ON** |
| `04-api-application-access.png` | API → **Application Access**: SPA **Authorized**, **3/3 permissions** (user-delegated) |
| `05-spa-api-access.png` | SPA → **API Access**: `api-for-mcp-tool-guard` **3/3** user-delegated |
| `06-user-permissions.png` | User → **Permissions**: direct `flights:*` on the API |
| `07-spa-callback-urls.png` | SPA → **Settings**: Callback / Logout / Web Origins include `http://localhost:5173` |
| `08-localstorage-access-token.png` | Browser DevTools → Local Storage → row containing `https://mcp-tool-guard` |
| `09-local-flight-env.png` | Terminal: `export MCP_JWT_*` + `make flight` running on :8000 |
| `10-local-ui-signed-in.png` | UI signed in + successful tool call / audit allow row |

Drop PNGs here with these names; GitHub will render them in the setup doc.
