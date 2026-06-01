import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { shortId } from "./trace.js";

export type ServerAuditResult =
  | { ok: true; entries: AuditLogEntry[] }
  | { ok: false; error: string; status?: number };

export async function fetchServerAudit(
  auditUrl: string,
  bearerToken: string,
  sessionId?: string,
): Promise<ServerAuditResult> {
  try {
    const url = sessionId
      ? `${auditUrl}?session_id=${encodeURIComponent(sessionId)}`
      : auditUrl;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      return { ok: false, error: detail, status: res.status };
    }
    const data = (await res.json()) as { entries?: AuditLogEntry[] };
    return { ok: true, entries: data.entries ?? [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTime(timestamp: string): string {
  return timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp;
}

function entryKey(e: AuditLogEntry): string {
  return e.trace_id ?? `${e.timestamp}|${e.tool}|${e.decision}`;
}

function filterSession(
  entries: readonly AuditLogEntry[],
  sessionId: string,
): AuditLogEntry[] {
  if (!sessionId) return [...entries];
  return entries.filter((e) => !e.session_id || e.session_id === sessionId);
}

function serverByTrace(server: readonly AuditLogEntry[]): Map<string, AuditLogEntry> {
  const map = new Map<string, AuditLogEntry>();
  for (const e of server) {
    if (e.trace_id) map.set(e.trace_id, e);
  }
  return map;
}

function findMismatches(
  server: readonly AuditLogEntry[],
  client: readonly AuditLogEntry[],
): Set<string> {
  const mismatches = new Set<string>();
  const byTrace = serverByTrace(server);
  for (const c of client) {
    if (c.decision !== "allow" || !c.trace_id) continue;
    const s = byTrace.get(c.trace_id);
    if (s && s.decision !== c.decision) {
      mismatches.add(entryKey(c));
      mismatches.add(entryKey(s));
    }
  }
  return mismatches;
}

function blockedBeforeServer(
  e: AuditLogEntry,
  server: readonly AuditLogEntry[],
): boolean {
  if (e.reached_server !== false || !e.trace_id) return false;
  return !server.some((s) => s.trace_id === e.trace_id);
}

function renderEntry(
  e: AuditLogEntry,
  source: "server" | "client",
  mismatches: Set<string>,
  server: readonly AuditLogEntry[],
): string {
  const mismatch = mismatches.has(entryKey(e));
  const sourceLabel = source === "server" ? "SERVER" : "CLIENT";
  const trace = e.trace_id ? `<span class="log-trace" title="${escapeHtml(e.trace_id)}">${escapeHtml(shortId(e.trace_id))}</span>` : "";
  const blocked = blockedBeforeServer(e, server);
  return `<div class="log-entry log-${e.decision} log-source-${source}${mismatch ? " log-mismatch" : ""}${blocked ? " log-blocked" : ""}">
    <span class="log-source log-source-${source}">${sourceLabel}</span>
    ${trace}
    <span class="log-time">${formatTime(e.timestamp)}</span>
    <span class="log-decision">${e.decision.toUpperCase()}</span>
    <span class="log-tool">${escapeHtml(e.tool)}</span>
    <span class="log-scope">${escapeHtml(e.required_scope)}</span>
    ${e.reason ? `<span class="log-reason">${escapeHtml(e.reason)}</span>` : ""}
    ${blocked ? `<span class="log-reason log-blocked-note">Blocked before MCP — no server row for this trace</span>` : ""}
    ${mismatch ? `<span class="log-reason log-mismatch-note">Client and server decisions differ (same trace_id)</span>` : ""}
  </div>`;
}

function renderSection(
  title: string,
  subtitle: string,
  entries: readonly AuditLogEntry[],
  source: "server" | "client",
  mismatches: Set<string>,
  server: readonly AuditLogEntry[],
  emptyMessage: string,
): string {
  const body =
    entries.length === 0
      ? `<p class="audit-empty">${emptyMessage}</p>`
      : entries
          .slice()
          .reverse()
          .map((e) => renderEntry(e, source, mismatches, server))
          .join("");

  return `<div class="audit-section audit-section-${source}">
    <div class="audit-section-header">
      <h3>${title}</h3>
      <p class="audit-section-sub">${subtitle}</p>
    </div>
    <div class="audit-section-body">${body}</div>
  </div>`;
}

function renderAuditError(error: string, status?: number): string {
  const statusLabel = status ? ` (${status})` : "";
  return `<div class="audit-fetch-error" role="alert">
    <strong>Server audit unavailable${escapeHtml(statusLabel)}</strong>
    <p>${escapeHtml(error)}</p>
    <p class="audit-fetch-hint">Server enforcement requires a valid Bearer JWT on GET /audit. Sign in with Auth0 or use a guest demo token, then Initialize.</p>
  </div>`;
}

export function renderAuditPanel(
  container: HTMLElement,
  server: ServerAuditResult,
  client: readonly AuditLogEntry[],
  sessionId: string,
): void {
  const serverEntries = server.ok ? server.entries : [];
  const serverFiltered = filterSession(serverEntries, sessionId);
  const clientFiltered = filterSession(client, sessionId);
  const mismatches = findMismatches(serverFiltered, clientFiltered);

  const sessionLabel = sessionId
    ? `<p class="audit-session-id">Session <code>${escapeHtml(shortId(sessionId))}</code></p>`
    : "";

  const errorBanner = server.ok ? "" : renderAuditError(server.error, server.status);

  container.innerHTML =
    sessionLabel +
    errorBanner +
    renderSection(
      "Server enforcement",
      "Authoritative security record — JWT verified and scopes enforced on every MCP tools/call",
      serverFiltered,
      "server",
      mismatches,
      serverFiltered,
      server.ok
        ? "No server entries this session. Rows appear after MCP receives tools/call. If the agent was blocked in the browser first, check Agent attempts — no server row is expected."
        : "Could not load server audit — fix the error above and refresh.",
    ) +
    renderSection(
      "Agent attempts",
      "Agent behavior observability — SDK pre-check before the network; not proof of enforcement",
      clientFiltered,
      "client",
      mismatches,
      serverFiltered,
      "No agent attempts this session. Tool proposals blocked or allowed by the client guard appear here (including denies with no MCP request).",
    );
}
