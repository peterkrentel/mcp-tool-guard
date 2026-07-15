# Grafana dashboards (as code)

Use this directory as the canonical source for dashboard definitions used by MCP Tool Guard observability.

## Layout

- `dashboards/grafana/mcp-tool-guard-proxy.dashboard.json`
  - Canonical dashboard JSON committed and reviewed in PRs.
- `dashboards/grafana/exports/`
  - Optional raw UI exports for traceability.

## Suggested workflow

1. Export dashboard JSON from Grafana.
2. Keep a canonical file named `mcp-tool-guard-proxy.dashboard.json` at this folder root.
3. Optionally keep the untouched raw export in `exports/` with a timestamped filename.
4. Commit dashboard changes with docs/changelog updates when query logic changes.

## Notes

- Prefer preserving the panel query logic exactly in the canonical file.
- Avoid relying only on UI-saved state; review JSON diffs in PRs.