import type { GuardConfig, ServerConfig } from "./types.js";

/** Resolve upstream_token from upstream_token_env — secrets never live in yaml. */
export function resolveServerConfig(cfg: ServerConfig): ServerConfig {
  const resolved: ServerConfig = {
    url: cfg.url,
    tools: { ...cfg.tools },
    ...(cfg.upstream_token_env ? { upstream_token_env: cfg.upstream_token_env } : {}),
  };

  const envName = cfg.upstream_token_env?.trim();
  if (envName) {
    const token = process.env[envName]?.trim();
    if (token) resolved.upstream_token = token;
  }

  return resolved;
}

export function resolveGuardConfig(raw: GuardConfig): GuardConfig {
  const servers: Record<string, ServerConfig> = {};
  for (const [id, cfg] of Object.entries(raw.servers ?? {})) {
    servers[id] = resolveServerConfig(cfg);
  }
  return { servers };
}

/** Servers with upstream_token_env set but env var missing (for /health). */
export function missingUpstreamEnvNames(servers: Iterable<ServerConfig>): string[] {
  const missing: string[] = [];
  for (const cfg of servers) {
    const envName = cfg.upstream_token_env?.trim();
    if (envName && !cfg.upstream_token) missing.push(envName);
  }
  return missing;
}
