import assert from "node:assert/strict";
import { test } from "node:test";

// Only test the pure, DOM-free logic — getIdpProvider() reads import.meta.env,
// which requires the Vite build; instead test the fallback/default behavior
// via a small string-based helper extracted for testability.
import { normalizeIdpProvider } from "../dist-test/auth-provider.js";

test("normalizeIdpProvider() defaults to 'auth0' when unset", () => {
  assert.equal(normalizeIdpProvider(undefined), "auth0");
});

test("normalizeIdpProvider() accepts 'entra'", () => {
  assert.equal(normalizeIdpProvider("entra"), "entra");
});

test("normalizeIdpProvider() is case-insensitive", () => {
  assert.equal(normalizeIdpProvider("Entra"), "entra");
});

test("normalizeIdpProvider() throws on unrecognized value", () => {
  assert.throws(() => normalizeIdpProvider("okta"), /Unrecognized VITE_IDP_PROVIDER 'okta'/);
});
