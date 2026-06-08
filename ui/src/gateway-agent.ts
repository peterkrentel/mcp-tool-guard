import { ToolGuard } from "@mcp-tool-guard/gateway";
import type { AuditLogEntry, GuardConfig } from "@mcp-tool-guard/gateway";

import { createLlmRunner } from "./llm/providers.js";
import type { ChatMessage, LlmProviderId, LlmToolSchema } from "./llm/types.js";
import { McpHttpClient } from "./mcp-client.js";
import { postAgentAudit } from "./proxy-api.js";
import { newSessionId, newTraceId } from "./trace.js";

export interface GatewayAgentOptions {
  serverId: string;
  guardConfig: GuardConfig;
  mcpUrl: string;
  jwt: string;
  publicKeyPem: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  jwksUrl?: string;
  tools: LlmToolSchema[];
  llmId: LlmProviderId;
  onStatus?: (status: string) => void;
  onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  onAudit?: () => void;
}

export class GatewayAgent {
  private guard: ToolGuard;
  private mcp: McpHttpClient;
  private jwt: string;
  private messages: ChatMessage[] = [];
  private sessionId = "";
  private readonly serverId: string;
  private readonly tools: LlmToolSchema[];
  private llmId: LlmProviderId;
  private onStatus?: (status: string) => void;
  private onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  private onAudit?: () => void;

  constructor(private options: GatewayAgentOptions) {
    this.serverId = options.serverId;
    this.tools = options.tools;
    this.llmId = options.llmId;
    this.jwt = options.jwt;
    this.onStatus = options.onStatus;
    this.onMessage = options.onMessage;
    this.onAudit = options.onAudit;

    this.guard = new ToolGuard({
      config: options.guardConfig,
      publicKey: options.publicKeyPem,
      jwtIssuer: options.jwtIssuer,
      jwtAudience: options.jwtAudience,
      jwksUrl: options.jwksUrl,
    });
    this.mcp = new McpHttpClient({ url: options.mcpUrl, bearerToken: options.jwt });
  }

  setToken(jwt: string): void {
    this.jwt = jwt;
    this.mcp.setBearerToken(jwt);
  }

  setLlmId(id: LlmProviderId): void {
    this.llmId = id;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async init(): Promise<void> {
    await this.guard.init();
    const runner = createLlmRunner(this.llmId);
    if (!runner.configured) {
      throw new Error(`${runner.label} is not configured`);
    }
    this.onStatus?.(`Loading ${runner.label}…`);
    await runner.init();
    await this.mcp.initialize();
    this.sessionId = newSessionId();
    this.onStatus?.("Ready");
  }

  private async pushAgentAudit(entry: AuditLogEntry): Promise<void> {
    try {
      await postAgentAudit([{ ...entry, source: "agent" }]);
      this.onAudit?.();
    } catch (err) {
      console.warn("postAgentAudit failed", err);
    }
  }

  private async executeTool(
    tool: string,
    args: Record<string, unknown>,
    intent: string,
  ): Promise<string> {
    const traceId = newTraceId();
    this.onStatus?.(`Calling ${tool}…`);

    const auth = await this.guard.authorize(this.serverId, tool, this.jwt, {
      session_id: this.sessionId,
      trace_id: traceId,
      intent,
    });

    auth.entry.reached_server = auth.allowed;
    auth.entry.intent = intent;
    await this.pushAgentAudit(auth.entry);

    if (!auth.allowed) {
      return `Blocked before MCP: ${auth.reason}`;
    }

    try {
      const result = await this.mcp.callTool(tool, args, {
        session_id: this.sessionId,
        trace_id: traceId,
      });
      this.onAudit?.();
      return `Tool \`${tool}\` result:\n${result}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onAudit?.();
      return `Tool error: ${message}`;
    }
  }

  async chat(userMessage: string): Promise<string> {
    const runner = createLlmRunner(this.llmId);
    if (!runner.configured) throw new Error(`${runner.label} is not configured`);

    this.onMessage?.("user", userMessage);
    this.messages.push({ role: "user", content: userMessage });

    this.onStatus?.("Thinking…");
    const completion = await runner.complete(this.messages, this.tools);

    if (completion.toolCall) {
      const { name, arguments: args } = completion.toolCall;
      const reply = await this.executeTool(name, args, userMessage);
      this.messages.push({ role: "assistant", content: reply });
      this.onMessage?.("assistant", reply);
      this.onStatus?.("Ready");
      return reply;
    }

    const text = completion.text ?? "(no response)";
    this.messages.push({ role: "assistant", content: text });
    this.onMessage?.("assistant", text);
    this.onStatus?.("Ready");
    return text;
  }
}
