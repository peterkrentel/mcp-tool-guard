/** Per user-message routing observability (not compliance evidence). */

export type AgentTraceRoute = "help" | "heuristic" | "pending" | "llm";

export interface AgentTraceEntry {
  timestamp: string;
  trace_id: string;
  session_id: string;
  user_message: string;
  route: AgentTraceRoute;
  tool?: string;
  arguments?: Record<string, unknown>;
  /** Truncated model output when route is llm. */
  llm_raw_preview?: string;
  outcome: string;
  guard_decision?: "allow" | "deny";
  required_scope?: string;
}

const LLM_PREVIEW_LEN = 480;

export class TurnRecorder {
  readonly trace_id: string;
  readonly session_id: string;
  readonly user_message: string;
  readonly timestamp: string;

  private route: AgentTraceRoute = "heuristic";
  private tool?: string;
  private arguments?: Record<string, unknown>;
  private llm_raw_preview?: string;
  private outcome = "in_progress";
  private guard_decision?: "allow" | "deny";
  private required_scope?: string;

  constructor(trace_id: string, session_id: string, user_message: string) {
    this.trace_id = trace_id;
    this.session_id = session_id;
    this.user_message = user_message;
    this.timestamp = new Date().toISOString();
  }

  setRoute(route: AgentTraceRoute): void {
    this.route = route;
  }

  setIntent(tool: string, args: Record<string, unknown>): void {
    this.tool = tool;
    this.arguments = args;
  }

  setLlmRaw(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.llm_raw_preview =
      trimmed.length > LLM_PREVIEW_LEN
        ? `${trimmed.slice(0, LLM_PREVIEW_LEN)}…`
        : trimmed;
  }

  setOutcome(outcome: string): void {
    this.outcome = outcome;
  }

  setGuard(decision: "allow" | "deny", required_scope: string, reason?: string): void {
    this.guard_decision = decision;
    this.required_scope = required_scope;
    if (reason) this.outcome = decision === "deny" ? `client_denied: ${reason}` : "tool_called";
  }

  build(): AgentTraceEntry {
    return {
      timestamp: this.timestamp,
      trace_id: this.trace_id,
      session_id: this.session_id,
      user_message: this.user_message,
      route: this.route,
      tool: this.tool,
      arguments: this.arguments,
      llm_raw_preview: this.llm_raw_preview,
      outcome: this.outcome,
      guard_decision: this.guard_decision,
      required_scope: this.required_scope,
    };
  }
}

export function filterTracesBySession(
  entries: readonly AgentTraceEntry[],
  sessionId: string,
): AgentTraceEntry[] {
  if (!sessionId) return [...entries];
  return entries.filter((e) => !e.session_id || e.session_id === sessionId);
}
