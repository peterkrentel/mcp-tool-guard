import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { shortId } from "./trace.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTime(timestamp: string): string {
  return timestamp.length >= 19 ? timestamp.slice(11, 19) : timestamp;
}

function traceChip(traceId: string | undefined, focused: string | null): string {
  if (!traceId) return "";
  const cls = focused === traceId ? " log-trace-focus" : "";
  return `<button type="button" class="log-trace${cls}" data-trace-focus="${escapeHtml(traceId)}" title="${escapeHtml(traceId)}">${escapeHtml(shortId(traceId))}</button>`;
}

function renderRow(e: AuditLogEntry, focused: string | null): string {
  const decision = e.decision === "allow" ? "ALLOW" : "DENY";
  const cls = e.decision === "allow" ? "log-allow" : "log-deny";
  const extra = e.response_preview
    ? `<div class="log-detail">${escapeHtml(e.response_preview.slice(0, 120))}</div>`
    : e.intent
      ? `<div class="log-detail">${escapeHtml(e.intent)}</div>`
      : e.reason
        ? `<div class="log-detail">${escapeHtml(e.reason)}</div>`
        : "";
  const latency = e.duration_ms != null ? ` ${e.duration_ms}ms` : "";
  return `<div class="log-entry ${cls}" data-trace-id="${escapeHtml(e.trace_id ?? "")}">
    <span class="log-time">${formatTime(e.timestamp)}</span>
    <span class="log-decision">${decision}</span>
    <span class="log-tool">${escapeHtml(e.tool || "—")}</span>${latency}
    ${traceChip(e.trace_id, focused)}
    ${extra}
  </div>`;
}

function renderSection(
  title: string,
  entries: AuditLogEntry[],
  focused: string | null,
  open: boolean,
): string {
  const body = entries.length
    ? entries.map((e) => renderRow(e, focused)).join("")
    : '<div class="log-empty">No entries yet</div>';
  return `<details class="audit-section" ${open ? "open" : ""}>
    <summary>${escapeHtml(title)} <span class="log-count">(${entries.length})</span></summary>
    <div class="audit-section-body">${body}</div>
  </details>`;
}

let focusedTrace: string | null = null;

export function renderThreeLayerAudit(
  container: HTMLElement,
  entries: readonly AuditLogEntry[],
  sessionId: string,
): void {
  const filtered = sessionId
    ? entries.filter((e) => !e.session_id || e.session_id === sessionId)
    : [...entries];

  const agent = filtered.filter((e) => e.source === "agent");
  const proxy = filtered.filter((e) => e.source === "proxy" || (!e.source && e.required_scope));
  const mcp = filtered.filter((e) => e.source === "mcp");

  container.innerHTML = [
    renderSection("Agent calls", agent, focusedTrace, true),
    renderSection("Proxy decisions", proxy, focusedTrace, true),
    renderSection("MCP responses", mcp, focusedTrace, true),
  ].join("");

  container.querySelectorAll("[data-trace-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.traceFocus ?? null;
      focusedTrace = focusedTrace === id ? null : id;
      renderThreeLayerAudit(container, entries, sessionId);
      if (focusedTrace) {
        container.querySelectorAll(`[data-trace-id="${CSS.escape(focusedTrace)}"]`).forEach((el) => {
          el.classList.add("log-highlight");
        });
      }
    });
  });
}
