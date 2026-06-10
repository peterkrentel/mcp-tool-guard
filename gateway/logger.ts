import type { AuditLogEntry } from "./types.js";

export type LogSink = (entry: AuditLogEntry) => void;

/** One stdout line — Render and other hosts mishandle multi-arg console.info. */
function stdoutLine(entry: AuditLogEntry): string {
  const parts = [`${entry.decision} ${entry.tool}`];
  if (entry.source) parts.push(`source=${entry.source}`);
  if (entry.required_scope) parts.push(`required=${entry.required_scope}`);
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
    } else if (entry.log_level === "verbose") {
      console.log(`[MCPToolGuard] ${stdoutLine(entry)}`);
    } else {
      console.log(`[MCPToolGuard] ${stdoutLine(entry)}`);
    }
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
