import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";

import {
  buildToolSystemPrompt,
  parseToolCallFromText,
  type ChatMessage,
  type LlmCompletion,
  type LlmProviderMeta,
  type LlmProviderId,
  type LlmRunner,
  type LlmToolSchema,
} from "./types.js";

const WEBLLM_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

function messagesToPrompt(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

class WebLlmRunner implements LlmRunner {
  readonly id = "webllm" as const;
  readonly label = "WebLLM (browser)";
  readonly configured = true;
  private engine: MLCEngineInterface | null = null;

  async init(): Promise<void> {
    if (this.engine) return;
    this.engine = await CreateMLCEngine(WEBLLM_MODEL, {
      initProgressCallback: (p) => {
        console.info("[WebLLM]", p.text);
      },
    });
  }

  async complete(messages: ChatMessage[], tools: LlmToolSchema[]): Promise<LlmCompletion> {
    if (!this.engine) throw new Error("WebLLM not initialized");
    const system = messages.find((m) => m.role === "system");
    const rest = messages.filter((m) => m.role !== "system");
    const prompt = [
      system?.content ?? buildToolSystemPrompt(tools),
      messagesToPrompt(rest),
      "ASSISTANT:",
    ].join("\n\n");
    const reply = await this.engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
    });
    const text = reply.choices[0]?.message?.content ?? "";
    const toolCall = parseToolCallFromText(text);
    if (toolCall) return { toolCall };
    return { text };
  }
}

async function openAiStyleComplete(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

class GroqRunner implements LlmRunner {
  readonly id = "groq" as const;
  readonly label = "Groq (Llama 3.1 8B)";
  readonly configured;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.configured = Boolean(apiKey);
  }

  async init(): Promise<void> {}

  async complete(messages: ChatMessage[], tools: LlmToolSchema[]): Promise<LlmCompletion> {
    const withSystem = messages.some((m) => m.role === "system")
      ? messages
      : [{ role: "system" as const, content: buildToolSystemPrompt(tools) }, ...messages];
    const text = await openAiStyleComplete(
      "https://api.groq.com/openai/v1/chat/completions",
      this.apiKey,
      "llama-3.1-8b-instant",
      withSystem,
    );
    const toolCall = parseToolCallFromText(text);
    if (toolCall) return { toolCall };
    return { text };
  }
}

class MistralRunner implements LlmRunner {
  readonly id = "mistral" as const;
  readonly label = "Mistral 7B";
  readonly configured;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.configured = Boolean(apiKey);
  }

  async init(): Promise<void> {}

  async complete(messages: ChatMessage[], tools: LlmToolSchema[]): Promise<LlmCompletion> {
    const withSystem = messages.some((m) => m.role === "system")
      ? messages
      : [{ role: "system" as const, content: buildToolSystemPrompt(tools) }, ...messages];
    const text = await openAiStyleComplete(
      "https://api.mistral.ai/v1/chat/completions",
      this.apiKey,
      "mistral-small-latest",
      withSystem,
    );
    const toolCall = parseToolCallFromText(text);
    if (toolCall) return { toolCall };
    return { text };
  }
}

/**
 * GeminiRunner — routes completions through the gateway's POST /llm/complete endpoint.
 * GEMINI_API_KEY lives on the server; the browser never sees it.
 * If the gateway health check reports gemini_configured=false we mark this
 * runner as not configured.
 */
class GeminiRunner implements LlmRunner {
  readonly id = "gemini" as const;
  readonly label = "Gemini Flash";
  configured: boolean;

  constructor(configured: boolean) {
    this.configured = configured;
  }

  async init(): Promise<void> {}

  async complete(messages: ChatMessage[], tools: LlmToolSchema[]): Promise<LlmCompletion> {
    const { resolveProxyBase } = await import("../config.js");
    const base = resolveProxyBase();
    const res = await fetch(`${base}/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini proxy ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      text?: string;
      toolCall?: { name: string; arguments: Record<string, unknown> };
    };
    if (data.toolCall) return { toolCall: data.toolCall };
    return { text: data.text ?? "" };
  }
}

export function listLlmProviders(): LlmProviderMeta[] {
  const groq = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  const mistral = import.meta.env.VITE_MISTRAL_API_KEY as string | undefined;
  return [
    { id: "webllm", label: "WebLLM (browser)", configured: true },
    {
      id: "gemini",
      label: "Gemini Flash",
      // configured is detected from /health at runtime — default true for the list
      configured: true,
    },
    {
      id: "groq",
      label: "Groq (Llama 3.1 8B)",
      configured: Boolean(groq?.trim()),
      hint: groq?.trim() ? undefined : "add VITE_GROQ_API_KEY to .env.local",
    },
    {
      id: "mistral",
      label: "Mistral 7B",
      configured: Boolean(mistral?.trim()),
      hint: mistral?.trim() ? undefined : "add VITE_MISTRAL_API_KEY to .env.local",
    },
  ];
}

export function createLlmRunner(id: LlmProviderId, opts: { geminiConfigured?: boolean } = {}): LlmRunner {
  switch (id) {
    case "webllm":
      return new WebLlmRunner();
    case "groq":
      return new GroqRunner(String(import.meta.env.VITE_GROQ_API_KEY ?? "").trim());
    case "mistral":
      return new MistralRunner(String(import.meta.env.VITE_MISTRAL_API_KEY ?? "").trim());
    case "gemini":
      return new GeminiRunner(opts.geminiConfigured ?? true);
    default:
      throw new Error(`Unknown LLM provider: ${id}`);
  }
}
