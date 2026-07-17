#!/usr/bin/env node
// Headless-browser login for scripts/smoke-deployed.sh: automates the real
// /agents.html "Sign in" button + Auth0 Universal Login form, then reads the
// resulting access_token straight out of localStorage (same cache the SPA
// itself uses — ui/src/auth.ts sets cacheLocation: "localstorage").
//
// This exists because the standing admin user's Auth0 client is only
// configured for the Authorization Code flow (as it should be for a browser
// app) — there is no working non-interactive (ROPG) path for it. Replaying
// the actual login UI is the only way to get a real gateway:admin token for
// this account without a permanent stored credential.
//
// Prints ONLY the access token to stdout on success. Never prints the
// password. All progress/diagnostics go to stderr.
//
// Required env: SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD
// Optional env: UI_BASE_URL (default https://mcp-tool-guard-ui.vercel.app), HEADLESS (default true)

import { chromium } from "playwright";

const EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const UI_BASE_URL = process.env.UI_BASE_URL || "https://mcp-tool-guard-ui.vercel.app";
const HEADLESS = process.env.HEADLESS !== "false";

if (!EMAIL || !PASSWORD) {
  console.error("SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD are required");
  process.exit(1);
}

const browser = await chromium.launch({ headless: HEADLESS });
const page = await browser.newPage();

try {
  console.error(`Navigating to ${UI_BASE_URL}/agents.html ...`);
  await page.goto(`${UI_BASE_URL}/agents.html`, { waitUntil: "domcontentloaded" });

  console.error("Clicking Sign in...");
  await page.click("#auth-login");

  console.error("Waiting for Auth0 Universal Login form...");
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });
  await page.fill('input[name="username"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  console.error("Waiting for redirect back to the app...");
  const appOrigin = new URL(UI_BASE_URL).origin;
  await page.waitForURL((url) => url.origin === appOrigin, { timeout: 20000 });

  // Give ui/src/main.ts's handleAuthRedirect() a moment to finish the token exchange.
  await page.waitForTimeout(2000);

  const accessToken = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("@@auth0spajs@@")) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (entry?.body?.access_token) return entry.body.access_token;
      } catch {
        /* not a JSON cache entry, skip */
      }
    }
    return null;
  });

  if (!accessToken) {
    console.error("Login appeared to succeed but no cached access_token was found in localStorage.");
    process.exit(1);
  }

  await browser.close();
  process.stdout.write(accessToken);
} catch (err) {
  console.error(`Headless login failed: ${err instanceof Error ? err.message : String(err)}`);
  await browser.close();
  process.exit(1);
}
