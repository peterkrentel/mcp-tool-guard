# Next steps (post–0.2.0)

**Navigation:** [Roadmap](ROADMAP.md) · [Release process](RELEASE.md) · [Vercel deploy](vercel-deploy.md) · [CONCEPT](CONCEPT.md)

This doc captures **what to do after 0.2.0** — release housekeeping, redeploy, and the **0.3.0** backlog from the security/architecture peer review. Task numbers match [ROADMAP → 0.3.0](ROADMAP.md#release-030--hardening--multi-server).

---

## Immediately after merging the 0.2.0 release PR

1. **Redeploy flight** on Vercel (`mcp-tool-guard-flight-server`) so CORS changes in `server.py` take effect. No new env vars required unless you override origins.
2. **Smoke test** from [live UI](https://mcp-tool-guard-ui.vercel.app/): Initialize → search → book → cancel with admin token. Confirm browser Network tab shows MCP and `/audit` without CORS errors.
3. **Tag on `main`** (maintainer):
   ```bash
   git checkout main && git pull
   git tag -a v0.2.0 -m "v0.2.0: Remote deploy and server-side JWT"
   git push origin v0.2.0
   ```
4. **GitHub Release** — paste the `## [0.2.0]` section from [CHANGELOG.md](../CHANGELOG.md).

Optional env on flight project:

| Variable | Purpose |
|----------|---------|
| `MCP_CORS_ORIGINS` | Comma-separated origins; set `*` to restore open CORS (not recommended on public deploy) |
| Default (unset) | `https://mcp-tool-guard-ui.vercel.app`, `http://localhost:5173`, `http://127.0.0.1:5173` |

---

## What 0.2.0 proved

- JWT scope enforcement on MCP `tools/call` (server authoritative; client pre-check + intent audit).
- Dual audit correlation via `trace_id` / `session_id`.
- Remote browser → HTTPS flight MCP on Vercel with demo tokens.

The **enforcement path** is production-capable. Gaps are **platform and ops** (audit persistence, `/audit` auth, identity lifecycle, proxy for third-party MCP).

---

## 0.3.0 — recommended order

### Phase A — Honest demo on Vercel (1–2 PRs)

| ROADMAP # | Work |
|-----------|------|
| 4 | Vercel KV (or Redis) for server audit append/read |
| 3 | UI message when `GET /audit` fails or returns empty after tool success |
| 1 | Protect `/audit` (Bearer same as MCP, or remove route from public deploy) |

### Phase B — Security hygiene (1 PR)

| ROADMAP # | Work |
|-----------|------|
| 2 | Guard disable: log error at startup if `MCP_GUARD_ENABLED=false` on public deploy |
| 5 | `iss` / `aud` env vars on PyJWT + `jose` verify |
| 7 | Cap middleware body size (e.g. 1–4 MB) |

### Phase C — Multi-server client (1–2 PRs)

| ROADMAP # | Work |
|-----------|------|
| 6 | Generate `guard-config.ts` + `guard_config.yaml` from `gateway/config.yaml` (or one canonical YAML) + CI test |
| 8 | Agent selects server alias; MCP client uses `servers.*.url` |
| 9 | Optional `servers/notes/` mock with its own guard |

**Not in 0.3:** Real Slack/GitHub MCP URLs without a **guard proxy** (ROADMAP Tier 2 #11). Client-only scoping is UX, not authoritative for third-party endpoints.

### Phase D — Production platform (Tier 2)

- IdP + short-lived tokens (replace 365-day demo JWTs in repo).
- Audit export to Loki/Datadog/OTel.
- HTTP **guard gateway** in front of arbitrary upstream MCP.
- Rate limiting.

---

## Known demo limitations (documented, not bugs)

| Topic | Detail |
|-------|--------|
| Server audit on Vercel | In-memory per instance until KV (0.3 #4); panel may be empty intermittently |
| `GET /audit` | No auth today (0.3 #1) |
| Policy in three files | Must stay aligned manually until 0.3 #6 |
| `initialize` / `tools/list` | Unguarded — tool surface enumerable |
| Demo tokens | 365-day JWTs in `ui/public/demo-tokens.json` — demo only |
| Client audit | Browser tab memory; not tamper-proof |
| External MCP | No shared server log unless traffic hits **your** guarded hop |

See [CONCEPT → Current limitations](CONCEPT.md#current-limitations-demo) and [CONCEPT → Demo vs production](CONCEPT.md#demo-vs-production).

---

## Client scoping for remote MCP

The SDK already supports multiple servers in `gateway/config.yaml` (`authorize(server, tool, …)`). The UI only wires `flight`. **0.3 #8** adds routing; **Tier 2 proxy** adds authoritative enforcement for vendors you do not control.

---

## Related

- [ROADMAP.md](ROADMAP.md) — task checklist
- [RELEASE.md](RELEASE.md) — versioning and tag workflow
- [vercel-deploy.md](vercel-deploy.md) — deploy and troubleshooting
