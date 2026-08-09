#!/usr/bin/env bash
# One-time Entra tenant setup for mcp-tool-guard, scripted via az CLI.
# Prerequisite (manual, portal-only): an Entra tenant must already exist
# (Azure Portal -> Microsoft Entra ID -> Manage tenants -> + Create, ~5 min).
# Run `az login` against that tenant before running this script.
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

echo "== Expose an API + define App Roles matching existing scope strings =="
az ad app update --id "$API_APP_ID" --identifier-uris "api://$API_APP_ID"

# App Roles: allowedMemberTypes "Application" makes these assignable to
# service principals (M2M agents), not just interactive users. Extend this
# list to match gateway/config.yaml's required_scope values as new tools/
# servers are added.
#
# Each role id is generated into its own standalone variable *before* the
# heredoc below is built. A plain `VAR=$(cmd)` assignment correctly trips
# `set -e` if `uuidgen` is missing/fails; a command substitution nested
# inside a heredoc that itself feeds a `$(...)` does not propagate failure
# the same way, so this order matters, not just the uuidgen swap.
ROLE_ID_FLIGHTS_READ="$(uuidgen)"
ROLE_ID_FLIGHTS_WRITE="$(uuidgen)"
ROLE_ID_FLIGHTS_DELETE="$(uuidgen)"
ROLE_ID_REPO_READ="$(uuidgen)"
ROLE_ID_REPO_WRITE="$(uuidgen)"
ROLE_ID_GATEWAY_ADMIN="$(uuidgen)"
ROLE_JSON=$(cat <<EOF
[
  {"allowedMemberTypes": ["Application"], "description": "Read access to flight search and booking details", "displayName": "flights:read", "id": "$ROLE_ID_FLIGHTS_READ", "isEnabled": true, "value": "flights:read"},
  {"allowedMemberTypes": ["Application"], "description": "Create and modify flight bookings, check-ins, seats, and baggage", "displayName": "flights:write", "id": "$ROLE_ID_FLIGHTS_WRITE", "isEnabled": true, "value": "flights:write"},
  {"allowedMemberTypes": ["Application"], "description": "Cancel existing flight bookings", "displayName": "flights:delete", "id": "$ROLE_ID_FLIGHTS_DELETE", "isEnabled": true, "value": "flights:delete"},
  {"allowedMemberTypes": ["Application"], "description": "Read access to repository files, commits, issues, and pull requests", "displayName": "repo:read", "id": "$ROLE_ID_REPO_READ", "isEnabled": true, "value": "repo:read"},
  {"allowedMemberTypes": ["Application"], "description": "Create and modify repository files, branches, issues, and pull requests", "displayName": "repo:write", "id": "$ROLE_ID_REPO_WRITE", "isEnabled": true, "value": "repo:write"},
  {"allowedMemberTypes": ["User"], "description": "Manage gateway control-plane resources: registered MCP servers, M2M agents, and pending-approval decisions", "displayName": "gateway:admin", "id": "$ROLE_ID_GATEWAY_ADMIN", "isEnabled": true, "value": "gateway:admin"}
]
EOF
)
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$(az ad app show --id "$API_APP_ID" --query id -o tsv)" \
  --headers "Content-Type=application/json" \
  --body "{\"appRoles\": $ROLE_JSON}"

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
SPA_APP_ID="$(az ad app create --display-name "$SPA_APP_NAME" \
  --spa-redirect-uris "http://localhost:5173" \
  --query appId -o tsv)"
az ad sp create --id "$SPA_APP_ID" >/dev/null
echo "VITE_ENTRA_CLIENT_ID=$SPA_APP_ID"
echo "VITE_ENTRA_TENANT_ID=$TENANT_ID"
echo "VITE_ENTRA_API_APP_ID=$API_APP_ID"

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
