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

function filterSession(
  entries: readonly AuditLogEntry[],
  sessionId: string,
): AuditLogEntry[] {
  if (!sessionId) return [...entries];
  return entries.filter((e) => !e.session_id || e.session_id === sessionId);
}

function renderEntry(e: AuditLogEntry): string {
  const trace = e.trace_id
    ? `<span class="log-trace" title="${escapeHtml(e.trace_id)}">${escapeHtml(shortId(e.trace_id))}</span>`
    : "";
  return `<div class="log-entry log-${e.decision}">
    <span class="log-source log-source-server">SERVER</span>
    ${trace}
    <span class="log-time">${formatTime(e.timestamp)}</span>
    <span class="log-decision">${e.decision.toUpperCase()}</span>
    <span class="log-tool">${escapeHtml(e.tool)}</span>
    <span class="log-scope">${escapeHtml(e.required_scope)}</span>
    ${e.reason ? `<span class="log-reason">${escapeHtml(e.reason)}</span>` : ""}
  </div>`;
}

export function renderAuditPanel(
  container: HTMLElement,
  server: readonly AuditLogEntry[],
  sessionId: string,
): void {
  const entries = filterSession(server, sessionId);
  const sessionLabel = sessionId
    ? `<p class="audit-session-id">Session <code>${escapeHtml(shortId(sessionId))}</code></p>`
    : "";

  const body =
    entries.length === 0
      ? `<p class="audit-empty">No tool calls this session yet. Each MCP tools/call is logged here after server enforcement.</p>`
      : entries
          .slice()
          .reverse()
          .map((e) => renderEntry(e))
          .join("");

  container.innerHTML = `${sessionLabel}
    <div class="audit-section audit-section-server">
      <div class="audit-section-header">
        <h3>Server enforcement</h3>
        <p class="audit-section-sub">JWT scopes enforced on every tools/call at the MCP server</p>
      </div>
      <div class="audit-section-body">${body}</div>
    </div>`;
}
