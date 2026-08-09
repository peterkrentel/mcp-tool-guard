import assert from "node:assert/strict";
import { test } from "node:test";

import { DefaultJwtValidator } from "../dist/index.js";

test("extractScopes() reads Entra 'roles' claim as scopes", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({ roles: ["flights:read", "flights:write"] });
  assert.deepEqual(new Set(scopes), new Set(["flights:read", "flights:write"]));
});

test("extractScopes() merges 'roles' with 'permissions' and 'scp' without duplicates", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({
    roles: ["flights:read"],
    permissions: ["flights:write"],
    scp: "flights:read gateway:admin",
  });
  assert.deepEqual(
    new Set(scopes),
    new Set(["flights:read", "flights:write", "gateway:admin"]),
  );
});

test("extractScopes() tolerates a token with no 'roles' claim (Auth0 shape unaffected)", () => {
  const validator = new DefaultJwtValidator({});
  const scopes = validator.extractScopes({ permissions: ["flights:read"] });
  assert.deepEqual(scopes, ["flights:read"]);
});
