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
