import { kvEnabled, kvGet, kvSet } from "./kv.js";
import type { AuditLogEntry } from "./types.js";

export type LogSink = (entry: AuditLogEntry) => void;

const AUDIT_KV_KEY = "gateway:audit:recent";
const AUDIT_KV_MAX = 500;

/** One stdout line — Render and other hosts mishandle multi-arg console.info. */
function stdoutLine(entry: AuditLogEntry): string {
  const parts = [`${entry.decision} ${entry.tool}`];
  if (entry.source) parts.push(`source=${entry.source}`);
  if (entry.required_scope) parts.push(`required=${entry.required_scope}`);
  if (entry.trace_id) parts.push(`trace_id=${entry.trace_id}`);
  if (entry.reason) parts.push(`reason=${entry.reason}`);
  return parts.join(" ");
}

export class AuditLogger {
  private entries: AuditLogEntry[] = [];
  private sinks: LogSink[] = [];

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  log(entry: AuditLogEntry): void {
    this.entries.push(entry);
    for (const sink of this.sinks) {
      sink(entry);
    }
    if (entry.alert) {
      console.warn(`[MCPToolGuard ALERT] ${stdoutLine(entry)}`);
    } else {
      console.log(`[MCPToolGuard] ${stdoutLine(entry)}`);
    }
    // Persist to KV asynchronously — fire and forget, never blocks the response
    if (kvEnabled()) {
      void this.persistToKv(entry).catch(() => {/* swallow — audit is best-effort */});
    }
  }

  private async persistToKv(entry: AuditLogEntry): Promise<void> {
    const current = (await kvGet<AuditLogEntry[]>(AUDIT_KV_KEY)) ?? [];
    current.push(entry);
    // Keep only the last AUDIT_KV_MAX entries
    const trimmed = current.length > AUDIT_KV_MAX ? current.slice(-AUDIT_KV_MAX) : current;
    await kvSet(AUDIT_KV_KEY, trimmed);
  }

  /** Load persisted entries from KV into memory (call once at startup). */
  async loadFromKv(): Promise<number> {
    if (!kvEnabled()) return 0;
    const stored = (await kvGet<AuditLogEntry[]>(AUDIT_KV_KEY)) ?? [];
    // Prepend KV entries, dedup by timestamp+tool combination
    const existingKeys = new Set(this.entries.map((e) => `${e.timestamp}:${e.tool}:${e.source}`));
    const fresh = stored.filter((e) => !existingKeys.has(`${e.timestamp}:${e.tool}:${e.source}`));
    this.entries = [...fresh, ...this.entries].slice(-AUDIT_KV_MAX);
    return fresh.length;
  }

  getEntries(): readonly AuditLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
