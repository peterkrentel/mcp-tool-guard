# Claude Code Ops View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an admin/security operator one page that shows pending MCP approvals and recent audit activity filtered by originating client type (Claude Code / browser GUI / unattributed), so they don't need to know to check `/agents.html` and hand-inspect trace-id strings.

**Architecture:** A new static page `ui/claude-ops.html` with its own controller `ui/src/claude-ops-main.ts`, structurally a sibling to the existing `ui/agents.html`/`ui/src/agents-main.ts` pair. Reuses the existing admin Auth0 sign-in gate, the existing `/pending` and `/audit` API functions, and a newly-extracted shared pending-list renderer plus the already-existing shared audit renderer. Client-type is derived client-side from existing, unrelated trace-id prefix conventions (`cc-` for Claude Code, `tr_` for the browser agent) via one new pure function.

**Tech Stack:** TypeScript + Vite (`ui/` workspace), no new dependencies.

## Global Constraints

- Per the approved spec (`docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`): this is an admin-gated ops view, not a personal local-only tool — reuse the existing Auth0 `gateway:admin` sign-in flow exactly as `/agents.html` does today.
- Client-type classification uses only existing trace-id prefix conventions (`cc-`, `tr_`) — no new tagging convention, no gateway/backend changes.
- No server-side filtering (`GET /pending?client_type=...`) — filter client-side on already-fetched arrays, matching the demo-scale data volumes this project has today.
- No summary/counter tiles, no push/websocket transport — 2s polling, matching `/agents.html`'s existing audit-poll cadence.
- This repo has no UI test suite today (`CLAUDE.md`: "there is no UI or Python test suite currently") — verification is `npm run build -w @mcp-tool-guard/ui` plus a manual browser walkthrough, not a new automated test framework.
- `/agents.html`'s own approval queue and audit panels must look and behave identically after the shared-renderer extraction — this is a behavior-preserving refactor there, not a redesign.
- Every commit must update `CHANGELOG.md` under `[Unreleased]` (repo-wide pre-commit/CI rule) and land on a feature branch, never directly on `main`.
- No comments explaining *what* code does — only ones capturing non-obvious *why*, matching this repo's existing style.

---

### Task 1: `classifyClientType()` + fix the `PendingRequest` type gap

**Files:**
- Create: `ui/src/client-type.ts`
- Modify: `ui/src/proxy-api.ts` (the `PendingRequest` interface, ~line 181)

**Interfaces:**
- Produces: `classifyClientType(traceId?: string): "claude-code" | "browser-gui" | "unattributed"`, consumed by Task 3's new page.
- Produces: `PendingRequest.trace_id?: string` and `PendingRequest.wait_for_approval?: boolean`, consumed by Task 3's filtering logic.

- [ ] **Step 1: Write `client-type.ts`**

```ts
export type ClientType = "claude-code" | "browser-gui" | "unattributed";

export function classifyClientType(traceId?: string): ClientType {
  if (traceId?.startsWith("cc-")) return "claude-code";
  if (traceId?.startsWith("tr_")) return "browser-gui";
  return "unattributed";
}
```

- [ ] **Step 2: Verify it manually**

Since this repo has no UI test suite (`CLAUDE.md`), verify with a quick inline script rather than a new test framework:

```bash
cd ui && npx tsx -e '
import { classifyClientType } from "./src/client-type.ts";
const cases: Array<[string | undefined, string]> = [
  ["cc-1234", "claude-code"],
  ["tr_abcd", "browser-gui"],
  [undefined, "unattributed"],
  ["something-else", "unattributed"],
];
for (const [input, expected] of cases) {
  const actual = classifyClientType(input);
  if (actual !== expected) throw new Error(`classifyClientType(${JSON.stringify(input)}) = ${actual}, expected ${expected}`);
}
console.log("PASS: all classifyClientType cases correct");
'
```

Expected: `PASS: all classifyClientType cases correct` (if `tsx` isn't available, run `npm exec tsx -- -e '...'` from the `ui/` directory instead — it's resolved via the workspace's `node_modules`, no new dependency needed since Vite's toolchain already depends on it transitively; if that also fails, temporarily add a one-line `console.log` test call at the bottom of a scratch `.ts` file and run it with `npx vite-node`).

- [ ] **Step 3: Fix `PendingRequest`'s missing fields**

In `ui/src/proxy-api.ts`, modify the `PendingRequest` interface (~line 181):

```ts
export interface PendingRequest {
  id: string;
  trace_id?: string;
  server_id: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  agent_id?: string;
  wait_for_approval?: boolean;
  requested_at: string;
  status: "pending" | "approved" | "denied";
  resolved_at?: string;
  resolved_by?: string;
}
```

- [ ] **Step 4: Confirm the build is still clean**

```bash
npm run typecheck -w @mcp-tool-guard/ui
```

Expected: no errors (this is a strictly additive interface change — no existing code destructures these fields, so nothing can break).

- [ ] **Step 5: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`, one line: "**`classifyClientType()` helper** — `ui/src/client-type.ts`, classifies a trace id as `claude-code` (`cc-` prefix), `browser-gui` (`tr_` prefix), or `unattributed`, for the upcoming Claude Code ops view. Also fixes `ui/src/proxy-api.ts`'s `PendingRequest` interface, which was missing `trace_id`/`wait_for_approval` (both exist server-side since BL-045)."

```bash
git add ui/src/client-type.ts ui/src/proxy-api.ts CHANGELOG.md
git commit -m "feat(ui): add classifyClientType(), fix PendingRequest type gap"
```

---

### Task 2: Extract `renderPendingList()` out of `agents-main.ts`

**Files:**
- Create: `ui/src/pending-view.ts`
- Modify: `ui/src/agents-main.ts` (`refreshPending()`, ~lines 367-418)

**Interfaces:**
- Consumes: `PendingRequest` from `./proxy-api.js` (Task 1).
- Produces: `renderPendingList(container: HTMLElement, items: PendingRequest[], handlers: { onApprove(id: string): void; onDeny(id: string): void }): void`, consumed by Task 3's new page and by this task's refactored `agents-main.ts`.

- [ ] **Step 1: Write `pending-view.ts`**

This is the exact card-rendering logic currently inline in `agents-main.ts`'s `refreshPending()`, relocated and parameterized with callback handlers instead of directly calling `approvePendingRequest`/`denyPendingRequest`:

```ts
import type { PendingRequest } from "./proxy-api.js";

export interface PendingListHandlers {
  onApprove(id: string): void;
  onDeny(id: string): void;
}

export function renderPendingList(
  container: HTMLElement,
  items: PendingRequest[],
  handlers: PendingListHandlers,
): void {
  if (items.length === 0) {
    container.innerHTML = '<p class="admin-hint">No pending requests.</p>';
    return;
  }

  container.innerHTML = items
    .map((p) => {
      const age = p.requested_at ? Math.round((Date.now() - new Date(p.requested_at).getTime()) / 1000) : "?";
      const badge = p.status === "pending"
        ? '<span style="color:#f90;font-weight:600">PENDING</span>'
        : p.status === "approved"
        ? '<span style="color:#4c4;font-weight:600">APPROVED</span>'
        : '<span style="color:#c44;font-weight:600">DENIED</span>';
      return `<div class="card" style="border-left:3px solid ${p.status === "pending" ? "#f90" : p.status === "approved" ? "#4c4" : "#c44"}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${p.tool}</strong>${badge}
        </div>
        <div class="card-meta">server: ${p.server_id} &nbsp;·&nbsp; needs: <code>${p.required_scope}</code></div>
        <div class="card-meta">agent has: ${(p.token_scopes ?? []).join(", ") || "(none)"}</div>
        <div class="card-meta mono" style="font-size:.7rem">${p.id} &nbsp;·&nbsp; ${age}s ago</div>
        ${p.status === "pending" ? `
        <div style="display:flex;gap:.5rem;margin-top:.4rem">
          <button type="button" data-approve="${p.id}" style="background:#2a5;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Approve</button>
          <button type="button" data-deny="${p.id}" style="background:#a22;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Deny</button>
        </div>` : p.resolved_by ? `<div class="card-meta">by ${p.resolved_by}</div>` : ""}
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onApprove((btn as HTMLElement).dataset.approve!);
    });
  });

  container.querySelectorAll("[data-deny]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onDeny((btn as HTMLElement).dataset.deny!);
    });
  });
}
```

- [ ] **Step 2: Refactor `agents-main.ts` to use it**

Add the import (near the top, alongside the other `./` imports):

```ts
import { renderPendingList } from "./pending-view.js";
```

Replace the entire `refreshPending()` function (~lines 367-418) with:

```ts
async function refreshPending(): Promise<void> {
  try {
    const items = await listPendingRequests();
    renderPendingList(pendingListEl, items, {
      onApprove: (id) => {
        void approvePendingRequest(id, "admin")
          .then(() => refreshPending())
          .catch((err) => { statusEl.textContent = err instanceof Error ? err.message : String(err); });
      },
      onDeny: (id) => {
        void denyPendingRequest(id, "admin")
          .then(() => refreshPending())
          .catch((err) => { statusEl.textContent = err instanceof Error ? err.message : String(err); });
      },
    });
  } catch (err) {
    pendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}
```

- [ ] **Step 3: Verify the build is clean**

```bash
npm run build -w @mcp-tool-guard/ui
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Manually verify `/agents.html`'s approval queue is unchanged**

```bash
make dev
```

Open `http://localhost:5173/agents.html`, and confirm the "Approval queue" panel renders exactly as before (same card layout, same Approve/Deny buttons, same "No pending requests." empty state) — this is a pure refactor, nothing should look or behave differently. If you have a pending request available (e.g. from prior testing), confirm clicking Approve/Deny still works and the list refreshes.

- [ ] **Step 5: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Changed`, one line: "**Extracted `renderPendingList()`** — `ui/src/pending-view.ts`, moved out of `ui/src/agents-main.ts`'s inline card-rendering so it can be shared with the new Claude Code ops view (next). Behavior-preserving — `/agents.html`'s approval queue panel is unchanged."

```bash
git add ui/src/pending-view.ts ui/src/agents-main.ts CHANGELOG.md
git commit -m "refactor(ui): extract renderPendingList() for reuse"
```

---

### Task 3: New `claude-ops.html` page

**Files:**
- Create: `ui/claude-ops.html`
- Create: `ui/src/claude-ops-main.ts`

**Interfaces:**
- Consumes: `classifyClientType`/`ClientType` (Task 1), `renderPendingList` (Task 2), `renderThreeLayerAudit` (existing, `ui/src/agents-audit-view.ts`), `listPendingRequests`/`approvePendingRequest`/`denyPendingRequest`/`fetchGatewayAudit`/`setAdminTokenProvider` (existing, `ui/src/proxy-api.ts`), `getAuth0Config`/`getAuth0AccessToken`/`getAuth0UserLabel`/`handleAuthRedirect`/`hasGatewayAdminPermission`/`isAuth0Authenticated`/`loginWithAuth0`/`logoutAuth0`/`GATEWAY_ADMIN_PERMISSION` (existing, `ui/src/auth.ts`), `resolveProxyBase` (existing, `ui/src/config.ts`).
- Produces: the page itself — nothing downstream in this plan consumes it programmatically; Task 4 adds nav links pointing at it.

- [ ] **Step 1: Write `claude-ops.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Code ops — MCPToolGuard</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <header>
      <nav class="site-nav">
        <a href="/">Flight demo</a>
        <a href="/agents.html">Agent gateway</a>
        <a href="/claude-ops.html" class="nav-active">Claude Code ops</a>
      </nav>
      <h1>Claude Code ops</h1>
      <p class="tagline">Pending approvals and audit activity, filtered by client type</p>
    </header>

    <main class="agents-layout">
      <section class="panel admin-panel">
        <h2>Operator sign-in</h2>
        <p class="admin-hint">
          This view requires your Auth0 user token with <code>gateway:admin</code>, same as the Agent gateway page.
        </p>
        <div id="auth-controls" class="auth-controls" hidden>
          <button id="auth-login" type="button">Sign in</button>
          <button id="auth-logout" type="button" hidden>Sign out</button>
          <span id="auth-status" class="auth-status"></span>
        </div>
        <p id="admin-gate-hint" class="admin-hint"></p>
      </section>

      <section class="panel">
        <h2>Client type</h2>
        <select id="client-type-select">
          <option value="claude-code">Claude Code</option>
          <option value="browser-gui">Browser GUI</option>
          <option value="unattributed">Unattributed</option>
          <option value="all">All</option>
        </select>
      </section>

      <section class="panel">
        <h2>Pending approvals</h2>
        <p class="admin-hint">Filtered to the selected client type. Approve grants a one-time token to the agent.</p>
        <div id="ops-pending-list" class="card-list"></div>
      </section>

      <section class="panel log-panel">
        <h2>Recent activity</h2>
        <p class="log-panel-sub">Filtered audit feed for the selected client type</p>
        <div id="ops-audit" class="audit-log"></div>
      </section>
    </main>

    <script type="module" src="/src/claude-ops-main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `claude-ops-main.ts`**

```ts
import {
  approvePendingRequest,
  denyPendingRequest,
  fetchGatewayAudit,
  listPendingRequests,
  setAdminTokenProvider,
} from "./proxy-api.js";
import { renderPendingList } from "./pending-view.js";
import { renderThreeLayerAudit } from "./agents-audit-view.js";
import { classifyClientType, type ClientType } from "./client-type.js";
import {
  GATEWAY_ADMIN_PERMISSION,
  getAuth0AccessToken,
  getAuth0Config,
  getAuth0UserLabel,
  handleAuthRedirect,
  hasGatewayAdminPermission,
  isAuth0Authenticated,
  loginWithAuth0,
  logoutAuth0,
} from "./auth.js";
import { resolveProxyBase } from "./config.js";

const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;
const adminGateHintEl = document.getElementById("admin-gate-hint")!;
const clientTypeSelect = document.getElementById("client-type-select") as HTMLSelectElement;
const opsPendingListEl = document.getElementById("ops-pending-list")!;
const opsAuditEl = document.getElementById("ops-audit")!;

let controlPlaneAuthRequired = false;
let opsEnabled = false;
let demoBearer = "";
let poll: ReturnType<typeof setInterval> | null = null;

setAdminTokenProvider(async () => {
  if (!getAuth0Config() || !(await isAuth0Authenticated())) return null;
  return getAuth0AccessToken();
});

async function loadControlPlaneAuthFlag(): Promise<void> {
  try {
    const base = resolveProxyBase().replace(/\/$/, "");
    const res = await fetch(`${base}/health`);
    if (!res.ok) return;
    const data = (await res.json()) as { control_plane_auth?: boolean };
    controlPlaneAuthRequired = Boolean(data.control_plane_auth);
  } catch {
    controlPlaneAuthRequired = Boolean(getAuth0Config());
  }
}

async function syncOpsAdminGate(): Promise<void> {
  const auth0Config = getAuth0Config();
  await loadControlPlaneAuthFlag();

  if (!controlPlaneAuthRequired) {
    authControls.hidden = true;
    adminGateHintEl.textContent = "Control plane auth is off (local dev). Viewing without sign-in.";
    opsEnabled = true;
    return;
  }

  if (!auth0Config) {
    authControls.hidden = true;
    adminGateHintEl.textContent = "Set VITE_AUTH0_* on the UI and MCP_JWT_* on the proxy for operator sign-in.";
    opsEnabled = false;
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isAuth0Authenticated();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;

  if (!authenticated) {
    authStatusEl.textContent = "Sign in to view Claude Code ops";
    adminGateHintEl.textContent = `Requires Auth0 permission ${GATEWAY_ADMIN_PERMISSION}.`;
    opsEnabled = false;
    return;
  }

  authStatusEl.textContent = await getAuth0UserLabel();
  const isAdmin = await hasGatewayAdminPermission();
  if (!isAdmin) {
    adminGateHintEl.textContent = `Signed in, but your token lacks ${GATEWAY_ADMIN_PERMISSION}. Assign it in Auth0, then sign out/in.`;
    opsEnabled = false;
    return;
  }

  adminGateHintEl.textContent = `Control plane unlocked (${GATEWAY_ADMIN_PERMISSION}).`;
  opsEnabled = true;
}

async function ensureDemoBearer(): Promise<string> {
  if (demoBearer) return demoBearer;
  const tokens = (await fetch("/demo-tokens.json").then((r) => r.json())) as Record<string, string>;
  demoBearer = tokens.admin ?? "";
  return demoBearer;
}

function selectedClientType(): ClientType | "all" {
  return clientTypeSelect.value as ClientType | "all";
}

async function refreshOpsPending(): Promise<void> {
  if (!opsEnabled) {
    opsPendingListEl.innerHTML = '<p class="admin-hint">Sign in to view pending requests.</p>';
    return;
  }
  try {
    const items = await listPendingRequests();
    const selected = selectedClientType();
    const filtered = selected === "all"
      ? items
      : items.filter((p) => classifyClientType(p.trace_id) === selected);
    renderPendingList(opsPendingListEl, filtered, {
      onApprove: (id) => {
        void approvePendingRequest(id, "admin")
          .then(() => refreshOpsPending())
          .catch((err) => {
            opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
          });
      },
      onDeny: (id) => {
        void denyPendingRequest(id, "admin")
          .then(() => refreshOpsPending())
          .catch((err) => {
            opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
          });
      },
    });
  } catch (err) {
    opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

async function refreshOpsAudit(): Promise<void> {
  if (!opsEnabled) {
    opsAuditEl.innerHTML = '<p class="admin-hint">Sign in to view audit activity.</p>';
    return;
  }
  try {
    const bearer = await ensureDemoBearer();
    const entries = await fetchGatewayAudit(bearer);
    const selected = selectedClientType();
    const filtered = selected === "all"
      ? entries
      : entries.filter((e) => classifyClientType(e.trace_id) === selected);
    renderThreeLayerAudit(opsAuditEl, filtered, "");
  } catch (err) {
    opsAuditEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

function startOpsPoll(): void {
  if (poll) clearInterval(poll);
  poll = setInterval(() => {
    void refreshOpsPending();
    void refreshOpsAudit();
  }, 2000);
}

clientTypeSelect.addEventListener("change", () => {
  void refreshOpsPending();
  void refreshOpsAudit();
});

authLoginBtn.addEventListener("click", () => void loginWithAuth0());
authLogoutBtn.addEventListener("click", () => {
  void logoutAuth0().then(() => syncOpsAdminGate());
});

void syncOpsAdminGate().then(() => {
  void refreshOpsPending();
  void refreshOpsAudit();
  startOpsPoll();
});
```

- [ ] **Step 3: Add the new page to the Vite build entry list**

`ui/vite.config.ts`'s `build.rollupOptions.input` is an explicit list (`main`, `agents`), not a glob — `claude-ops.html` will silently be excluded from the production build unless added. Modify it:

```ts
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        agents: resolve(__dirname, "agents.html"),
        claudeOps: resolve(__dirname, "claude-ops.html"),
      },
    },
  },
```

- [ ] **Step 4: Verify the build is clean**

```bash
npm run build -w @mcp-tool-guard/ui
```

Expected: build succeeds, `ui/dist/claude-ops.html` is produced as a build output.

- [ ] **Step 5: Manually verify in a real browser**

```bash
make dev
```

Open `http://localhost:5173/claude-ops.html`. Confirm:
- Locally (no `control_plane_auth`), the page loads straight into "Viewing without sign-in" and both panels populate.
- The client-type dropdown defaults to "Claude Code" and changing it re-filters both panels immediately.
- If you have any `cc-`-prefixed pending/audit data (from earlier BL-037/BL-045 testing), it shows up under "Claude Code"; switching to "All" shows everything.
- Approve/Deny buttons on a real pending item work and the list updates within 2s.

- [ ] **Step 6: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`: "**Claude Code ops view** — `ui/claude-ops.html` + `ui/src/claude-ops-main.ts`, an admin-gated page (same Auth0 `gateway:admin` sign-in as `/agents.html`) showing pending approvals and recent audit activity filtered by client type (Claude Code / browser GUI / unattributed), so an operator doesn't need to know to check `/agents.html` and hand-inspect trace-id strings. Implements `docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`."

```bash
git add ui/claude-ops.html ui/src/claude-ops-main.ts CHANGELOG.md
git commit -m "feat(ui): add Claude Code ops view"
```

---

### Task 4: Nav links + full walkthrough

**Files:**
- Modify: `ui/index.html` (site-nav)
- Modify: `ui/agents.html` (site-nav)
- Modify: `ui/claude-ops.html` (already has the link from Task 3 — verify only)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing downstream — this is the final polish/verification task.

- [ ] **Step 1: Add the nav link to `ui/index.html`**

Modify the `site-nav` block (~lines 11-14):

```html
      <nav class="site-nav">
        <a href="/" class="nav-active">Flight demo</a>
        <a href="/agents.html">Agent gateway</a>
        <a href="/claude-ops.html">Claude Code ops</a>
      </nav>
```

- [ ] **Step 2: Add the nav link to `ui/agents.html`**

Modify the `site-nav` block (~lines 11-14):

```html
      <nav class="site-nav">
        <a href="/">Flight demo</a>
        <a href="/agents.html" class="nav-active">Agent gateway</a>
        <a href="/claude-ops.html">Claude Code ops</a>
      </nav>
```

- [ ] **Step 3: Verify the build is clean**

```bash
npm run build -w @mcp-tool-guard/ui
npm run typecheck -w @mcp-tool-guard/ui
```

Expected: both succeed with no errors.

- [ ] **Step 4: Full manual walkthrough**

```bash
make dev
```

Visit `/`, `/agents.html`, and `/claude-ops.html` in turn. Confirm the nav bar on each page shows all three links with the correct one highlighted (`nav-active`), and clicking between them navigates correctly. Re-confirm `/agents.html`'s approval queue and audit panels still look and behave exactly as before Task 2's refactor.

- [ ] **Step 5: Commit**

Add a `CHANGELOG.md` entry under `[Unreleased]` → `### Added`, one line: "**Nav links to Claude Code ops** — added to `/` and `/agents.html`'s site nav."

```bash
git add ui/index.html ui/agents.html CHANGELOG.md
git commit -m "feat(ui): add nav links to Claude Code ops view"
```

- [ ] **Step 6:** Push and report the compare URL — per this repo's workflow rules, do not merge or open the PR via `gh`.
