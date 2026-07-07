import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

function gatewayRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.endsWith(`${sep}dist`) ? resolve(here, "..") : here;
}

const gatewayDir = gatewayRoot();
const repoRoot = resolve(gatewayDir, "..");

export function readPublicKeyPem(): string {
  const inline = process.env.MCP_GUARD_PUBLIC_KEY_PEM?.trim();
  if (inline) {
    return inline.replace(/\\n/g, "\n");
  }

  const candidates = [
    resolve(repoRoot, "ui/public/demo-public.pem"),
    resolve(repoRoot, "keys/demo-public.pem"),
  ];

  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // try next
    }
  }

  throw new Error(
    "No JWT public key found. Set MCP_GUARD_PUBLIC_KEY_PEM or run `make keys`.",
  );
}

export function guardEnabled(): boolean {
  return process.env.MCP_GUARD_ENABLED?.toLowerCase() !== "false";
}

/** Explicit demo-mode escape hatch for browser audit ingest. */
export function auditAgentTrustedMode(): boolean {
  return process.env.MCP_AUDIT_AGENT_TRUSTED_MODE?.toLowerCase() === "true";
}

export function jwtTrustFromEnv(): {
  jwtIssuer?: string;
  jwtAudience?: string;
  jwksUrl?: string;
} {
  const issuer = process.env.MCP_JWT_ISSUER?.trim().replace(/\/$/, "");
  const audience = process.env.MCP_JWT_AUDIENCE?.trim();
  let jwksUrl = process.env.MCP_JWT_JWKS_URL?.trim();
  if (issuer && !jwksUrl) {
    jwksUrl = `${issuer}/.well-known/jwks.json`;
  }
  if (issuer && audience && jwksUrl) {
    return { jwtIssuer: issuer, jwtAudience: audience, jwksUrl };
  }
  return {};
}

export function corsAllowOrigins(): string[] {
  const raw = process.env.MCP_CORS_ORIGINS?.trim();
  if (raw === "*") return ["*"];
  if (raw) {
    return raw.split(",").map((s: string) => s.trim()).filter(Boolean);
  }
  return [
    "https://mcp-tool-guard-ui.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}
