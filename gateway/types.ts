export type LogLevel = "info" | "verbose";

export interface ToolConfig {
  required_scope: string;
  alert?: boolean;
  log_level?: LogLevel;
}

export interface ServerConfig {
  url: string;
  tools: Record<string, ToolConfig>;
}

export interface GuardConfig {
  servers: Record<string, ServerConfig>;
}

export type GuardDecision = "allow" | "deny";

export interface AuditLogEntry {
  timestamp: string;
  decision: GuardDecision;
  server: string;
  tool: string;
  required_scope: string;
  token_scopes: string[];
  reason?: string;
  alert?: boolean;
  log_level?: LogLevel;
  duration_ms?: number;
}

export interface JwtPayload {
  sub?: string;
  exp?: number;
  scope?: string;
  scopes?: string | string[];
  [key: string]: unknown;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  required_scope: string;
  entry: AuditLogEntry;
}
