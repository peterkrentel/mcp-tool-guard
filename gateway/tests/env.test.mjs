import assert from "node:assert/strict";
import { test } from "node:test";

import { jwtTrustFromEnv } from "../dist/env.js";

const ALL_KEYS = [
  "MCP_IDP_PROVIDER",
  "MCP_JWT_ISSUER",
  "MCP_JWT_AUDIENCE",
  "MCP_JWT_JWKS_URL",
  "AUTH0_DOMAIN",
  "AUTH0_AUDIENCE",
  "ENTRA_TENANT_ID",
  "ENTRA_API_APP_ID",
];

/**
 * Runs `fn` with only the given env vars set (all other relevant keys are
 * cleared for the duration), then restores the prior environment exactly.
 */
function withEnv(vars, fn) {
  const saved = {};
  for (const key of ALL_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of ALL_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("jwtTrustFromEnv() derives all three fields for auth0 with MCP_IDP_PROVIDER explicitly set", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "auth0",
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_AUDIENCE: "https://example.com/api",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.deepEqual(trust, {
        // Normalized without trailing slash, matching this module's existing
        // convention for the explicit MCP_JWT_ISSUER path (guard.ts strips it
        // the same way internally and re-appends "/" only when verifying).
        jwtIssuer: "https://example.auth0.com",
        jwtAudience: "https://example.com/api",
        jwksUrl: "https://example.auth0.com/.well-known/jwks.json",
      });
    },
  );
});

test("jwtTrustFromEnv() derives all three fields for auth0 when MCP_IDP_PROVIDER is unset (default)", () => {
  withEnv(
    {
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_AUDIENCE: "https://example.com/api",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.deepEqual(trust, {
        jwtIssuer: "https://example.auth0.com",
        jwtAudience: "https://example.com/api",
        jwksUrl: "https://example.auth0.com/.well-known/jwks.json",
      });
    },
  );
});

test("jwtTrustFromEnv() derives all three fields for entra, using the Entra discovery JWKS path", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "entra",
      ENTRA_TENANT_ID: "11111111-1111-1111-1111-111111111111",
      ENTRA_API_APP_ID: "22222222-2222-2222-2222-222222222222",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.deepEqual(trust, {
        jwtIssuer:
          "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0",
        jwtAudience: "22222222-2222-2222-2222-222222222222",
        jwksUrl:
          "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/discovery/v2.0/keys",
      });
      // Specifically guard against the Auth0-shaped formula leaking in for Entra.
      assert.ok(!trust.jwksUrl.endsWith(".well-known/jwks.json"));
    },
  );
});

test("jwtTrustFromEnv() explicit MCP_JWT_ISSUER overrides entra-derived issuer", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "entra",
      ENTRA_TENANT_ID: "tenant-id",
      ENTRA_API_APP_ID: "api-app-id",
      MCP_JWT_ISSUER: "https://issuer.example.override",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.equal(trust.jwtIssuer, "https://issuer.example.override");
      assert.equal(trust.jwtAudience, "api-app-id");
      assert.equal(
        trust.jwksUrl,
        "https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys",
      );
    },
  );
});

test("jwtTrustFromEnv() explicit MCP_JWT_AUDIENCE overrides auth0-derived audience", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "auth0",
      AUTH0_DOMAIN: "example.auth0.com",
      AUTH0_AUDIENCE: "would-be-derived-audience",
      MCP_JWT_AUDIENCE: "explicit-override-audience",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.equal(trust.jwtAudience, "explicit-override-audience");
      assert.equal(trust.jwtIssuer, "https://example.auth0.com");
    },
  );
});

test("jwtTrustFromEnv() explicit MCP_JWT_JWKS_URL overrides derived jwks for entra", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "entra",
      ENTRA_TENANT_ID: "tenant-id",
      ENTRA_API_APP_ID: "api-app-id",
      MCP_JWT_JWKS_URL: "https://jwks.override.example/keys",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.equal(trust.jwksUrl, "https://jwks.override.example/keys");
      assert.equal(
        trust.jwtIssuer,
        "https://login.microsoftonline.com/tenant-id/v2.0",
      );
      assert.equal(trust.jwtAudience, "api-app-id");
    },
  );
});

test("jwtTrustFromEnv() mixed: explicit MCP_JWT_AUDIENCE with issuer/jwks derived from entra vars", () => {
  withEnv(
    {
      MCP_IDP_PROVIDER: "entra",
      ENTRA_TENANT_ID: "tenant-id",
      ENTRA_API_APP_ID: "api-app-id",
      MCP_JWT_AUDIENCE: "explicit-audience-only",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.deepEqual(trust, {
        jwtIssuer: "https://login.microsoftonline.com/tenant-id/v2.0",
        jwtAudience: "explicit-audience-only",
        jwksUrl: "https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys",
      });
    },
  );
});

test("jwtTrustFromEnv() returns {} for keycloak provider with nothing else set (no fabricated derivation)", () => {
  withEnv({ MCP_IDP_PROVIDER: "keycloak" }, () => {
    assert.deepEqual(jwtTrustFromEnv(), {});
  });
});

test("jwtTrustFromEnv() returns {} for auth0 when AUTH0_DOMAIN is unset and no MCP_JWT_* fallback", () => {
  withEnv({ MCP_IDP_PROVIDER: "auth0" }, () => {
    assert.deepEqual(jwtTrustFromEnv(), {});
  });
});

test("jwtTrustFromEnv() returns {} when nothing at all is set (default auth0 provider)", () => {
  withEnv({}, () => {
    assert.deepEqual(jwtTrustFromEnv(), {});
  });
});

test("jwtTrustFromEnv() fully-manual config still works unchanged (no provider vars set)", () => {
  withEnv(
    {
      MCP_JWT_ISSUER: "https://manual.issuer.example/",
      MCP_JWT_AUDIENCE: "manual-audience",
      MCP_JWT_JWKS_URL: "https://manual.issuer.example/jwks.json",
    },
    () => {
      const trust = jwtTrustFromEnv();
      assert.deepEqual(trust, {
        jwtIssuer: "https://manual.issuer.example",
        jwtAudience: "manual-audience",
        jwksUrl: "https://manual.issuer.example/jwks.json",
      });
    },
  );
});
