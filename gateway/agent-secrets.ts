/**
 * Encrypt M2M client secrets at rest in KV (AES-256-GCM).
 * Key: GATEWAY_AGENT_SECRET_KEY, else AUTH0_MGMT_CLIENT_SECRET (Render already has this).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SCRYPT_SALT = "mcp-tool-guard:agent-secret:v1";

function deriveKey(): Buffer | null {
  const raw =
    process.env.GATEWAY_AGENT_SECRET_KEY?.trim() ||
    process.env.AUTH0_MGMT_CLIENT_SECRET?.trim();
  if (!raw) return null;
  return scryptSync(raw, SCRYPT_SALT, 32);
}

export function canEncryptAgentSecrets(): boolean {
  return deriveKey() !== null;
}

export function encryptClientSecret(plaintext: string): string {
  const key = deriveKey();
  if (!key) {
    throw new Error(
      "Agent secret encryption unavailable — set GATEWAY_AGENT_SECRET_KEY or AUTH0_MGMT_CLIENT_SECRET",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptClientSecret(encoded: string): string {
  const key = deriveKey();
  if (!key) {
    throw new Error("Agent secret encryption unavailable");
  }
  const buf = Buffer.from(encoded, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
