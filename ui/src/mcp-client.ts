export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface TraceHeaders {
  session_id?: string;
  trace_id?: string;
}

export interface McpClientOptions {
  url: string;
  headers?: Record<string, string>;
  bearerToken?: string;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

export class McpHttpClient {
  private url: string;
  private headers: Record<string, string>;
  private initialized = false;

  constructor(options: McpClientOptions) {
    this.url = options.url;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...options.headers,
    };
    if (options.bearerToken) {
      this.setBearerToken(options.bearerToken);
    }
  }

  setBearerToken(token: string): void {
    this.headers.Authorization = `Bearer ${token}`;
  }

  private unwrapJsonRpc(data: JsonRpcResponse): unknown {
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.result;
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) throw new Error("No SSE data in MCP response");
      return this.unwrapJsonRpc(JSON.parse(dataLine.slice(6)) as JsonRpcResponse);
    }

    return this.unwrapJsonRpc((await response.json()) as JsonRpcResponse);
  }

  private async request(
    method: string,
    params?: unknown,
    trace?: TraceHeaders,
  ): Promise<unknown> {
    const body = {
      jsonrpc: "2.0",
      id: nextId++,
      method,
      params,
    };

    const headers = { ...this.headers };
    if (trace?.trace_id) headers["X-Trace-Id"] = trace.trace_id;
    if (trace?.session_id) headers["X-Session-Id"] = trace.session_id;

    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== text && !parseErr.message.startsWith("MCP HTTP")) {
          throw parseErr;
        }
      }
      throw new Error(`MCP HTTP ${response.status}: ${text}`);
    }

    return this.parseResponse(response);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-tool-guard-ui", version: "0.1.0" },
    });
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = (await this.request("tools/list", {})) as { tools: McpTool[] };
    return result.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    trace?: TraceHeaders,
  ): Promise<string> {
    await this.initialize();
    const result = (await this.request("tools/call", { name, arguments: args }, trace)) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = result.content?.find((c) => c.type === "text")?.text;
    return text ?? JSON.stringify(result);
  }
}
