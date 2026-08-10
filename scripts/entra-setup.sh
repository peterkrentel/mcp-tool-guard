#!/usr/bin/env bash
# One-time Entra tenant setup for mcp-tool-guard, scripted via az CLI.
# Prerequisite (manual, portal-only): an Entra tenant must already exist
# (Azure Portal -> Microsoft Entra ID -> Manage tenants -> + Create, ~5 min).
# Run `az login` against that tenant before running this script.
#
# Scope: pure tenant bootstrap only — protected API app + SP, management app
# + SP + Graph consent, SPA app + redirects + delegated scope + consent, and
# the single gateway:admin App Role. Per-MCP-server scopes (flights:*,
# repo:*, slack:*, ...) are NOT declared here; gateway/entra-mgmt.ts
# auto-provisions those on demand the first time an agent requests one.
set -euo pipefail

API_APP_NAME="${API_APP_NAME:-mcp-tool-guard-api}"
MGMT_APP_NAME="${MGMT_APP_NAME:-mcp-tool-guard-mgmt}"
SPA_APP_NAME="${SPA_APP_NAME:-mcp-tool-guard-spa}"

echo "== Tenant =="
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "ENTRA_TENANT_ID=$TENANT_ID"

echo "== Protected API app registration =="
API_APP_ID="$(az ad app create --display-name "$API_APP_NAME" --query appId -o tsv)"
echo "ENTRA_API_APP_ID=$API_APP_ID"
az ad sp create --id "$API_APP_ID" >/dev/null

echo "== Expose an API + define the gateway:admin App Role =="
az ad app update --id "$API_APP_ID" --identifier-uris "api://$API_APP_ID"

# App Roles: this bootstrap declares exactly one App Role, gateway:admin — a
# human-operator control-plane permission (manage registered MCP servers,
# M2M agents, and pending-approval decisions), assigned to users via the
# Entra portal's "Users and groups" tab, a manual action with no
# corresponding API call anywhere in this codebase. It is the one role that
# can never be auto-provisioned via an agent-creation call (it stays
# ["User"]-only by design and is never granted to an M2M agent), so it has no
# other place to get declared and belongs here in tenant bootstrap.
#
# Per-MCP-server scopes (flights:*, repo:*, slack:*, and any future vendor
# server registered at runtime via POST /servers) are deliberately NOT
# declared here. gateway/entra-mgmt.ts's createEntraAgent() auto-provisions
# any missing App Role on demand (Graph PATCH .../applications/{id}
# appending to appRoles, dual-assignable ["User", "Application"]) the first
# time an agent requests that scope — matching how Auth0 permissions were
# always added incrementally per-server in this project, never all upfront.
#
# The role id is generated into its own standalone variable *before* the
# heredoc below is built. A plain `VAR=$(cmd)` assignment correctly trips
# `set -e` if `uuidgen` is missing/fails; a command substitution nested
# inside a heredoc that itself feeds a `$(...)` does not propagate failure
# the same way, so this order matters, not just the uuidgen swap.
ROLE_ID_GATEWAY_ADMIN="$(uuidgen)"
ROLE_JSON=$(cat <<EOF
[
  {"allowedMemberTypes": ["User"], "description": "Manage gateway control-plane resources: registered MCP servers, M2M agents, and pending-approval decisions", "displayName": "gateway:admin", "id": "$ROLE_ID_GATEWAY_ADMIN", "isEnabled": true, "value": "gateway:admin"}
]
EOF
)

# Delegated scope (oauth2PermissionScopes) so the SPA can request an
# interactive (delegated) access token. App Roles above are Application-type
# permissions (M2M/client_credentials) and are NOT sufficient on their own —
# a delegated `/.default` request from a public client requires at least one
# statically pre-configured delegated permission for the resource, or Entra
# rejects sign-in with AADSTS650057. "type": "Admin" makes this
# admin-consent-required, matching how Microsoft's own SPA + protected-API
# quickstarts expose a single delegated scope for this purpose.
SCOPE_ID_ACCESS_AS_USER="$(uuidgen)"
API_SCOPE_JSON=$(cat <<EOF
[
  {"adminConsentDescription": "Allow the app to access mcp-tool-guard-api on behalf of the signed-in user", "adminConsentDisplayName": "Access mcp-tool-guard-api as the signed-in user", "id": "$SCOPE_ID_ACCESS_AS_USER", "isEnabled": true, "type": "Admin", "userConsentDescription": "Allow the app to access mcp-tool-guard-api on your behalf", "userConsentDisplayName": "Access mcp-tool-guard-api", "value": "access_as_user"}
]
EOF
)

API_OBJECT_ID="$(az ad app show --id "$API_APP_ID" --query id -o tsv)"
# api.requestedAccessTokenVersion: 2 makes Entra mint v2 access tokens for
# this API (bare-GUID `aud`, `iss` .../v2.0) instead of the v1 default —
# ui/src/auth.ts's jwtTrustFromEntra() and docs/entra-setup.md assume v2
# throughout, so this must be set explicitly.
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$API_OBJECT_ID" \
  --headers "Content-Type=application/json" \
  --body "{\"appRoles\": $ROLE_JSON, \"api\": {\"requestedAccessTokenVersion\": 2, \"oauth2PermissionScopes\": $API_SCOPE_JSON}}"

echo "== Management app (Graph API calls: create/delete M2M agents) =="
MGMT_APP_ID="$(az ad app create --display-name "$MGMT_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
# A service principal must exist before permission admin-consent or the later
# client_credentials token flow will work — az ad app create only creates the
# application object, not the service principal (unlike the portal UI).
az ad sp create --id "$MGMT_APP_ID" >/dev/null
MGMT_SECRET="$(az ad app credential reset --id "$MGMT_APP_ID" --query password -o tsv)"
echo "ENTRA_CLIENT_ID=$MGMT_APP_ID"
echo "ENTRA_CLIENT_SECRET=$MGMT_SECRET"

echo "== Granting management app Graph Application.ReadWrite.OwnedBy + admin consent =="
az ad app permission add --id "$MGMT_APP_ID" \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions 18a4783c-866b-4cc7-a460-3d5e5662c884=Role
az ad app permission admin-consent --id "$MGMT_APP_ID"

echo "== SPA app registration (human browser login) =="
# Redirect URIs must exactly match window.location.origin + pathname from
# ui/src/auth.ts's getMsalClient() at the actual page the user signed in
# from — Entra does exact-match, not prefix-match, on redirect URIs.
# getMsalClient() is invoked from every page that can initiate Entra sign-in,
# not just /agents.html: the landing page (ui/src/landing-main.ts, path "/"),
# /agents.html, /claude-ops.html, and /flight-demo.html were all migrated to
# the generic login()/handleAuthRedirect() dispatchers in this same branch.
# Each one needs its own exact-match entry, local + prod, or sign-in fails
# with AADSTS50011 on any page other than whichever one was registered —
# this is the same bug class already fixed for Auth0's "Allowed Callback
# URLs" in this project's history (see docs/auth0-setup.md), just missed
# here on the first pass since only /agents.html was registered originally.
#
# `az ad app create` has no `--spa-redirect-uris` flag (confirmed against a
# live install of az CLI 2.75.0 — only --web-redirect-uris and
# --public-client-redirect-uris exist as create-time convenience flags, and
# neither is the right application platform for a SPA). The `spa` redirect
# URI collection is a property of the Graph application resource itself, set
# via a direct PATCH — the same pattern already used above for `appRoles`
# and `api.requestedAccessTokenVersion` on the API app.
SPA_APP_ID="$(az ad app create --display-name "$SPA_APP_NAME" --query appId -o tsv)"
SPA_OBJECT_ID="$(az ad app show --id "$SPA_APP_ID" --query id -o tsv)"
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$SPA_OBJECT_ID" \
  --headers "Content-Type=application/json" \
  --body "{\"spa\": {\"redirectUris\": [\"http://localhost:5173/\", \"http://localhost:5173/agents.html\", \"http://localhost:5173/claude-ops.html\", \"http://localhost:5173/flight-demo.html\", \"https://mcp-tool-guard-ui.vercel.app/\", \"https://mcp-tool-guard-ui.vercel.app/agents.html\", \"https://mcp-tool-guard-ui.vercel.app/claude-ops.html\", \"https://mcp-tool-guard-ui.vercel.app/flight-demo.html\"]}}"
az ad sp create --id "$SPA_APP_ID" >/dev/null
echo "VITE_ENTRA_CLIENT_ID=$SPA_APP_ID"
echo "VITE_ENTRA_TENANT_ID=$TENANT_ID"
echo "VITE_ENTRA_API_APP_ID=$API_APP_ID"

echo "== Granting SPA delegated permission on the API + admin consent =="
# Delegated (Scope) grant, not Application (Role) — the SPA's loginWithEntra()
# uses an interactive delegated flow, so it needs this rather than an App Role.
az ad app permission add --id "$SPA_APP_ID" \
  --api "$API_APP_ID" \
  --api-permissions "$SCOPE_ID_ACCESS_AS_USER=Scope"
# admin-consent below drives the Graph API directly (creates the
# oauth2PermissionGrant); it does not open an interactive browser/portal flow.
# It does require the az-logged-in principal to hold a role capable of
# granting admin consent (Global Administrator, Privileged Role Administrator,
# or Application Administrator with the admin-consent-workflow permission) —
# if that's missing, this step fails and admin consent must be granted once
# manually in the portal instead (API app -> Expose an API / API permissions
# on the SPA app -> Grant admin consent). Also: `az` docs note permission
# writes can take a few seconds to replicate through Graph before
# admin-consent will find them — retry once on an immediate "permission ...
# not found" error before assuming a real failure.
az ad app permission admin-consent --id "$SPA_APP_ID"

echo ""
echo "== Summary: copy these into scripts/dev.env (gateway) and ui/.env.local (UI) =="
echo "ENTRA_TENANT_ID=$TENANT_ID"
echo "ENTRA_API_APP_ID=$API_APP_ID"
echo "ENTRA_CLIENT_ID=$MGMT_APP_ID"
echo "ENTRA_CLIENT_SECRET=$MGMT_SECRET"
echo "VITE_ENTRA_CLIENT_ID=$SPA_APP_ID"
echo "VITE_ENTRA_TENANT_ID=$TENANT_ID"
echo "VITE_ENTRA_API_APP_ID=$API_APP_ID"

echo ""
echo "Done. Copy the ENTRA_* lines above into scripts/dev.env (gateway) and"
echo "the VITE_ENTRA_* lines into ui/.env.local, alongside VITE_IDP_PROVIDER=entra."
