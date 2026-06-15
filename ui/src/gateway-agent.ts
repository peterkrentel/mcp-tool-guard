import { ToolGuard } from "@mcp-tool-guard/gateway";
import type { AuditLogEntry, GuardConfig } from "@mcp-tool-guard/gateway";

import { createLlmRunner } from "./llm/providers.js";
import type { ChatMessage, LlmProviderId, LlmRunner, LlmToolSchema } from "./llm/types.js";
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
  private llmRunner: LlmRunner | null = null;
  private onStatus?: (status: string) => void;
  private onMessage?: (role: "user" | "assistant" | "system", content: string) => void;
  private onAudit?: () => void;
  private pendingApprovalState: { pendingId: string; approvalToken?: string } | null = null;

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
    if (id !== this.llmId) {
      this.llmId = id;
      this.llmRunner = null;
    }
  }

  private async ensureLlmRunner(): Promise<LlmRunner> {
    if (this.llmRunner) return this.llmRunner;
    const runner = createLlmRunner(this.llmId);
    if (!runner.configured) {
      throw new Error(`${runner.label} is not configured`);
    }
    this.onStatus?.(`Loading ${runner.label}…`);
    await runner.init();
    this.llmRunner = runner;
    return runner;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async init(): Promise<void> {
    await this.guard.init();
    await this.ensureLlmRunner();
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

      // Check for pending approval response
      if (
        typeof result === "object" &&
        result !== null &&
        (result as Record<string, unknown>).result &&
        typeof (result as Record<string, unknown>).result === "object"
      ) {
        const innerResult = (result as Record<string, unknown>).result as Record<string, unknown>;
        if (innerResult.status === "pending" && innerResult.pending_id) {
          this.pendingApprovalState = {
            pendingId: innerResult.pending_id as string,
          };
          return `Pending approval: ${innerResult.pending_id}\nWaiting for admin approval to proceed…`;
        }
      }

      this.onAudit?.();
      return `Tool \`${tool}\` result:\n${result}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onAudit?.();
      return `Tool error: ${message}`;
    }
  }

  /** Poll for approval and retry tool call when approved. */
  async retryApprovedTool(tool: string, args: Record<string, unknown>, intent: string): Promise<string> {
    if (!this.pendingApprovalState) {
      return "No pending approval to retry";
    }

    const { pendingId } = this.pendingApprovalState;
    const maxAttempts = 60; // 60 seconds of polling
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      this.onStatus?.(`Polling for approval… (${attempt}s)`);

      try {
        // Fetch pending status from proxy
        const response = await fetch(
          this.options.mcpUrl.replace(/\/mcp\/?$/, "") + `/pending/${encodeURIComponent(pendingId)}`,
          {
            headers: {
              Authorization: `Bearer ${this.jwt}`,
            },
          },
        );

        if (response.ok) {
          const data = (await response.json()) as any;
          if (data.pending?.status === "approved" && data.approval_token) {
            this.onStatus?.("Approval received! Retrying…");
            this.mcp.setApprovalToken(data.approval_token);
            const result = await this.mcp.callTool(tool, args, {
              session_id: this.sessionId,
              trace_id: newTraceId(),
            });
            this.mcp.clearApprovalToken();
            this.pendingApprovalState = null;
            this.onAudit?.();
            return `Tool \`${tool}\` result:\n${result}`;
          }
        }
      } catch (err) {
        console.warn("Polling failed:", err);
      }

      // Wait 1 second before next poll
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return "Approval timeout after 60 seconds";
  }

  async chat(userMessage: string): Promise<string> {
    const runner = await this.ensureLlmRunner();

    this.onMessage?.("user", userMessage);
    this.messages.push({ role: "user", content: userMessage });

    this.onStatus?.("Thinking…");
    const completion = await runner.complete(this.messages, this.tools);

    if (completion.toolCall) {
      const { name, arguments: args } = completion.toolCall;
      const reply = await this.executeTool(name, args, userMessage);
      
      if (reply.startsWith("Pending approval:")) {
        this.onStatus?.("Awaiting approval…");
        this.messages.push({ role: "assistant", content: reply });
        this.onMessage?.("assistant", reply);
        // Poll for admin approval, then retry with approval token
        const retryResult = await this.retryApprovedTool(name, args, userMessage);
        this.messages.push({ role: "assistant", content: retryResult });
        this.onMessage?.("assistant", retryResult);
        this.onStatus?.("Ready");
        return retryResult;
      }
      
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
