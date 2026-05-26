import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";

import { TOOL_DESCRIPTIONS } from "./guard-config.js";
import { McpHttpClient } from "./mcp-client.js";
import { newSessionId, newTraceId } from "./trace.js";
import {
  DEMO_DATES_HINT,
  canContinuePending,
  extractBookingIdFromToolResult,
  formatCancelToolResult,
  formatHelpText,
  interceptNonToolReply,
  isHelpQuestion,
  prepareToolCall,
  shouldSupersedePending,
  tryHeuristicIntent,
  type PendingToolCall,
  type SessionContext,
  type ToolCallIntent,
} from "./tool-args.js";

export type { ToolCallIntent } from "./tool-args.js";

export interface AgentOptions {
  mcpUrl: string;
  jwt: string;
  onStatus?: (status: string) => void;
  onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  /** Called after a tool attempt so the UI can refresh server audit. */
  onAfterToolCall?: () => void;
}

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

export class FlightAgent {
  private engine: MLCEngineInterface | null = null;
  private mcp: McpHttpClient;
  private jwt: string;
  private messages: Array<{ role: string; content: string }> = [];
  private pending: PendingToolCall | null = null;
  private session: SessionContext = { lastBookingId: null, lastFlightId: null };
  private sessionId = "";
  private onStatus?: (status: string) => void;
  private onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  private onAfterToolCall?: () => void;

  constructor(options: AgentOptions) {
    this.jwt = options.jwt;
    this.mcp = new McpHttpClient({ url: options.mcpUrl, bearerToken: options.jwt });
    this.onStatus = options.onStatus;
    this.onMessage = options.onMessage;
    this.onAfterToolCall = options.onAfterToolCall;
  }

  setToken(jwt: string): void {
    this.jwt = jwt;
    this.mcp.setBearerToken(jwt);
  }

  async init(): Promise<void> {
    this.sessionId = newSessionId();
    this.onStatus?.("Loading WebLLM model (this may take a minute)...");
    this.engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        this.onStatus?.(`Loading model: ${Math.round(report.progress * 100)}%`);
      },
    });
    this.onStatus?.("Model ready. MCP client connecting...");
    await this.mcp.listTools();
    this.onStatus?.("Ready");
  }

  private systemPrompt(): string {
    const tools = Object.entries(TOOL_DESCRIPTIONS)
      .map(([name, desc]) => `- ${name}: ${desc}`)
      .join("\n");
    return `You are a flight booking assistant with access to MCP tools.
When the user needs data or actions, respond with ONLY a JSON object (no markdown):
{"tool":"<tool_name>","arguments":{...}}

Rules:
- Use 3-letter IATA airport codes (SFO, JFK) only if the user said them.
- NEVER invent departure_date. Omit it unless the user wrote a YYYY-MM-DD date.
- Demo available dates: ${DEMO_DATES_HINT}.
- Use flight IDs like FL101 for search/details only.
- For cancel/get/check-in use booking IDs like BK-XXXXXXXX only — never use FL... as booking_id.
- NEVER invent booking IDs or success messages. If info is missing, ask in plain text.

Available tools:
${tools}

If required information is missing, respond with plain text asking the user (do not call a tool).`;
  }

  private parseToolIntent(text: string): ToolCallIntent | null {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*"tool"[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      const parsed = JSON.parse(jsonMatch[0]) as ToolCallIntent;
      if (parsed.tool && typeof parsed.tool === "string") {
        return { tool: parsed.tool, arguments: parsed.arguments ?? {} };
      }
    } catch {
      return null;
    }
    return null;
  }

  private replyAssistant(text: string): string {
    this.messages.push({ role: "assistant", content: text });
    this.onMessage?.("assistant", text);
    this.onStatus?.("Ready");
    return text;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private async executeTool(
    tool: string,
    args: Record<string, unknown>,
    summary: string,
  ): Promise<string> {
    this.onStatus?.(`Calling ${summary}`);
    const traceId = newTraceId();

    let toolResult: string;
    try {
      toolResult = await this.mcp.callTool(tool, args, {
        session_id: this.sessionId,
        trace_id: traceId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onAfterToolCall?.();
      if (/403|access denied|missing authorization|jwt/i.test(message)) {
        return this.replyAssistant(`Access denied (server): ${message}`);
      }
      return this.replyAssistant(`Tool error: ${message}`);
    }

    this.onAfterToolCall?.();

    if (tool === "create_booking_tool") {
      const ids = extractBookingIdFromToolResult(tool, toolResult);
      if (ids.bookingId) this.session.lastBookingId = ids.bookingId;
      if (ids.flightId) this.session.lastFlightId = ids.flightId;
    }

    const display =
      tool === "cancel_booking_tool" ? formatCancelToolResult(toolResult) : toolResult;

    return this.replyAssistant(`Tool \`${tool}\` result:\n${display}`);
  }

  private async resolveIntent(
    userMessage: string,
    intent: ToolCallIntent,
  ): Promise<string | null> {
    const prepared = prepareToolCall(
      intent.tool,
      userMessage,
      intent.arguments,
      this.pending?.tool === intent.tool ? this.pending.partial : undefined,
      this.session,
    );

    if (!prepared.ok) {
      this.pending = prepared.pending;
      return this.replyAssistant(prepared.message);
    }

    this.pending = null;
    return this.executeTool(prepared.tool, prepared.arguments, prepared.summary);
  }

  async chat(userMessage: string): Promise<string> {
    if (!this.engine) throw new Error("Agent not initialized");

    this.onMessage?.("user", userMessage);
    this.messages.push({ role: "user", content: userMessage });

    if (isHelpQuestion(userMessage)) {
      this.pending = null;
      return this.replyAssistant(formatHelpText());
    }

    const heuristic = tryHeuristicIntent(userMessage, this.session);

    if (this.pending && shouldSupersedePending(this.pending, userMessage, heuristic)) {
      this.pending = null;
    }

    if (heuristic) {
      const result = await this.resolveIntent(userMessage, heuristic);
      if (result) return result;
    }

    if (this.pending) {
      if (canContinuePending(this.pending, userMessage, this.session)) {
        const prepared = prepareToolCall(
          this.pending.tool,
          userMessage,
          {},
          this.pending.partial,
          this.session,
        );
        if (!prepared.ok) {
          this.pending = prepared.pending;
          return this.replyAssistant(prepared.message);
        }
        this.pending = null;
        return this.executeTool(prepared.tool, prepared.arguments, prepared.summary);
      }
      this.pending = null;
    }

    const response = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: this.systemPrompt() },
        ...this.messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ],
      temperature: 0.2,
      max_tokens: 512,
    });

    const assistantText =
      response.choices[0]?.message?.content?.toString() ?? "No response";
    const intent = this.parseToolIntent(assistantText);

    if (!intent) {
      const intercepted = interceptNonToolReply(userMessage, assistantText);
      return this.replyAssistant(intercepted ?? assistantText);
    }

    const result = await this.resolveIntent(userMessage, intent);
    if (result) return result;

    const intercepted = interceptNonToolReply(userMessage, assistantText);
    return this.replyAssistant(intercepted ?? assistantText);
  }
}
