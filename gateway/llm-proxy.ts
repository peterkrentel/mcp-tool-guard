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

  // Gemini REST v1 doesn't support native function declarations —
  // use system-prompt + JSON text parsing (same approach as Groq/Mistral).
  const contents = withSystem.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const payload = { contents };

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";

  // Parse tool call from JSON text ({"tool":"<name>","arguments":{...}})
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { tool?: string; arguments?: Record<string, unknown> };
      if (parsed.tool) {
        return { toolCall: { name: parsed.tool, arguments: parsed.arguments ?? {} } };
      }
    } catch {
      // Not JSON — fall through to plain text
    }
  }

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
