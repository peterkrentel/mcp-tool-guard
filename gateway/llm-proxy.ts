/**
 * Server-side LLM proxy — Gemini Flash via gateway.
 * Keeps API key off the browser. Rate-limited by the main proxy rate limiter.
 *
 * POST /llm/complete
 *   Body: { messages: ChatMessage[], tools?: LlmToolSchema[] }
 *   Returns: { text?: string, toolCall?: { name, arguments } }
 */

export interface LlmMessage {
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

export interface LlmCompleteRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
}

export interface LlmCompleteResponse {
  text?: string;
  toolCall?: LlmToolCall;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function geminiComplete(
  req: LlmCompleteRequest,
): Promise<LlmCompleteResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured on gateway");

  const { messages, tools = [] } = req;

  const withSystem = messages.some((m) => m.role === "system")
    ? messages
    : [
        {
          role: "system" as const,
          content: buildToolSystemPrompt(tools),
        },
        ...messages,
      ];

  const contents = withSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const toolDefinitions = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: {
      type: "object" as const,
      properties: {
        args: { type: "object", description: "Tool arguments" },
      },
      required: ["args"],
    },
  }));

  const payload = {
    contents,
    ...(tools.length > 0 && {
      tools: [{ functionDeclarations: toolDefinitions }],
    }),
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          functionCall?: { name?: string; args?: Record<string, unknown> };
          text?: string;
        }>;
      };
    }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    if (part.functionCall?.name) {
      const rawArgs = (part.functionCall.args ?? {}) as Record<string, unknown>;
      // Unwrap the { args: {...} } wrapper from our schema
      const args =
        rawArgs.args !== null &&
        typeof rawArgs.args === "object" &&
        !Array.isArray(rawArgs.args) &&
        Object.keys(rawArgs).length === 1
          ? (rawArgs.args as Record<string, unknown>)
          : rawArgs;
      return { toolCall: { name: part.functionCall.name, arguments: args } };
    }
  }

  const text = parts.find((p) => p.text)?.text ?? "";
  return { text };
}

function buildToolSystemPrompt(tools: LlmToolSchema[]): string {
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
