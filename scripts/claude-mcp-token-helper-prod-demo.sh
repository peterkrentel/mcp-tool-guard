#!/usr/bin/env bash
# One-off headersHelper for demoing against the deployed Render proxy with a
# pre-vended token (no clientSecret available — /agents.html's "Create agent"
# flow never surfaces it, see BL-048). Not a general pattern: a static token
# has no refresh, it's just good until its own exp claim. Demo-only.
set -euo pipefail

if [ -z "${MCP_PROD_STATIC_TOKEN:-}" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$script_dir/dev.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$script_dir/dev.env"
    set +a
  fi
fi

: "${MCP_PROD_STATIC_TOKEN:?MCP_PROD_STATIC_TOKEN is required}"

node -e '
  const token = process.argv[1];
  const traceId = `cc-${require("crypto").randomUUID()}`;
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}`, "X-Trace-Id": traceId, "X-Wait-For-Approval": "true" }));
' "$MCP_PROD_STATIC_TOKEN"
