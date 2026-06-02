# Demo screenshots

Production UI captures referenced from the repo docs (not Auth0 dashboard walkthrough — see [auth0/README.md](../auth0/README.md)).

| File | Used in | What it shows |
|------|---------|---------------|
| `prod-ui-audit-success.png` | [README Live demo](../../README.md#live-demo) | Prod UI + audit panel after successful Auth0 + MCP flow |
| `auth0-access-token-jwtio.png` | [README Live demo](../../README.md#live-demo) | Decoded access token — admin `permissions` (`flights:*`) |
| `auth0-access-token-read-only-jwtio.png` | [README Live demo](../../README.md#live-demo), [auth0-setup](../auth0-setup.md) | Read-only user — `permissions`: `["flights:read"]` only |
| `prod-scope-deny-read-only.png` | (optional) README / auth0-setup | Prod UI — book blocked, client DENY before MCP |

Do **not** commit secrets (tokens, full `.env.local`).
