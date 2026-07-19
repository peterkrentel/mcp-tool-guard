import type { IncomingMessage, ServerResponse } from "node:http";

import { corsAllowOrigins } from "./env.js";

export function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origins = corsAllowOrigins();
  const origin = header(req, "origin");
  if (origin && (origins.includes("*") || origins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, X-Trace-Id, X-Session-Id, X-Approval-Token, X-Pending-Token, X-Agent-Id, X-Wait-For-Approval",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export async function readBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  return JSON.parse(body.toString("utf8")) as T;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(payload)));
  res.end(payload);
}

export function sendJsonRpcError(
  res: ServerResponse,
  requestId: unknown,
  message: string,
  status = 403,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId ?? null,
    error: { code: -32001, message },
  });
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}

export function sendJsonRpcPending(
  res: ServerResponse,
  requestId: unknown,
  pendingId: string,
  pendingPollToken: string,
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId ?? null,
    result: {
      status: "pending",
      pending_id: pendingId,
      pending_poll_token: pendingPollToken,
      message: "Awaiting approval",
    },
  });
  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}