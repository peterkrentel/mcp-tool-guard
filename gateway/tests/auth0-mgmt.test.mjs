import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isAuth0MgmtConfigured,
  createM2mAgent,
  deleteM2mAgent,
} from "../dist/auth0-mgmt.js";

const ENV_KEYS = ["AUTH0_DOMAIN", "AUTH0_MGMT_CLIENT_ID", "AUTH0_MGMT_CLIENT_SECRET", "AUTH0_AUDIENCE"];

const DOMAIN = "example.us.auth0.com";
const AUDIENCE = "https://mcp-tool-guard";
const RESOURCE_SERVER_ID = "resource-server-id";
const RESOURCE_SERVER_SCOPES = [
  { value: "flights:read", description: "Read access to flight search and booking details" },
  { value: "flights:write", description: "Create and modify flight bookings" },
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

function setAuth0Env() {
  process.env.AUTH0_DOMAIN = DOMAIN;
  process.env.AUTH0_MGMT_CLIENT_ID = "mgmt-client-id";
  process.env.AUTH0_MGMT_CLIENT_SECRET = "mgmt-client-secret";
  process.env.AUTH0_AUDIENCE = AUDIENCE;
}

/**
 * Builds a mock `global.fetch` for createM2mAgent()'s happy-path dependency
 * chain (token -> resource-servers list -> [optional PATCH] -> create client
 * -> client-grants), recording every call. `overrides` lets a specific
 * URL/method combination be replaced with a failing response to exercise a
 * particular failure branch.
 */
function makeFetchMock(overrides = {}) {
  const calls = [];
  const fetchMock = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    let body;
    if (typeof opts?.body === "string") {
      try {
        body = JSON.parse(opts.body);
      } catch {
        // non-JSON body — ignore
      }
    }
    calls.push({ url: u, method, body });

    for (const [matcher, response] of Object.entries(overrides)) {
      const [matchMethod, matchFragment] = matcher.split(" ");
      if (method === matchMethod && u.includes(matchFragment)) {
        return typeof response === "function" ? response(u, opts) : response;
      }
    }

    if (u.includes("/oauth/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.endsWith("/api/v2/resource-servers") && method === "GET") {
      return {
        ok: true,
        json: async () => [
          { id: RESOURCE_SERVER_ID, identifier: AUDIENCE, scopes: RESOURCE_SERVER_SCOPES },
        ],
      };
    }
    if (u.endsWith(`/api/v2/resource-servers/${RESOURCE_SERVER_ID}`) && method === "PATCH") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.endsWith("/api/v2/clients") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ client_id: "new-client-id", client_secret: "new-client-secret" }),
      };
    }
    if (u.endsWith("/api/v2/client-grants") && method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes("/api/v2/clients/") && method === "DELETE") {
      return { ok: true, status: 204, text: async () => "" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  return { fetchMock, calls };
}

test("isAuth0MgmtConfigured() is false when AUTH0_* unset", () => {
  const restore = clearAuth0Env();
  try {
    assert.equal(isAuth0MgmtConfigured(), false);
  } finally {
    restore();
  }
});

test("isAuth0MgmtConfigured() is true when all AUTH0_* mgmt vars set", () => {
  const restore = clearAuth0Env();
  try {
    setAuth0Env();
    assert.equal(isAuth0MgmtConfigured(), true);
  } finally {
    restore();
  }
});

test("createM2mAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    await assert.rejects(
      createM2mAgent("test-agent", ["flights:read"]),
      /Auth0 Management API not configured — set AUTH0_DOMAIN, AUTH0_MGMT_CLIENT_ID, AUTH0_MGMT_CLIENT_SECRET, AUTH0_AUDIENCE/,
    );
  } finally {
    restore();
  }
});

test("createM2mAgent() creates client and grant when all scopes already exist on the resource server", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createM2mAgent("test-agent", ["flights:read"]);
    assert.equal(result.clientId, "new-client-id");
    assert.equal(result.clientSecret, "new-client-secret");
    assert.equal(result.name, "test-agent");

    assert.ok(calls.some((c) => c.url.endsWith("/api/v2/resource-servers") && c.method === "GET"));
    assert.ok(!calls.some((c) => c.method === "PATCH"), "no PATCH expected when the scope already exists");
    assert.ok(calls.some((c) => c.url.endsWith("/api/v2/clients") && c.method === "POST"));
    const grantCall = calls.find((c) => c.url.endsWith("/api/v2/client-grants") && c.method === "POST");
    assert.ok(grantCall);
    assert.deepEqual(grantCall.body.scope, ["flights:read"]);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() auto-provisions a missing scope via resource-server PATCH before the client-grant call", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createM2mAgent("test-agent", ["flights:delete"]);
    assert.equal(result.clientId, "new-client-id");

    const patchCall = calls.find(
      (c) => c.url.endsWith(`/api/v2/resource-servers/${RESOURCE_SERVER_ID}`) && c.method === "PATCH",
    );
    assert.ok(patchCall, "expected a PATCH to add the new scope");
    assert.equal(patchCall.body.scopes.length, RESOURCE_SERVER_SCOPES.length + 1);
    const newScope = patchCall.body.scopes.find((s) => s.value === "flights:delete");
    assert.ok(newScope, "expected the new scope in the PATCH body");
    assert.equal(newScope.description, "Auto-provisioned scope for flights:delete");
    // Existing scopes must still be present, untouched, in the PATCH body.
    for (const existing of RESOURCE_SERVER_SCOPES) {
      assert.ok(patchCall.body.scopes.some((s) => s.value === existing.value && s.description === existing.description));
    }

    // The PATCH must happen strictly before client creation.
    const patchIndex = calls.indexOf(patchCall);
    const createIndex = calls.findIndex((c) => c.url.endsWith("/api/v2/clients") && c.method === "POST");
    assert.ok(patchIndex < createIndex, "PATCH must precede client creation");

    const grantCall = calls.find((c) => c.url.endsWith("/api/v2/client-grants") && c.method === "POST");
    assert.deepEqual(grantCall.body.scope, ["flights:delete"]);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() auto-provisions multiple missing scopes in a single PATCH", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    await createM2mAgent("test-agent", ["flights:delete", "repo:read"]);

    const patchCalls = calls.filter(
      (c) => c.url.endsWith(`/api/v2/resource-servers/${RESOURCE_SERVER_ID}`) && c.method === "PATCH",
    );
    assert.equal(patchCalls.length, 1, "expected exactly one batched PATCH, not one per missing scope");
    assert.equal(patchCalls[0].body.scopes.length, RESOURCE_SERVER_SCOPES.length + 2);
    const newValues = patchCalls[0].body.scopes.map((s) => s.value);
    assert.ok(newValues.includes("flights:delete"));
    assert.ok(newValues.includes("repo:read"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() dedupes a repeated missing scope before provisioning — writes exactly one scope and one grant entry", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createM2mAgent("test-agent", ["flights:delete", "flights:delete"]);
    assert.equal(result.clientId, "new-client-id");

    const patchCalls = calls.filter(
      (c) => c.url.endsWith(`/api/v2/resource-servers/${RESOURCE_SERVER_ID}`) && c.method === "PATCH",
    );
    assert.equal(patchCalls.length, 1, "expected exactly one batched PATCH");
    const newScopes = patchCalls[0].body.scopes.filter((s) => s.value === "flights:delete");
    assert.equal(
      newScopes.length,
      1,
      "expected exactly one scope with value 'flights:delete', not a duplicate entry",
    );

    const grantCall = calls.find((c) => c.url.endsWith("/api/v2/client-grants") && c.method === "POST");
    assert.ok(grantCall);
    assert.deepEqual(grantCall.body.scope, ["flights:delete"]);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() does not PATCH the resource server when every requested scope already exists", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    await createM2mAgent("test-agent", ["flights:read", "flights:write"]);
    assert.ok(!calls.some((c) => c.method === "PATCH"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() throws without creating a client when the resource server can't be found for the audience", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock({
    "GET /api/v2/resource-servers": {
      ok: true,
      json: async () => [{ id: "other-id", identifier: "https://something-else", scopes: [] }],
    },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createM2mAgent("test-agent", ["flights:read"]),
      /Auth0 resource server not found for audience 'https:\/\/mcp-tool-guard'/,
    );
    assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v2/clients")));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() throws without creating a client when the resource-server PATCH fails", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock({
    [`PATCH /api/v2/resource-servers/${RESOURCE_SERVER_ID}`]: {
      ok: false,
      status: 403,
      text: async () => "forbidden",
    },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createM2mAgent("test-agent", ["flights:delete"]),
      /Auth0 resource-server scope auto-provisioning failed for scope\(s\) 'flights:delete': 403 forbidden/,
    );
    assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/api/v2/clients")));
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() rolls back (deletes client) when client-grant still fails after scopes are ensured", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock({
    "POST /api/v2/client-grants": { ok: false, status: 400, text: async () => "grant failed" },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createM2mAgent("test-agent", ["flights:read"]),
      /Auth0 client grant failed: 400 grant failed/,
    );
    const deleteCall = calls.find((c) => c.method === "DELETE");
    assert.ok(deleteCall, "expected rollback DELETE call");
    assert.ok(deleteCall.url.endsWith("/api/v2/clients/new-client-id"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createM2mAgent() throws without a rollback attempt when client creation itself fails", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const { fetchMock, calls } = makeFetchMock({
    "POST /api/v2/clients": { ok: false, status: 500, text: async () => "client create failed" },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createM2mAgent("test-agent", ["flights:read"]),
      /Auth0 create client failed: 500 client create failed/,
    );
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteM2mAgent() rejects with clear message when mgmt not configured", async () => {
  const restore = clearAuth0Env();
  try {
    await assert.rejects(deleteM2mAgent("some-client-id"), /Auth0 Management API not configured/);
  } finally {
    restore();
  }
});

test("deleteM2mAgent() deletes the client by id", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  const calls = [];
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    calls.push({ url: u, method });
    if (u.includes("/oauth/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.endsWith("/api/v2/clients/existing-client-id") && method === "DELETE") {
      return { ok: true, status: 204, text: async () => "" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await deleteM2mAgent("existing-client-id");
    assert.ok(calls.some((c) => c.url.endsWith("/api/v2/clients/existing-client-id") && c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteM2mAgent() treats a 404 on delete as success", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    if (u.includes("/oauth/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.endsWith("/api/v2/clients/already-gone") && method === "DELETE") {
      return { ok: false, status: 404, text: async () => "not found" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await assert.doesNotReject(deleteM2mAgent("already-gone"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteM2mAgent() throws on a real (non-404) delete error", async () => {
  const restore = clearAuth0Env();
  const originalFetch = global.fetch;
  setAuth0Env();
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    if (u.includes("/oauth/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.endsWith("/api/v2/clients/existing-client-id") && method === "DELETE") {
      return { ok: false, status: 500, text: async () => "internal error" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await assert.rejects(
      deleteM2mAgent("existing-client-id"),
      /Auth0 delete client failed: 500 internal error/,
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
