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
  /** Demo session — groups activity since Initialize. */
  session_id?: string;
  /** One tool invocation attempt; links client pre-check and server enforcement. */
  trace_id?: string;
  /** Client guard only: false when blocked before HTTP tools/call. */
  reached_server?: boolean;
}

export interface AuditContext {
  session_id?: string;
  trace_id?: string;
  reached_server?: boolean;
}

export interface JwtPayload {
  sub?: string;
  exp?: number;
  scope?: string;
  scopes?: string | string[];
  scp?: string | string[];
  /** Auth0 RBAC — API permissions when "Add Permissions in the Access Token" is enabled. */
  permissions?: string[];
  [key: string]: unknown;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  required_scope: string;
  entry: AuditLogEntry;
}
