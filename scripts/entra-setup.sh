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

echo "== Expose an API + define App Roles matching existing scope strings =="
az ad app update --id "$API_APP_ID" --identifier-uris "api://$API_APP_ID"

# App Roles: allowedMemberTypes "Application" makes these assignable to
# service principals (M2M agents), not just interactive users. Extend this
# list to match gateway/config.yaml's required_scope values as new tools/
# servers are added.
ROLE_JSON=$(cat <<EOF
[
  {"allowedMemberTypes": ["Application"], "displayName": "flights:read", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:read"},
  {"allowedMemberTypes": ["Application"], "displayName": "flights:write", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:write"},
  {"allowedMemberTypes": ["Application"], "displayName": "flights:delete", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "flights:delete"},
  {"allowedMemberTypes": ["Application"], "displayName": "repo:read", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "repo:read"},
  {"allowedMemberTypes": ["Application"], "displayName": "repo:write", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "repo:write"},
  {"allowedMemberTypes": ["User"], "displayName": "gateway:admin", "id": "$(python3 -c 'import uuid; print(uuid.uuid4())')", "isEnabled": true, "value": "gateway:admin"}
]
EOF
)
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$(az ad app show --id "$API_APP_ID" --query id -o tsv)" \
  --headers "Content-Type=application/json" \
  --body "{\"appRoles\": $ROLE_JSON}"

echo "== Management app (Graph API calls: create/delete M2M agents) =="
MGMT_APP_ID="$(az ad app create --display-name "$MGMT_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
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
echo "VITE_ENTRA_CLIENT_ID=$SPA_APP_ID"
echo "VITE_ENTRA_TENANT_ID=$TENANT_ID"
echo "VITE_ENTRA_API_APP_ID=$API_APP_ID"

echo ""
echo "Done. Copy the ENTRA_* lines above into scripts/dev.env (gateway) and"
echo "the VITE_ENTRA_* lines into ui/.env.local, alongside VITE_IDP_PROVIDER=entra."
