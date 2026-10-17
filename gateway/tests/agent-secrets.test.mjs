import assert from "node:assert/strict";
import { test } from "node:test";

const { canEncryptAgentSecrets, encryptClientSecret, decryptClientSecret } = await import(
  "../dist/agent-secrets.js"
);

const KEYS = ["GATEWAY_AGENT_SECRET_KEY", "AUTH0_MGMT_CLIENT_SECRET", "ENTRA_CLIENT_SECRET"];

function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("Entra-only deployment can encrypt and decrypt agent secrets", () => {
  withEnv({ ENTRA_CLIENT_SECRET: "entra-mgmt-secret" }, () => {
    assert.equal(canEncryptAgentSecrets(), true);
    assert.equal(decryptClientSecret(encryptClientSecret("agent-secret")), "agent-secret");
  });
});

test("no key material at all fails with a message naming every option", () => {
  withEnv({}, () => {
    assert.equal(canEncryptAgentSecrets(), false);
    assert.throws(() => encryptClientSecret("x"), /ENTRA_CLIENT_SECRET/);
  });
});

test("Auth0 secret still wins over Entra so existing records keep decrypting", () => {
  const encrypted = withEnv({ AUTH0_MGMT_CLIENT_SECRET: "auth0-secret" }, () =>
    encryptClientSecret("agent-secret"),
  );
  withEnv({ AUTH0_MGMT_CLIENT_SECRET: "auth0-secret", ENTRA_CLIENT_SECRET: "entra-secret" }, () => {
    assert.equal(decryptClientSecret(encrypted), "agent-secret");
  });
});
