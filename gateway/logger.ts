import type { AuditLogEntry } from "./types.js";

export type LogSink = (entry: AuditLogEntry) => void;

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
      console.warn("[MCPToolGuard ALERT]", entry);
    } else if (entry.log_level === "verbose") {
      console.debug("[MCPToolGuard]", entry);
    } else {
      console.info("[MCPToolGuard]", entry.decision, entry.tool);
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
