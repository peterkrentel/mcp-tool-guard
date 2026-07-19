# BL-037: Claude Code Guard Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — see Execution Note below) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Claude Code (this CLI) as a real MCP client to the local guard proxy's `github` server, and produce a doc + a Grafana dashboard describing what actually happens — not what should theoretically happen.

**Architecture:** A new `scripts/claude-mcp-token-helper.sh` vends a client_credentials JWT from a local `repo:read`-only M2M agent and injects it (plus a `cc-`-prefixed session trace id) as Claude Code's `headersHelper`. Claude Code is registered via `claude mcp add-json` (local scope, no repo file needed) pointed at `http://localhost:8787/github/mcp`. Three scenarios get smoke-tested for real and the observed results get written into `docs/claude-code-integration.md`.

**Tech Stack:** Bash + `node -e` JSON assertions (matching this repo's existing `scripts/smoke-*.sh` convention — no new test framework), `claude` CLI, existing gateway/proxy code (zero changes).

## Global Constraints

- No gateway/proxy TypeScript code changes — this plan touches only `scripts/`, `docs/`, and `dashboards/`.
- `servers/flight` is never the target (runs its own embedded guard, not representative) — `github` is the only target.
- The doc (`docs/claude-code-integration.md`) must describe **actually observed** behavior from running the steps in this plan, not assumed/theoretical behavior — do not write its content until the corresponding smoke-test task has produced real output to transcribe.
- `dashboards/grafana/mcp-tool-guard-proxy.dashboard.json` (the existing live Grafana Cloud export) is never edited — only a net-new file gets added.
- `local` scope for `claude mcp add`/`add-json` stores config in `~/.claude.json` (confirmed) — nothing MCP-config-related gets committed to this repo.

---

### Task 1: Local M2M agent + token-vending helper script

**Files:**
- Create: `scripts/claude-mcp-token-helper.sh`

**Interfaces:**
- Consumes: `POST /token` (existing, `gateway/proxy-routes-agents-token.ts` — body `{clientId, clientSecret}`, response `{token, expiresIn}` on success).
- Produces: a script that prints `{"Authorization": "Bearer <jwt>", "X-Trace-Id": "cc-<uuid>"}` to stdout — consumed by Task 2's `headersHelper` config.

- [ ] **Step 1: Start the local stack (if not already running)**

Run: `make dev` (in a separate terminal/background — needs `flight` on :8000, `proxy` on :8787). Confirm `GITHUB_MCP_TOKEN` is set in your `scripts/dev.env` (already documented as a prerequisite in `scripts/dev.env.example`).

Run: `curl -s http://localhost:8787/health`
Expected: JSON including `"servers":["flight","github"]` and `"idp_provider":"auth0"`.

- [ ] **Step 2: Create the local repo:read-only M2M agent**

`control_plane_auth` is `false` locally (no `MCP_JWT_ISSUER` gate needed for this call), so:

```bash
curl -s -X POST http://localhost:8787/agents \
  -H "Content-Type: application/json" \
  -d '{"name":"claude-code-local","serverId":"github","scopes":["repo:read"]}'
```

Expected: a JSON response including `clientId` and `clientSecret` fields. **Copy both values** — they're only shown once, matching this repo's existing agent-creation behavior (`gateway/proxy-routes-agents-token.ts`'s `POST /agents` handler).

- [ ] **Step 3: Write the helper script**

Create `scripts/claude-mcp-token-helper.sh`:

```bash
#!/usr/bin/env bash
# headersHelper for Claude Code (.mcp.json) — vends a fresh client_credentials
# token from a local M2M agent and tags the session with a cc-prefixed trace id
# so Claude-Code-originated traffic is filterable in the audit log and Grafana.
set -euo pipefail

: "${MCP_AGENT_CLIENT_ID:?MCP_AGENT_CLIENT_ID is required}"
: "${MCP_AGENT_CLIENT_SECRET:?MCP_AGENT_CLIENT_SECRET is required}"
PROXY_URL="${PROXY_URL:-http://localhost:8787}"

TOKEN="$(curl -sS -X POST "${PROXY_URL}/token" \
  -H "Content-Type: application/json" \
  -d "{\"clientId\":\"${MCP_AGENT_CLIENT_ID}\",\"clientSecret\":\"${MCP_AGENT_CLIENT_SECRET}\"}" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);if(!j.token){process.stderr.write(d);process.exit(1)}process.stdout.write(j.token)})')"

TRACE_ID="cc-$(node -e 'process.stdout.write(require("crypto").randomUUID())')"

node -e '
  const [token, traceId] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}`, "X-Trace-Id": traceId }));
' "$TOKEN" "$TRACE_ID"
```

Run: `chmod +x scripts/claude-mcp-token-helper.sh`

- [ ] **Step 4: Verify the script produces valid, correctly-shaped output (this task's test)**

```bash
export MCP_AGENT_CLIENT_ID="<clientId from Step 2>"
export MCP_AGENT_CLIENT_SECRET="<clientSecret from Step 2>"
./scripts/claude-mcp-token-helper.sh | node -e '
  let d="";
  process.stdin.on("data",c=>d+=c);
  process.stdin.on("end",()=>{
    const j = JSON.parse(d);
    if (!j.Authorization || !j.Authorization.startsWith("Bearer ")) throw new Error("missing/malformed Authorization");
    if (!j["X-Trace-Id"] || !j["X-Trace-Id"].startsWith("cc-")) throw new Error("missing/malformed X-Trace-Id");
    console.log("PASS:", JSON.stringify(j));
  });
'
```

Expected: `PASS: {"Authorization":"Bearer eyJ...","X-Trace-Id":"cc-..."}` — no thrown error.

Run it a second time and confirm the `X-Trace-Id` value is **different** each invocation (fresh UUID per run — this is the behavior the spec's "session-level, not per-call" limitation depends on being understood correctly later in the doc).

- [ ] **Step 5: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`, one line: "**Claude Code MCP auth helper script** — `scripts/claude-mcp-token-helper.sh`, a `headersHelper` for Claude Code's `.mcp.json` that vends a client_credentials token from a local M2M agent and tags the session with a `cc`-prefixed trace id (part of BL-037)." The repo's pre-commit hook requires this in the same commit.

```bash
git add scripts/claude-mcp-token-helper.sh CHANGELOG.md
git commit -m "feat(scripts): add Claude Code MCP token-vending headersHelper"
```

---

### Task 2: Wire up Claude Code and verify the connection

**Files:** none created/modified — this task configures the live `claude` CLI session (stored in `~/.claude.json`, outside this repo).

**Interfaces:**
- Consumes: `scripts/claude-mcp-token-helper.sh` from Task 1.
- Produces: a connected `github-guarded` MCP server entry, consumed by Task 3's smoke tests.

- [ ] **Step 1: Register the server**

```bash
cd /Users/peterkrentel/repos/mcp-tool-guard
claude mcp add-json github-guarded '{"type":"http","url":"http://localhost:8787/github/mcp","headersHelper":"./scripts/claude-mcp-token-helper.sh"}' --scope local
```

Expected: `Added http MCP server github-guarded to local config`

- [ ] **Step 2: Verify it connects**

Run: `claude mcp get github-guarded`
Expected: `Status: ✔ Connected` (not "Failed to connect" — if it fails, confirm `make dev` is still running and Step 1/Task 1 env vars are exported in the shell `claude` inherits from).

- [ ] **Step 3: No commit for this task** (nothing in the repo changed — proceed directly to Task 3).

---

### Task 3: Smoke-test the three scenarios and capture real output

**Files:** none created yet — this task's output (the actual terminal transcripts) becomes Task 4's source material. Copy the literal output you see into your own scratch notes as you go; Task 4 transcribes it into the doc.

**Interfaces:**
- Consumes: the connected `github-guarded` server from Task 2.
- Produces: three observed-behavior transcripts, consumed by Task 4.

- [ ] **Step 1: Read-allow — `get_file_contents` (`repo:read`)**

In this Claude Code session (or a fresh one with `github-guarded` connected), ask the assistant to call the guarded server's `get_file_contents` tool against this repo's own `README.md` (owner `peterkrentel`, repo `mcp-tool-guard`, path `README.md`).

Record: (a) does Claude Code's own local tool-approval prompt appear first, before any network activity? (b) does the call succeed and return real README content? (c) run `curl -s -H "Authorization: Bearer $(node -e 'console.log(require(\"./ui/public/demo-tokens.json\").admin)')" http://localhost:8787/audit | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.entries.slice(-3),null,2))})'` — confirm a `source:"proxy"` entry for `get_file_contents` with `decision:"allow"` and a `trace_id` starting with `cc-`.

- [ ] **Step 2: Write-deny — `create_or_update_file` (`repo:write`), approval queue off**

Confirm `MCP_APPROVAL_QUEUE` is unset or `false` in `scripts/dev.env` for this step. Ask the assistant to call `create_or_update_file` on the same repo (any path/content — this will be denied before reaching GitHub, nothing is actually written).

Record: the exact error/response text Claude Code shows for this call. Re-check `/audit` (same curl as Step 1) — confirm a `decision:"deny"` entry with `reason` matching `Missing required scope 'repo:write'`.

- [ ] **Step 3: Write-pending — same call, approval queue on**

Set `MCP_APPROVAL_QUEUE=true` in `scripts/dev.env`, restart `make dev`. Repeat the `create_or_update_file` call.

Record: the exact response/behavior Claude Code shows for a `202`/`{"result":{"status":"pending",...}}` JSON-RPC response — does it render as a tool result the model can see and comment on, or does it appear as an error to the harness? Re-check `/audit` — confirm a `decision:"pending"` entry.

- [ ] **Step 4: No commit for this task** (observation only — proceed to Task 4 with your three recorded transcripts).

---

### Task 4: Write `docs/claude-code-integration.md`

**Files:**
- Create: `docs/claude-code-integration.md`

**Interfaces:**
- Consumes: Task 3's three recorded transcripts (do not write this doc from assumption — transcribe what Task 3 actually showed).
- Produces: the doc deliverable itself — nothing downstream consumes it programmatically.

- [ ] **Step 1: Write the doc**

Follow this repo's existing doc convention (`docs/auth0-setup.md` style — Navigation line, Mermaid diagram, numbered setup, verification checklist, troubleshooting table). Structure:

```markdown
# Claude Code integration (BL-037)

**Navigation:** [Guard proxy](guard-proxy.md) · [Architecture](ARCHITECTURE.md)

Connect Claude Code as a real MCP client to the guard proxy, so its own tool calls are scope-enforced and audited — same mechanism the browser UI uses, exercised against a second, independent MCP client for the first time.

## Architecture

[transcribe the diagram from docs/superpowers/specs/2026-07-19-claude-code-guard-integration-design.md's Architecture section, converted to a mermaid flowchart matching this repo's doc convention]

## Setup

[transcribe Task 1 + Task 2's exact steps/commands]

## What actually happens

### Read-allow
[transcribe Task 3 Step 1's actual observed output — prompt behavior, tool result, audit entry]

### Write-deny
[transcribe Task 3 Step 2's actual observed output]

### Write-pending
[transcribe Task 3 Step 3's actual observed output — be explicit about how Claude Code rendered the 202/pending shape]

## headersHelper limitations

Documents the real mechanism (script path, JSON-on-stdout, 10s timeout, runs at connect/reconnect) and the known mid-session refresh gap: [anthropics/claude-code#53267](https://github.com/anthropics/claude-code/issues/53267) — a vended token can go stale mid-session with recovery only via the v2.1.193 retry-once-on-401 behavior or a manual reconnect.

## Observability

Claude Code's calls appear in `GET /audit` as `source:"proxy"` only (never `source:"agent"` — that's the browser SDK's own convention). The helper's `cc`-prefixed `X-Trace-Id` groups one Claude Code session's calls together but does not distinguish individual tool calls within that session (see [Grafana dashboard](../dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json)).

## Generalizing to other harnesses

The underlying pattern (guard proxy + Bearer JWT via a refreshable-header mechanism) is harness-agnostic by construction — any MCP client supporting remote HTTP servers with a custom auth header (OpenCode, VS Code's native MCP support, etc.) should work the same way; only the config syntax differs. Not documented here — out of scope for this task.
```

- [ ] **Step 2: Self-review against the spec**

Re-read `docs/superpowers/specs/2026-07-19-claude-code-guard-integration-design.md` and confirm every requirement in its "Components" section 3 has corresponding real (not placeholder) content in the new doc. Fix any gaps inline.

- [ ] **Step 3: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`: "**Claude Code integration guide (BL-037)** — `docs/claude-code-integration.md` documents actually-observed read-allow/write-deny/write-pending behavior connecting Claude Code to the guard proxy, plus the `headersHelper` mid-session refresh limitation ([anthropics/claude-code#53267](https://github.com/anthropics/claude-code/issues/53267)) and the `source:"proxy"`-only / session-level-trace-id observability gap versus the browser client."

```bash
git add docs/claude-code-integration.md CHANGELOG.md
git commit -m "docs(bl-037): add Claude Code integration guide"
```

---

### Task 5: Grafana dashboard (manual — requires live Grafana Cloud access)

**This task cannot be automated by a subagent** — it requires interactively building a panel in the user's live Grafana Cloud UI, which no agent in this session has credentials/access to. This is a task for the human to perform, with the exact query provided below.

**Files:**
- Create: `dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json` (exported from the UI, not hand-authored — per `dashboards/grafana/README.md`'s existing convention)

- [ ] **Step 1 (human): Build the dashboard in Grafana Cloud**

In your Grafana Cloud instance, create a new dashboard with panels filtered on the `mcp.upstream.forward` span's `mcp.trace_id` attribute matching `^cc-` (Tempo TraceQL: `{ span.mcp.trace_id =~ "cc-.*" }`, or the equivalent filter in Explore). Suggested panels, mirroring the existing `mcp-tool-guard-proxy.dashboard.json`'s structure: request count over time, decision breakdown (allow/deny/pending) via `mcp.decision`, latency via `latency_ms`, and a raw trace list.

- [ ] **Step 2 (human): Export and commit**

Export the dashboard JSON, save as `dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json` (do not touch the existing `mcp-tool-guard-proxy.dashboard.json`).

- [ ] **Step 3: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`: "**Claude Code client Grafana dashboard (BL-037)** — `dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json`, a net-new dashboard (existing `mcp-tool-guard-proxy.dashboard.json` unchanged) filtered on `mcp.trace_id =~ \"cc-.*\"` to visualize Claude-Code-originated request count, decision breakdown, and latency."

```bash
git add dashboards/grafana/mcp-tool-guard-claude-code-client.dashboard.json CHANGELOG.md
git commit -m "docs(dashboards): add Claude Code client Grafana dashboard"
```

---

### Task 6: Backlog closeout

**Files:**
- Modify: `backlog.md`

- [ ] **Step 1:** Remove the `BL-037` entry from `backlog.md`'s `## P0 (next)` section (completed items move to `CHANGELOG.md` and get removed here, per the file's own rule).

- [ ] **Step 2:** Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added` summarizing the whole feature (script + doc + dashboard), similar in shape to BL-020's Task 5 closeout entry in this repo's history.

- [ ] **Step 3: Commit**

```bash
git add backlog.md CHANGELOG.md
git commit -m "docs(backlog): close out BL-037"
```

- [ ] **Step 4:** Push and report the compare URL — per this repo's workflow rules, do not merge or open the PR via `gh`.

---

## Execution Note

This plan is **not a good fit for subagent-driven-development** in the usual sense: Tasks 2–3 configure and exercise *this specific live Claude Code session's* own MCP connection (`claude mcp add-json`, then actually asking the assistant to call tools) — a fresh dispatched subagent has no access to that state or to a running `make dev` stack in this session's terminal. Task 5 requires live Grafana Cloud UI access no agent here has. Recommend **inline execution in this session** (walking through Tasks 1–4 directly, together, in real time) rather than subagent dispatch, with Task 5 flagged clearly as your manual step and Task 6 as a normal quick docs commit.

## Self-Review Notes

- **Spec coverage:** all four spec components (helper script, `.mcp.json` config, integration doc, Grafana dashboard) have a corresponding task. The `cc-` prefix and OTel-already-configured note from the spec's later revision are both reflected (Task 1 Step 3, Task 5 Step 1).
- **Placeholder scan:** none — every step has literal commands/code, and Task 4's doc-writing step explicitly requires transcribing Task 3's real output rather than placeholder text.
- **Type/name consistency:** `MCP_AGENT_CLIENT_ID`/`MCP_AGENT_CLIENT_SECRET`/`PROXY_URL` are used identically in Task 1's script and Task 2's setup instructions; `github-guarded` is the server name used consistently across Tasks 2–4.
- **Out of scope (unchanged from spec):** `servers/flight` as a target, fixing the upstream `headersHelper` bug, per-individual-tool-call trace correlation, documenting other harnesses, editing the existing Grafana dashboard.
