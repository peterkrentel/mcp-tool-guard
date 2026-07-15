import type { IncomingMessage, ServerResponse } from "node:http";

import { geminiComplete, geminiConfigured } from "./llm-proxy.js";
import { readJson, sendJson } from "./http-helpers.js";

export async function handleLlmCompleteRoute(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== "POST") return false;

  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/llm/complete") return false;

  if (!geminiConfigured()) {
    sendJson(res, 503, { error: "GEMINI_API_KEY not configured on gateway" });
    return true;
  }

  try {
    const body = await readJson<{ messages: unknown[]; tools?: unknown[] }>(req);
    const result = await geminiComplete(body as Parameters<typeof geminiComplete>[0]);
    console.info(`[MCPToolGuard] llm/complete -> ${result.toolCall ? `toolCall:${result.toolCall.name}` : "text"}`);
    sendJson(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[MCPToolGuard] llm/complete error: ${message}`);
    sendJson(res, 502, { error: message });
  }

  return true;
}