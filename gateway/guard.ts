import {
  createRemoteJWKSet,
  decodeJwt,
  importSPKI,
  jwtVerify,
} from "jose";
import { parse as parseYaml } from "yaml";

import { AuditLogger } from "./logger.js";
import type {
  AuditContext,
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
  /** Optional server-side callback to enforce immediate M2M revocation after agent delete. */
  isM2mClientActive?: (clientId: string) => Promise<boolean>;
  /** IdP issuer — when token `iss` matches, verify via JWKS instead of PEM. */
  jwtIssuer?: string;
  jwtAudience?: string;
  jwksUrl?: string;
}

export class ToolGuard {
  private config: GuardConfig;
  private publicKey?: CryptoKey;
  private algorithm: string;
  readonly logger: AuditLogger;
  private jwtIssuer?: string;
  private jwtAudience?: string;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private isM2mClientActive?: (clientId: string) => Promise<boolean>;

  constructor(options: ToolGuardOptions) {
    this.config =
      typeof options.config === "string"
        ? (parseYaml(options.config) as GuardConfig)
        : options.config;
    this.algorithm = options.algorithm ?? "RS256";
    this.logger = options.logger ?? new AuditLogger();
    this.isM2mClientActive = options.isM2mClientActive;
    this.jwtIssuer = options.jwtIssuer?.replace(/\/$/, "");
    this.jwtAudience = options.jwtAudience;
    if (options.jwksUrl) {
      this.jwks = createRemoteJWKSet(new URL(options.jwksUrl));
    }
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

  /** Replace in-memory policy (runtime registry updates). */
  replaceConfig(config: GuardConfig): void {
    this.config = config;
  }

  extractScopes(payload: JwtPayload): string[] {
    const scopes: string[] = [];
    const raw = payload.scope ?? payload.scopes ?? payload.scp;
    if (raw) {
      if (Array.isArray(raw)) scopes.push(...raw.map(String));
      else scopes.push(...String(raw).split(/[\s,]+/).filter(Boolean));
    }
    if (Array.isArray(payload.permissions)) {
      scopes.push(...payload.permissions.map(String));
    }
    return [...new Set(scopes)];
  }

  hasScope(tokenScopes: string[], required: string): boolean {
    if (tokenScopes.includes(required)) return true;
    const [resource] = required.split(":");
    return tokenScopes.includes(`${resource}:*`) || tokenScopes.includes("*");
  }

  private issMatches(tokenIss: unknown): boolean {
    if (!this.jwtIssuer || typeof tokenIss !== "string") return false;
    return tokenIss.replace(/\/$/, "") === this.jwtIssuer;
  }

  private isM2mLikeToken(payload: JwtPayload): boolean {
    // Primary signal: Auth0 M2M token subject/client-id shape.
    // Secondary signal: explicit grant type claim when present.
    return this.clientIdFromPayload(payload) !== null || payload.gty === "client-credentials";
  }

  private clientIdFromPayload(payload: JwtPayload): string | null {
    if (typeof payload.client_id === "string" && payload.client_id.trim()) {
      return payload.client_id.trim();
    }
    if (typeof payload.sub === "string") {
      const match = payload.sub.match(/^([^@]+)@clients$/);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  private async assertActiveM2mAgent(payload: JwtPayload): Promise<void> {
    if (!this.isM2mLikeToken(payload)) return;
    const clientId = this.clientIdFromPayload(payload);
    if (!clientId) {
      throw new Error("M2M token missing client_id/sub claim shape");
    }
    if (!this.isM2mClientActive) return;
    const active = await this.isM2mClientActive(clientId);
    if (!active) {
      throw new Error("Agent revoked or deleted");
    }
  }

  async validateToken(token: string): Promise<{ payload: JwtPayload; scopes: string[] }> {
    const unverified = decodeJwt(token) as JwtPayload;
    if (
      this.jwks &&
      this.jwtIssuer &&
      this.jwtAudience &&
      this.issMatches(unverified.iss)
    ) {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${this.jwtIssuer}/`,
        audience: this.jwtAudience,
      });
      const jwtPayload = payload as JwtPayload;
      await this.assertActiveM2mAgent(jwtPayload);
      return { payload: jwtPayload, scopes: this.extractScopes(jwtPayload) };
    }

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
    audit?: AuditContext,
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
        ...audit,
        source: audit?.source ?? "proxy",
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
      ...audit,
      source: audit?.source ?? "proxy",
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
    audit?: AuditContext,
  ): Promise<GuardResult> {
    const start = performance.now();
    try {
      const { scopes } = await this.validateToken(token);
      const result = this.checkScope(server, tool, scopes, audit);
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
        ...audit,
        source: audit?.source ?? "proxy",
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
