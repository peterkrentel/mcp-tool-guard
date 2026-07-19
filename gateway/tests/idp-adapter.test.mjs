import assert from "node:assert/strict";
import { test } from "node:test";

import { Auth0IdpAdapter } from "../dist/idp-adapter.js";

const ENV_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_MGMT_CLIENT_ID",
  "AUTH0_MGMT_CLIENT_SECRET",
  "AUTH0_AUDIENCE",
];

function clearAuth0Env() {
  const saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

test("Auth0IdpAdapter reports providerId 'auth0'", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.providerId, "auth0");
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isManagementConfigured() is false when AUTH0_MGMT_* unset", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isManagementConfigured(), false);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isVendingConfigured() is false when AUTH0_DOMAIN/AUDIENCE unset", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isVendingConfigured(), false);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.isVendingConfigured() is true when AUTH0_DOMAIN/AUDIENCE set", () => {
  const restore = clearAuth0Env();
  try {
    process.env.AUTH0_DOMAIN = "example.auth0.com";
    process.env.AUTH0_AUDIENCE = "https://example.com/api";
    const adapter = new Auth0IdpAdapter();
    assert.equal(adapter.isVendingConfigured(), true);
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.createAgent() rejects with existing message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.createAgent("test-agent", ["flights:read"]),
      /Auth0 Management API not configured — set AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_AUDIENCE/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.deleteAgent() rejects with existing message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.deleteAgent("some-client-id"),
      /Auth0 Management API not configured/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.vendToken() rejects when vending not configured", async () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    await assert.rejects(
      adapter.vendToken("client-id", "client-secret"),
      /AUTH0_DOMAIN and AUTH0_AUDIENCE required for token vending/,
    );
  } finally {
    restore();
  }
});

test("Auth0IdpAdapter.invalidateToken() does not throw when vending not configured", () => {
  const restore = clearAuth0Env();
  try {
    const adapter = new Auth0IdpAdapter();
    assert.doesNotThrow(() => adapter.invalidateToken("client-id"));
  } finally {
    restore();
  }
});

import { buildIdpAdapter } from "../dist/idp-adapter.js";
import { idpProviderIdFromEnv } from "../dist/env.js";

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

test("idpProviderIdFromEnv() defaults to 'auth0' when MCP_IDP_PROVIDER unset", () => {
  withEnv("MCP_IDP_PROVIDER", undefined, () => {
    assert.equal(idpProviderIdFromEnv(), "auth0");
  });
});

test("idpProviderIdFromEnv() returns explicit value when set", () => {
  withEnv("MCP_IDP_PROVIDER", "keycloak", () => {
    assert.equal(idpProviderIdFromEnv(), "keycloak");
  });
});

test("idpProviderIdFromEnv() is case-insensitive", () => {
  withEnv("MCP_IDP_PROVIDER", "Auth0", () => {
    assert.equal(idpProviderIdFromEnv(), "auth0");
  });
});

test("idpProviderIdFromEnv() throws on an unrecognized value", () => {
  withEnv("MCP_IDP_PROVIDER", "okta", () => {
    assert.throws(() => idpProviderIdFromEnv(), /Unrecognized MCP_IDP_PROVIDER 'okta'/);
  });
});

test("buildIdpAdapter('auth0') returns an Auth0IdpAdapter", () => {
  const adapter = buildIdpAdapter("auth0");
  assert.equal(adapter.providerId, "auth0");
});

test("buildIdpAdapter('keycloak') throws not-yet-implemented", () => {
  assert.throws(() => buildIdpAdapter("keycloak"), /keycloak.*not yet implemented/i);
});

test("buildIdpAdapter('entra') throws not-yet-implemented", () => {
  assert.throws(() => buildIdpAdapter("entra"), /entra.*not yet implemented/i);
});

test("dist/index.js exports the IdpAdapter public surface", async () => {
  const indexModule = await import("../dist/index.js");
  assert.equal(typeof indexModule.Auth0IdpAdapter, "function");
  assert.equal(typeof indexModule.buildIdpAdapter, "function");
});
