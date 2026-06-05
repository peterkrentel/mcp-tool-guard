# Auth0 walkthrough screenshots

PNG files referenced from [auth0-setup.md](../auth0-setup.md).

## Why chat attachments are not in the repo

Cursor saves chat images temporarily under:

```text
~/.cursor/projects/Users-peterkrentel-repos-mcp-tool-guard/assets/image-*.png
```

Those files are **ephemeral** — Auth0 screenshots from this session were referenced in chat but are **no longer on disk**, so they could not be copied into git automatically. Save PNGs **directly** into this folder (see below).

## How to add them (pick one)

**Option A — Re-screenshot Auth0** while following [auth0-setup.md](../auth0-setup.md), save with the filenames below.

**Option B — From Cursor chat** (if the image still displays): open the message → save/export the image → rename to match the table → drop here.

**Option C — One drag-and-drop folder**

```text
docs/images/auth0/
```

Then commit:

```bash
git add docs/images/auth0/*.png
git commit -m "Add Auth0 setup screenshots"
```

Do **not** commit secrets (tokens, full `.env.local`).

## Filename guide

| File | What to capture |
|------|-----------------|
| `01-tenant-selector.png` | Auth0 top-left tenant menu (tenant name + region) |
| `02-api-permissions-tab.png` | API → **Permissions**: `flights:*` (+ `docs:*` for multi-server) |
| `03-api-rbac-settings.png` | API → **Settings** → RBAC: both toggles **ON** |
| `04-api-application-access.png` | API → **Application Access**: SPA user-delegated (3/3 or 6/6 permissions) |
| `05-spa-api-access.png` | SPA → **API Access**: `api-for-mcp-tool-guard` authorized |
| `06-user-permissions.png` | User → **Permissions**: direct `flights:*` |
| `07-spa-callback-urls.png` | SPA → **Settings**: Callback / Logout / Web Origins |
| `08-localstorage-access-token.png` | DevTools → Local Storage row with `https://mcp-tool-guard` |
| `09-local-flight-env.png` | Terminal: `export MCP_JWT_*` + `make flight` on :8000 |
| `10-local-ui-signed-in.png` | UI signed in + tool allow in audit |

## Chat UUID → filename (this session)

If you still have files under `~/.cursor/projects/.../assets/`, you can rename/copy:

| Cursor asset (if present) | Save as |
|---------------------------|---------|
| `image-485a02c4-….png` | `01-tenant-selector.png` |
| `image-fd4dd859-….png` | `02-api-permissions-tab.png` |
| `image-c5e4bdf6-….png` | `03-api-rbac-settings.png` |
| `image-b2d17283-….png` | `04-api-application-access.png` |
| `image-6d005831-….png` | `05-spa-api-access.png` |
| `image-5b0c2218-….png` | `06-user-permissions.png` |
| `image-7328d709-….png` | Authorized Applications (optional extra) |
| `image-366e5b31-….png` | `08-localstorage-access-token.png` |
| `image-39b58e57-….png` | `09-local-flight-env.png` |
| `image-537ad989-….png` | deny before fix (optional troubleshooting) |
| `image-a1753ebd-….png` | local UI with Sign in (optional) |

After files exist here, GitHub renders them in [auth0-setup.md](../auth0-setup.md).
