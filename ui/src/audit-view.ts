import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { shortId } from "./trace.js";

export async function fetchServerAudit(
  auditUrl: string,
  sessionId?: string,
): Promise<AuditLogEntry[]> {
  try {
    const url = sessionId
      ? `${auditUrl}?session_id=${encodeURIComponent(sessionId)}`
      : auditUrl;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { entries?: AuditLogEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
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

export function renderAuditPanel(
  container: HTMLElement,
  server: readonly AuditLogEntry[],
  client: readonly AuditLogEntry[],
  sessionId: string,
): void {
  const serverFiltered = filterSession(server, sessionId);
  const clientFiltered = filterSession(client, sessionId);
  const mismatches = findMismatches(serverFiltered, clientFiltered);

  const sessionLabel = sessionId
    ? `<p class="audit-session-id">Session <code>${escapeHtml(shortId(sessionId))}</code></p>`
    : "";

  container.innerHTML =
    sessionLabel +
    renderSection(
      "Server enforcement",
      "Authoritative security record — JWT verified and scopes enforced on every MCP tools/call",
      serverFiltered,
      "server",
      mismatches,
      serverFiltered,
      "No server entries this session. Rows appear after MCP receives tools/call. If the agent was blocked in the browser first, check Agent attempts — no server row is expected.",
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
