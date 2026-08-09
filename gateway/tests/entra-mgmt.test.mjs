import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isEntraMgmtConfigured,
  createEntraAgent,
  deleteEntraAgent,
} from "../dist/entra-mgmt.js";

const ENV_KEYS = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_API_APP_ID"];

function clearEntraEnv() {
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

test("isEntraMgmtConfigured() is false when ENTRA_* unset", () => {
  const restore = clearEntraEnv();
  try {
    assert.equal(isEntraMgmtConfigured(), false);
  } finally {
    restore();
  }
});

test("isEntraMgmtConfigured() is true when all ENTRA_* mgmt vars set", () => {
  const restore = clearEntraEnv();
  try {
    process.env.ENTRA_TENANT_ID = "tenant-id";
    process.env.ENTRA_CLIENT_ID = "mgmt-client-id";
    process.env.ENTRA_CLIENT_SECRET = "mgmt-client-secret";
    process.env.ENTRA_API_APP_ID = "api-app-id";
    assert.equal(isEntraMgmtConfigured(), true);
  } finally {
    restore();
  }
});

test("createEntraAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearEntraEnv();
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra Management API not configured — set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_API_APP_ID/,
    );
  } finally {
    restore();
  }
});

test("deleteEntraAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearEntraEnv();
  try {
    await assert.rejects(
      deleteEntraAgent("some-app-object-id"),
      /Entra Management API not configured/,
    );
  } finally {
    restore();
  }
});

test("createEntraAgent() registers app, service principal, role assignment, and secret", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  process.env.ENTRA_TENANT_ID = "tenant-id";
  process.env.ENTRA_CLIENT_ID = "mgmt-client-id";
  process.env.ENTRA_CLIENT_SECRET = "mgmt-client-secret";
  process.env.ENTRA_API_APP_ID = "api-app-id";
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET" });
    if (String(url).includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (String(url).endsWith("/applications") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ appId: "new-client-id", id: "new-object-id" }) };
    }
    if (String(url).endsWith("/servicePrincipals") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ id: "new-sp-id" }) };
    }
    if (String(url).includes("/appRoleAssignments") && opts?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    if (String(url).includes("/addPassword") && opts?.method === "POST") {
      return { ok: true, json: async () => ({ secretText: "new-client-secret" }) };
    }
    throw new Error(`Unexpected fetch: ${opts?.method} ${url}`);
  };
  try {
    const result = await createEntraAgent("test-agent", ["flights:read"]);
    assert.equal(result.clientId, "new-client-id");
    assert.equal(result.clientSecret, "new-client-secret");
    assert.equal(result.name, "test-agent");
    assert.ok(calls.some((c) => c.url.endsWith("/applications") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.endsWith("/servicePrincipals") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.includes("/appRoleAssignments")));
    assert.ok(calls.some((c) => c.url.includes("/addPassword")));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
