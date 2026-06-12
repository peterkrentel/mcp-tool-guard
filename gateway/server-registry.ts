import type { GuardConfig, ServerConfig, ToolConfig } from "./types.js";

export interface RegisteredServerView {
  id: string;
  url: string;
  scopes: Record<string, string[]>;
}

export interface AddServerInput {
  id: string;
  url: string;
  scopes: Record<string, string[]>;
}

function scopesToTools(scopes: Record<string, string[]>): Record<string, ToolConfig> {
  const tools: Record<string, ToolConfig> = {};
  for (const [toolName, scopeList] of Object.entries(scopes)) {
    const required = scopeList[0]?.trim();
    if (!required) continue;
    tools[toolName] = { required_scope: required };
  }
  return tools;
}

function toolsToScopes(tools: Record<string, ToolConfig>): Record<string, string[]> {
  const scopes: Record<string, string[]> = {};
  for (const [name, cfg] of Object.entries(tools)) {
    scopes[name] = [cfg.required_scope];
  }
  return scopes;
}

function copyServerConfig(cfg: ServerConfig): ServerConfig {
  return {
    url: cfg.url,
    tools: { ...cfg.tools },
    ...(cfg.upstream_token_env ? { upstream_token_env: cfg.upstream_token_env } : {}),
    ...(cfg.upstream_token ? { upstream_token: cfg.upstream_token } : {}),
  };
}

/** In-memory MCP server registry — seeded from yaml, extended at runtime. */
export class ServerRegistry {
  private servers = new Map<string, ServerConfig>();

  constructor(seed?: GuardConfig) {
    if (seed?.servers) {
      for (const [id, cfg] of Object.entries(seed.servers)) {
        this.servers.set(id, copyServerConfig(cfg));
      }
    }
  }

  toGuardConfig(): GuardConfig {
    const servers: Record<string, ServerConfig> = {};
    for (const [id, cfg] of this.servers) {
      servers[id] = { url: cfg.url, tools: { ...cfg.tools } };
    }
    return { servers };
  }

  getServer(id: string): ServerConfig | undefined {
    const cfg = this.servers.get(id);
    if (!cfg) return undefined;
    return copyServerConfig(cfg);
  }

  list(): RegisteredServerView[] {
    return [...this.servers.entries()].map(([id, cfg]) => ({
      id,
      url: cfg.url,
      scopes: toolsToScopes(cfg.tools),
    }));
  }

  add(input: AddServerInput): { ok: true; id: string } | { ok: false; error: string } {
    const id = input.id.trim();
    const url = input.url.trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return { ok: false, error: "id must be non-empty alphanumeric (hyphen/underscore ok)" };
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, error: "url must be http(s)" };
    }
    const tools = scopesToTools(input.scopes ?? {});
    if (Object.keys(tools).length === 0) {
      return { ok: false, error: "scopes must include at least one tool with a scope" };
    }
    this.servers.set(id, { url, tools });
    return { ok: true, id };
  }

  remove(id: string): boolean {
    return this.servers.delete(id);
  }

  serverIds(): string[] {
    return [...this.servers.keys()];
  }
}
