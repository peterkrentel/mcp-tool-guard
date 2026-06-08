export type LlmProviderId = "webllm" | "gemini" | "groq" | "mistral";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmToolSchema {
  name: string;
  description?: string;
}

export interface LlmToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmCompletion {
  text?: string;
  toolCall?: LlmToolCall;
}

export interface LlmProviderMeta {
  id: LlmProviderId;
  label: string;
  configured: boolean;
  hint?: string;
}

export interface LlmRunner {
  readonly id: LlmProviderId;
  readonly label: string;
  readonly configured: boolean;
  init(): Promise<void>;
  complete(messages: ChatMessage[], tools: LlmToolSchema[]): Promise<LlmCompletion>;
}

export function buildToolSystemPrompt(tools: LlmToolSchema[]): string {
  const lines = tools.map(
    (t) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`,
  );
  return [
    "You are an AI agent that may call MCP tools.",
    "Available tools:",
    ...lines,
    'To call a tool, respond with ONLY JSON: {"tool":"<name>","arguments":{...}}',
    "For normal chat, respond with plain text (no JSON).",
  ].join("\n");
}

export function parseToolCallFromText(text: string): LlmToolCall | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      tool?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
    const name = parsed.tool ?? parsed.name;
    if (!name || typeof name !== "string") return null;
    return { name, arguments: parsed.arguments ?? {} };
  } catch {
    return null;
  }
}
