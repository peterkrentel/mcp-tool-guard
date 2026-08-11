import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isEntraMgmtConfigured,
  createEntraAgent,
  deleteEntraAgent,
} from "../dist/entra-mgmt.js";

const ENV_KEYS = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_API_APP_ID"];

const API_APP_ID = "api-app-id";
const API_SP_ID = "api-sp-object-id";
const API_APPLICATION_OBJECT_ID = "api-application-object-id";
const APP_ROLES = [
  { id: "role-guid-read", value: "flights:read" },
  { id: "role-guid-write", value: "flights:write" },
];

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

function setEntraEnv() {
  process.env.ENTRA_TENANT_ID = "tenant-id";
  process.env.ENTRA_CLIENT_ID = "mgmt-client-id";
  process.env.ENTRA_CLIENT_SECRET = "mgmt-client-secret";
  process.env.ENTRA_API_APP_ID = API_APP_ID;
}

/**
 * Builds a mock `global.fetch` for createEntraAgent()'s happy-path dependency
 * chain (token -> API servicePrincipal lookup -> application -> agent
 * servicePrincipal -> appRoleAssignments -> addPassword), recording every
 * call. `overrides` lets a specific URL/method combination be replaced with a
 * failing response to exercise a particular failure branch.
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
        // non-JSON body (e.g. URLSearchParams for the token request) — ignore
      }
    }
    calls.push({ url: u, method, body });

    for (const [matcher, response] of Object.entries(overrides)) {
      const [matchMethod, matchFragment] = matcher.split(" ");
      if (method === matchMethod && u.includes(matchFragment)) {
        return typeof response === "function" ? response(u, opts) : response;
      }
    }

    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/servicePrincipals?$filter=") && method === "GET") {
      return {
        ok: true,
        json: async () => ({ value: [{ id: API_SP_ID, appRoles: APP_ROLES }] }),
      };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return {
        ok: true,
        json: async () => ({ value: [{ id: API_APPLICATION_OBJECT_ID }] }),
      };
    }
    if (u.endsWith(`/applications/${API_APPLICATION_OBJECT_ID}`) && method === "PATCH") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.endsWith("/applications") && method === "POST") {
      return { ok: true, json: async () => ({ appId: "new-client-id", id: "new-object-id" }) };
    }
    if (u.endsWith("/servicePrincipals") && method === "POST") {
      return { ok: true, json: async () => ({ id: "new-sp-id" }) };
    }
    if (u.includes("/appRoleAssignments") && method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes("/addPassword") && method === "POST") {
      return { ok: true, json: async () => ({ secretText: "new-client-secret" }) };
    }
    if (u.match(/\/applications\/[^/?]+$/) && method === "DELETE") {
      return { ok: true, status: 204, text: async () => "" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  return { fetchMock, calls };
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
    setEntraEnv();
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
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:read"]);
    assert.equal(result.clientId, "new-client-id");
    assert.equal(result.clientSecret, "new-client-secret");
    assert.equal(result.name, "test-agent");
    assert.ok(calls.some((c) => c.url.includes("/servicePrincipals?$filter=") && c.method === "GET"));
    assert.ok(calls.some((c) => c.url.endsWith("/applications") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.endsWith("/servicePrincipals") && c.method === "POST"));
    assert.ok(calls.some((c) => c.url.includes("/appRoleAssignments")));
    assert.ok(calls.some((c) => c.url.includes("/addPassword")));

    const assignCall = calls.find((c) => c.url.includes("/appRoleAssignments"));
    assert.equal(assignCall.body.resourceId, API_SP_ID);
    assert.equal(assignCall.body.appRoleId, "role-guid-read");
    assert.notEqual(assignCall.body.appRoleId, "flights:read");

    // Regression test for a live-tenant bug: Application.ReadWrite.OwnedBy
    // restricts every operation to objects the caller owns, but an app-only
    // POST /applications call does not auto-assign an owner the way
    // interactive creation does — so without self-assigning ownership at
    // creation time, the immediately-following servicePrincipal creation for
    // that same app fails ("the backing application ... must be in the local
    // tenant", a misleadingly-worded ownership check).
    const createAppCall = calls.find((c) => c.url.endsWith("/applications") && c.method === "POST");
    assert.ok(
      Array.isArray(createAppCall.body["owners@odata.bind"]) &&
        createAppCall.body["owners@odata.bind"].length === 1,
      "expected POST /applications to self-assign an owner via owners@odata.bind",
    );
    assert.match(createAppCall.body["owners@odata.bind"][0], /\/directoryObjects\//);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() with multiple scopes makes two role-assignment calls with distinct appRoleIds and shared resourceId", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:read", "flights:write"]);
    assert.equal(result.clientId, "new-client-id");

    const assignCalls = calls.filter((c) => c.url.includes("/appRoleAssignments"));
    assert.equal(assignCalls.length, 2);

    const roleIds = assignCalls.map((c) => c.body.appRoleId).sort();
    assert.deepEqual(roleIds, ["role-guid-read", "role-guid-write"].sort());

    for (const c of assignCalls) {
      assert.equal(c.body.resourceId, API_SP_ID);
      assert.equal(c.body.principalId, "new-sp-id");
    }
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() throws without rollback when API servicePrincipal lookup fails", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock({
    "GET /servicePrincipals?$filter=": { ok: false, status: 500, text: async () => "graph down" },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra API servicePrincipal lookup failed: 500 graph down/,
    );
    assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/applications")));
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() auto-provisions a missing App Role via PATCH and still succeeds", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:delete"]);
    assert.equal(result.clientId, "new-client-id");

    const objectIdLookup = calls.find(
      (c) => c.url.includes("/applications?$filter=") && c.method === "GET",
    );
    assert.ok(objectIdLookup, "expected a lookup for the API application's object id");
    assert.ok(decodeURIComponent(objectIdLookup.url).includes(`appId eq '${API_APP_ID}'`));

    const patchCall = calls.find(
      (c) => c.url.endsWith(`/applications/${API_APPLICATION_OBJECT_ID}`) && c.method === "PATCH",
    );
    assert.ok(patchCall, "expected a PATCH to append the new App Role");
    assert.equal(patchCall.body.appRoles.length, APP_ROLES.length + 1);
    const newRole = patchCall.body.appRoles.find((r) => r.value === "flights:delete");
    assert.ok(newRole, "expected the new role in the PATCH body");
    assert.deepEqual(newRole.allowedMemberTypes, ["User", "Application"]);
    assert.equal(newRole.displayName, "flights:delete");
    assert.equal(newRole.isEnabled, true);
    assert.equal(newRole.description, "Auto-provisioned scope for flights:delete");
    assert.ok(newRole.id && newRole.id !== "flights:delete", "expected a generated GUID, not the scope string");
    // Existing roles must still be present, untouched, in the PATCH body.
    for (const existing of APP_ROLES) {
      assert.ok(patchCall.body.appRoles.some((r) => r.id === existing.id && r.value === existing.value));
    }

    const assignCall = calls.find((c) => c.url.includes("/appRoleAssignments"));
    assert.equal(assignCall.body.appRoleId, newRole.id);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() auto-provisions multiple missing App Roles in a single PATCH", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:delete", "repo:read"]);
    assert.equal(result.clientId, "new-client-id");

    const patchCalls = calls.filter(
      (c) => c.url.endsWith(`/applications/${API_APPLICATION_OBJECT_ID}`) && c.method === "PATCH",
    );
    assert.equal(patchCalls.length, 1, "expected exactly one batched PATCH, not one per missing scope");
    assert.equal(patchCalls[0].body.appRoles.length, APP_ROLES.length + 2);
    const newValues = patchCalls[0].body.appRoles.map((r) => r.value);
    assert.ok(newValues.includes("flights:delete"));
    assert.ok(newValues.includes("repo:read"));

    const assignCalls = calls.filter((c) => c.url.includes("/appRoleAssignments"));
    assert.equal(assignCalls.length, 2);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() dedupes a repeated missing scope before provisioning — writes exactly one App Role and one assignment", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:delete", "flights:delete"]);
    assert.equal(result.clientId, "new-client-id");

    const patchCalls = calls.filter(
      (c) => c.url.endsWith(`/applications/${API_APPLICATION_OBJECT_ID}`) && c.method === "PATCH",
    );
    assert.equal(patchCalls.length, 1, "expected exactly one batched PATCH");
    const newRoles = patchCalls[0].body.appRoles.filter((r) => r.value === "flights:delete");
    assert.equal(
      newRoles.length,
      1,
      "expected exactly one App Role with value 'flights:delete', not a duplicate GUID for the same value",
    );

    const assignCalls = calls.filter((c) => c.url.includes("/appRoleAssignments"));
    assert.equal(assignCalls.length, 1, "expected exactly one role-assignment call, not one per duplicate input");
    assert.equal(assignCalls[0].body.appRoleId, newRoles[0].id);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() does not PATCH appRoles when every requested scope already exists", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    await createEntraAgent("test-agent", ["flights:read", "flights:write"]);
    assert.ok(
      !calls.some((c) => c.method === "PATCH"),
      "no App Role provisioning PATCH expected when all scopes already exist",
    );
    assert.ok(
      !calls.some((c) => c.url.includes("/applications?$filter=") && c.method === "GET"),
      "no application object-id lookup expected when nothing needs provisioning",
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() rolls back (deletes application) when App Role auto-provisioning PATCH fails", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock({
    [`PATCH /applications/${API_APPLICATION_OBJECT_ID}`]: {
      ok: false,
      status: 403,
      text: async () => "forbidden",
    },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:delete"]),
      /Entra App Role auto-provisioning failed for scope\(s\) 'flights:delete': 403 forbidden/,
    );
    // No application/servicePrincipal was ever created for this agent, so
    // there is nothing to roll back — confirm no agent app was created and
    // no DELETE was issued.
    assert.ok(!calls.some((c) => c.method === "POST" && c.url.endsWith("/applications")));
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() rolls back (deletes application) when servicePrincipal creation fails", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock({
    "POST /servicePrincipals": (u) =>
      u.endsWith("/servicePrincipals")
        ? { ok: false, status: 400, text: async () => "sp create failed" }
        : { ok: true, json: async () => ({}) },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra create servicePrincipal failed: 400 sp create failed/,
    );
    const deleteCall = calls.find((c) => c.method === "DELETE");
    assert.ok(deleteCall, "expected rollback DELETE call");
    assert.ok(deleteCall.url.endsWith("/applications/new-object-id"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

// Regression test for a live-tenant bug: creating an application via app-only
// auth and immediately creating its service principal hit real Microsoft
// Graph eventual-consistency lag (confirmed live: 5s wasn't enough, 30s was),
// surfaced as either a 403 ("must be in the local tenant") or a 400
// ("NoBackingApplicationObject") depending on which validation path Graph
// hit. createEntraAgent() must retry those specific errors with backoff
// rather than failing immediately or retrying every failure indiscriminately.
test("createEntraAgent() retries servicePrincipal creation on a Graph consistency-lag error and succeeds", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  let spAttempts = 0;
  const { fetchMock, calls } = makeFetchMock({
    "POST /servicePrincipals": (u) => {
      if (!u.endsWith("/servicePrincipals")) return { ok: true, json: async () => ({}) };
      spAttempts += 1;
      if (spAttempts === 1) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({
              error: {
                code: "Authorization_RequestDenied",
                message:
                  "When using this permission, the backing application of the service principal being created must in the local tenant",
              },
            }),
        };
      }
      return { ok: true, json: async () => ({ id: "new-sp-id" }) };
    },
  });
  global.fetch = fetchMock;
  try {
    const result = await createEntraAgent("test-agent", ["flights:read"]);
    assert.equal(result.clientId, "new-client-id");
    assert.equal(spAttempts, 2, "expected exactly one retry after the consistency-lag failure");
    assert.ok(!calls.some((c) => c.method === "DELETE"), "must not roll back on a retried-and-recovered failure");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() does not retry a servicePrincipal creation failure that isn't a consistency-lag error", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  let spAttempts = 0;
  const { fetchMock, calls } = makeFetchMock({
    "POST /servicePrincipals": (u) => {
      if (!u.endsWith("/servicePrincipals")) return { ok: true, json: async () => ({}) };
      spAttempts += 1;
      return { ok: false, status: 400, text: async () => "some unrelated bad request" };
    },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra create servicePrincipal failed: 400 some unrelated bad request/,
    );
    assert.equal(spAttempts, 1, "must not retry a non-consistency-lag failure");
    assert.ok(calls.some((c) => c.method === "DELETE"), "expected rollback DELETE call");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() rolls back (deletes application) when an app role assignment fails", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock({
    "POST /appRoleAssignments": { ok: false, status: 403, text: async () => "forbidden" },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra app role assignment failed for scope 'flights:read': 403 forbidden/,
    );
    const deleteCall = calls.find((c) => c.method === "DELETE");
    assert.ok(deleteCall, "expected rollback DELETE call");
    assert.ok(deleteCall.url.endsWith("/applications/new-object-id"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() rolls back (deletes application) when secret creation fails", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const { fetchMock, calls } = makeFetchMock({
    "POST /addPassword": { ok: false, status: 500, text: async () => "secret failed" },
  });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      createEntraAgent("test-agent", ["flights:read"]),
      /Entra add secret failed: 500 secret failed/,
    );
    const deleteCall = calls.find((c) => c.method === "DELETE");
    assert.ok(deleteCall, "expected rollback DELETE call");
    assert.ok(deleteCall.url.endsWith("/applications/new-object-id"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteEntraAgent() looks up object id and deletes it", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const calls = [];
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    calls.push({ url: u, method });
    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return { ok: true, json: async () => ({ value: [{ id: "existing-object-id" }] }) };
    }
    if (u.endsWith("/applications/existing-object-id") && method === "DELETE") {
      return { ok: true, status: 204, text: async () => "" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await deleteEntraAgent("client-app-id");
    assert.ok(calls.some((c) => c.url.includes("/applications?$filter=") && c.method === "GET"));
    assert.ok(
      calls.some((c) => c.url.endsWith("/applications/existing-object-id") && c.method === "DELETE"),
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteEntraAgent() returns without deleting when lookup finds no application (already gone)", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const calls = [];
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    calls.push({ url: u, method });
    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return { ok: true, json: async () => ({ value: [] }) };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await deleteEntraAgent("already-gone-client-id");
    assert.ok(!calls.some((c) => c.method === "DELETE"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteEntraAgent() treats a 404 on delete as success", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return { ok: true, json: async () => ({ value: [{ id: "existing-object-id" }] }) };
    }
    if (u.endsWith("/applications/existing-object-id") && method === "DELETE") {
      return { ok: false, status: 404, text: async () => "not found" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await assert.doesNotReject(deleteEntraAgent("client-app-id"));
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("createEntraAgent() escapes a single quote in ENTRA_API_APP_ID before building the OData $filter", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  process.env.ENTRA_API_APP_ID = "api-app-id' or appId eq 'other";
  const { fetchMock, calls } = makeFetchMock();
  global.fetch = fetchMock;
  try {
    await createEntraAgent("test-agent", ["flights:read"]);
    const lookupCall = calls.find((c) => c.url.includes("/servicePrincipals?$filter="));
    assert.ok(lookupCall, "expected an API servicePrincipal lookup call");
    const decoded = decodeURIComponent(lookupCall.url.split("$filter=")[1]);
    assert.equal(decoded, "appId eq 'api-app-id'' or appId eq ''other'");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteEntraAgent() escapes a single quote in clientId before building the OData $filter", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  const calls = [];
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    calls.push({ url: u, method });
    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return { ok: true, json: async () => ({ value: [] }) };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    // A single quote must be doubled ('' ) per OData string-literal escaping
    // rules — otherwise it would break out of the `eq '...'` literal and
    // could broaden the filter to match an unintended application.
    await deleteEntraAgent("evil' or appId eq 'other-app");
    const lookupCall = calls.find((c) => c.url.includes("/applications?$filter="));
    assert.ok(lookupCall, "expected a lookup call");
    const decoded = decodeURIComponent(lookupCall.url.split("$filter=")[1]);
    assert.equal(decoded, "appId eq 'evil'' or appId eq ''other-app'");
    assert.ok(!decoded.includes("eq 'evil' or"), "raw unescaped quote must not survive in the filter");
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("deleteEntraAgent() throws on a real (non-404) delete error", async () => {
  const restore = clearEntraEnv();
  const originalFetch = global.fetch;
  setEntraEnv();
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? "GET";
    const u = String(url);
    if (u.includes("/oauth2/v2.0/token")) {
      return { ok: true, json: async () => ({ access_token: "mgmt-token" }) };
    }
    if (u.includes("/applications?$filter=") && method === "GET") {
      return { ok: true, json: async () => ({ value: [{ id: "existing-object-id" }] }) };
    }
    if (u.endsWith("/applications/existing-object-id") && method === "DELETE") {
      return { ok: false, status: 500, text: async () => "internal error" };
    }
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    await assert.rejects(
      deleteEntraAgent("client-app-id"),
      /Entra delete application failed: 500 internal error/,
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
