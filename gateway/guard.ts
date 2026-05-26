import { importSPKI, jwtVerify } from "jose";
import { parse as parseYaml } from "yaml";

import { AuditLogger } from "./logger.js";
import type {
  AuditLogEntry,
  GuardConfig,
  GuardResult,
  JwtPayload,
  ServerConfig,
  ToolConfig,
} from "./types.js";

export interface ToolGuardOptions {
  config: GuardConfig | string;
  publicKey?: CryptoKey | string;
  algorithm?: string;
  logger?: AuditLogger;
}

export class ToolGuard {
  private config: GuardConfig;
  private publicKey?: CryptoKey;
  private algorithm: string;
  readonly logger: AuditLogger;

  constructor(options: ToolGuardOptions) {
    this.config =
      typeof options.config === "string"
        ? (parseYaml(options.config) as GuardConfig)
        : options.config;
    this.algorithm = options.algorithm ?? "RS256";
    this.logger = options.logger ?? new AuditLogger();
    if (options.publicKey && typeof options.publicKey === "string") {
      this.publicKeyPromise = importSPKI(options.publicKey, this.algorithm);
    } else if (options.publicKey && typeof options.publicKey !== "string") {
      this.publicKey = options.publicKey;
    }
  }

  private publicKeyPromise?: Promise<CryptoKey>;

  async init(): Promise<void> {
    if (this.publicKeyPromise) {
      this.publicKey = await this.publicKeyPromise;
    }
  }

  getServerConfig(server: string): ServerConfig | undefined {
    return this.config.servers[server];
  }

  getToolConfig(server: string, tool: string): ToolConfig | undefined {
    return this.config.servers[server]?.tools[tool];
  }

  listServers(): string[] {
    return Object.keys(this.config.servers);
  }

  listTools(server: string): string[] {
    const cfg = this.config.servers[server];
    return cfg ? Object.keys(cfg.tools) : [];
  }

  extractScopes(payload: JwtPayload): string[] {
    const raw = payload.scope ?? payload.scopes ?? payload.scp;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    return String(raw).split(/[\s,]+/).filter(Boolean);
  }

  hasScope(tokenScopes: string[], required: string): boolean {
    if (tokenScopes.includes(required)) return true;
    const [resource] = required.split(":");
    return tokenScopes.includes(`${resource}:*`) || tokenScopes.includes("*");
  }

  async validateToken(token: string): Promise<{ payload: JwtPayload; scopes: string[] }> {
    if (!this.publicKey) {
      throw new Error("Public key not configured — call init() with a PEM key");
    }
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: [this.algorithm],
    });
    const jwtPayload = payload as JwtPayload;
    return { payload: jwtPayload, scopes: this.extractScopes(jwtPayload) };
  }

  checkScope(
    server: string,
    tool: string,
    tokenScopes: string[],
  ): GuardResult {
    const toolConfig = this.getToolConfig(server, tool);
    const timestamp = new Date().toISOString();

    if (!toolConfig) {
      const entry: AuditLogEntry = {
        timestamp,
        decision: "deny",
        server,
        tool,
        required_scope: "(unknown)",
        token_scopes: tokenScopes,
        reason: `Tool '${tool}' not configured for server '${server}'`,
      };
      this.logger.log(entry);
      return { allowed: false, reason: entry.reason, required_scope: "(unknown)", entry };
    }

    const required = toolConfig.required_scope;
    const allowed = this.hasScope(tokenScopes, required);

    const entry: AuditLogEntry = {
      timestamp,
      decision: allowed ? "allow" : "deny",
      server,
      tool,
      required_scope: required,
      token_scopes: tokenScopes,
      alert: toolConfig.alert,
      log_level: toolConfig.log_level,
      reason: allowed
        ? undefined
        : `Missing required scope '${required}'`,
    };

    this.logger.log(entry);
    return {
      allowed,
      reason: entry.reason,
      required_scope: required,
      entry,
    };
  }

  async authorize(
    server: string,
    tool: string,
    token: string,
  ): Promise<GuardResult> {
    const start = performance.now();
    try {
      const { scopes } = await this.validateToken(token);
      const result = this.checkScope(server, tool, scopes);
      result.entry.duration_ms = Math.round(performance.now() - start);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        decision: "deny",
        server,
        tool,
        required_scope: this.getToolConfig(server, tool)?.required_scope ?? "(unknown)",
        token_scopes: [],
        reason: `JWT validation failed: ${message}`,
        duration_ms: Math.round(performance.now() - start),
      };
      this.logger.log(entry);
      return {
        allowed: false,
        reason: entry.reason,
        required_scope: entry.required_scope,
        entry,
      };
    }
  }
}
