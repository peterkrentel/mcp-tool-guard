import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EntraTokenVendor,
  entraTokenVendorFromEnv,
  entraApiAppIdFromEnv,
} from "../dist/entra-token-vendor.js";

function withEnv(key, value, fn) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}

test("entraTokenVendorFromEnv() returns null when ENTRA_TENANT_ID unset", () => {
  withEnv("ENTRA_TENANT_ID", undefined, () => {
    assert.equal(entraTokenVendorFromEnv(), null);
  });
});

test("entraTokenVendorFromEnv() returns an EntraTokenVendor when ENTRA_TENANT_ID set", () => {
  withEnv("ENTRA_TENANT_ID", "test-tenant-id", () => {
    const vendor = entraTokenVendorFromEnv();
    assert.ok(vendor instanceof EntraTokenVendor);
  });
});

test("entraApiAppIdFromEnv() returns null when ENTRA_API_APP_ID unset", () => {
  withEnv("ENTRA_API_APP_ID", undefined, () => {
    assert.equal(entraApiAppIdFromEnv(), null);
  });
});

test("entraApiAppIdFromEnv() returns trimmed value when set", () => {
  withEnv("ENTRA_API_APP_ID", "  api-app-id  ", () => {
    assert.equal(entraApiAppIdFromEnv(), "api-app-id");
  });
});

test("EntraTokenVendor.vend() caches token until expiry skew", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ access_token: `token-${callCount}`, expires_in: 3600 }),
    };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    const first = await vendor.vend("client-id", "client-secret", "api-app-id");
    const second = await vendor.vend("client-id", "client-secret", "api-app-id");
    assert.equal(first.token, "token-1");
    assert.equal(second.token, "token-1");
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("EntraTokenVendor.invalidate() forces a re-fetch on next vend()", async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({ access_token: `token-${callCount}`, expires_in: 3600 }),
    };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    await vendor.vend("client-id", "client-secret", "api-app-id");
    vendor.invalidate("client-id");
    const second = await vendor.vend("client-id", "client-secret", "api-app-id");
    assert.equal(second.token, "token-2");
    assert.equal(callCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("EntraTokenVendor.vend() throws with response body on non-ok response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => "invalid_client",
  });
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    await assert.rejects(
      vendor.vend("client-id", "client-secret", "api-app-id"),
      /Entra token request failed: 401 invalid_client/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

// Regression test for a live-tenant bug: a freshly-minted client secret is
// sometimes not yet valid for authentication (AADSTS7000215), even though
// the secret value itself is correct — reproduced twice on a real tenant
// immediately after createEntraAgent() finished. Must retry specifically
// this signature, not every 401 (a genuinely wrong secret uses the same
// error code, so this can't eliminate that case, but must not regress into
// masking it forever either — bounded retry, not infinite).
test("EntraTokenVendor.vend() retries an AADSTS7000215 (not-yet-propagated secret) and succeeds", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: "invalid_client",
            error_description:
              "AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app 'test-app-id'.",
          }),
      };
    }
    return { ok: true, json: async () => ({ access_token: "token-after-retry", expires_in: 3600 }) };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    const result = await vendor.vend("client-id", "client-secret", "api-app-id");
    assert.equal(result.token, "token-after-retry");
    assert.equal(attempts, 2, "expected exactly one retry after the AADSTS7000215 failure");
  } finally {
    global.fetch = originalFetch;
  }
});

test("EntraTokenVendor.vend() does not retry a 401 that isn't AADSTS7000215", async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    return { ok: false, status: 401, text: async () => "some other auth failure" };
  };
  try {
    const vendor = new EntraTokenVendor("test-tenant-id");
    await assert.rejects(
      vendor.vend("client-id", "client-secret", "api-app-id"),
      /Entra token request failed: 401 some other auth failure/,
    );
    assert.equal(attempts, 1, "must not retry a non-AADSTS7000215 401");
  } finally {
    global.fetch = originalFetch;
  }
});
