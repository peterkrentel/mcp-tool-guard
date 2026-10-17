#!/usr/bin/env bash
# One-time setup for the k3d ephemeral CI workflow (.github/workflows/k3d-ephemeral-entra.yml).
# Creates a CI-only Entra app that can create/delete a temporary operator user, then loads
# every GitHub secret the workflow needs. Secrets go straight to `gh secret set` and are never printed.
#
# Prerequisites: `az login` as an admin of the SAME tenant as scripts/dev.env, `gh auth login`,
# and scripts/entra-setup.sh already run (reads its ENTRA_* values from scripts/dev.env).
#
# Why a separate app: the management app (ENTRA_CLIENT_*) is also used in prod and only holds
# Application.ReadWrite.OwnedBy. Creating users needs far broader Graph permissions, so those
# live on this CI-only app and its secret exists only in GitHub Actions.
set -euo pipefail

REPO="${REPO:-peterkrentel/mcp-tool-guard}"
CI_APP_NAME="${CI_APP_NAME:-mcp-tool-guard-ci}"
ENV_FILE="${ENV_FILE:-scripts/dev.env}"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
GRAPH="https://graph.microsoft.com/v1.0"

set -a; source "$ENV_FILE"; set +a
for v in ENTRA_TENANT_ID ENTRA_API_APP_ID ENTRA_CLIENT_ID ENTRA_CLIENT_SECRET; do
  [[ -n "${!v:-}" ]] || { echo "Missing $v in $ENV_FILE"; exit 1; }
done
[[ "$(az account show --query tenantId -o tsv)" == "$ENTRA_TENANT_ID" ]] \
  || { echo "az is logged into a different tenant than $ENV_FILE"; exit 1; }

retry() { local n=0; until "$@"; do n=$((n+1)); [[ $n -ge 8 ]] && return 1; echo "  (Graph consistency lag, retrying...)"; sleep 5; done; }

[[ -z "$(az ad app list --display-name "$CI_APP_NAME" --query '[0].appId' -o tsv)" ]] \
  || { echo "An app named '$CI_APP_NAME' already exists; delete it first (this script creates a fresh one with a new secret)."; exit 1; }

echo "== CI app registration =="
CI_APP_ID="$(az ad app create --display-name "$CI_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
az ad sp create --id "$CI_APP_ID" >/dev/null
CI_SP_ID="$(az ad sp show --id "$CI_APP_ID" --query id -o tsv)"
CI_SECRET="$(az ad app credential reset --id "$CI_APP_ID" --query password -o tsv)"

echo "== Graph application permissions (User.ReadWrite.All, AppRoleAssignment.ReadWrite.All, Application.Read.All) =="
GRAPH_SP_ID="$(az ad sp show --id "$GRAPH_APP_ID" --query id -o tsv)"
for ROLE_ID in 741f803b-c850-494e-b5df-cde7c675a1ca 06b708a9-e830-4db3-a914-8e69da51d44f 9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30; do
  az ad app permission add --id "$CI_APP_ID" --api "$GRAPH_APP_ID" --api-permissions "$ROLE_ID=Role" >/dev/null
  # `az ad app permission admin-consent` silently no-ops for application permissions; create the assignment directly.
  retry az rest --method POST --uri "$GRAPH/servicePrincipals/$CI_SP_ID/appRoleAssignments" \
    --headers "Content-Type=application/json" \
    --body "{\"principalId\": \"$CI_SP_ID\", \"resourceId\": \"$GRAPH_SP_ID\", \"appRoleId\": \"$ROLE_ID\"}" >/dev/null
done

echo "== Delegated access_as_user on the API (lets the temporary user log in through this app) =="
API_SP_ID="$(az ad sp show --id "$ENTRA_API_APP_ID" --query id -o tsv)"
SCOPE_ID="$(az ad app show --id "$ENTRA_API_APP_ID" --query "api.oauth2PermissionScopes[?value=='access_as_user'].id | [0]" -o tsv)"
az ad app permission add --id "$CI_APP_ID" --api "$ENTRA_API_APP_ID" --api-permissions "$SCOPE_ID=Scope" >/dev/null
retry az rest --method POST --uri "$GRAPH/oauth2PermissionGrants" \
  --headers "Content-Type=application/json" \
  --body "{\"clientId\": \"$CI_SP_ID\", \"consentType\": \"AllPrincipals\", \"resourceId\": \"$API_SP_ID\", \"scope\": \"access_as_user\"}" >/dev/null

USER_DOMAIN="$(az rest --method GET --uri "$GRAPH/organization" --query "value[0].verifiedDomains[?isInitial].name | [0]" -o tsv)"

SECURITY_DEFAULTS="$(az rest --method GET --uri "$GRAPH/policies/identitySecurityDefaultsEnforcementPolicy" --query isEnabled -o tsv 2>/dev/null || echo unknown)"
if [[ "$SECURITY_DEFAULTS" != "false" ]]; then
  echo ""
  echo "WARNING: Entra security defaults are '$SECURITY_DEFAULTS' (true = on). With them on, the temporary CI user is"
  echo "forced through MFA and the password login CI relies on will fail. Turn them off for this tenant:"
  echo "  Entra admin center > Overview > Properties > Manage security defaults > Disabled."
fi

echo "== Setting GitHub secrets on $REPO =="
set_secret() { printf '%s' "$2" | gh secret set "$1" -R "$REPO" >/dev/null && echo "  set $1"; }
set_secret ENTRA_TENANT_ID "$ENTRA_TENANT_ID"
set_secret ENTRA_API_APP_ID "$ENTRA_API_APP_ID"
set_secret ENTRA_CLIENT_ID "$ENTRA_CLIENT_ID"
set_secret ENTRA_CLIENT_SECRET "$ENTRA_CLIENT_SECRET"
set_secret ENTRA_CI_CLIENT_ID "$CI_APP_ID"
set_secret ENTRA_CI_CLIENT_SECRET "$CI_SECRET"
set_secret ENTRA_CI_USER_DOMAIN "$USER_DOMAIN"

echo ""
echo "Done. Re-run the k3d-ephemeral-entra workflow."
