import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { fetchServerAudit, renderAuditPanel } from "./audit-view.js";
import { FlightAgent } from "./agent.js";
import {
  getAuth0AccessToken,
  getAuth0Config,
  getAuth0UserLabel,
  handleAuthRedirect,
  isAuth0Authenticated,
  isGuestDemoEnabled,
  jwtTrustFromAuth0,
  loginWithAuth0,
  logoutAuth0,
} from "./auth.js";
import { resolveAuditUrl, resolveMcpUrl } from "./config.js";

const chatEl = document.getElementById("chat")!;
const inputEl = document.getElementById("message") as HTMLInputElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const tokenSelect = document.getElementById("token") as HTMLSelectElement;
const guestTokenLabel = document.getElementById("guest-token-label")!;
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("audit-log")!;
const initBtn = document.getElementById("init") as HTMLButtonElement;
const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;

interface DemoTokens {
  read_only: string;
  booking: string;
  admin: string;
}

type AuthMode = "guest" | "auth0";

let agent: FlightAgent | null = null;
let tokens: DemoTokens | null = null;
let publicKey = "";
let authMode: AuthMode = "guest";

function appendMessage(role: string, content: string): void {
  const msg = document.createElement("div");
  msg.className = `message message-${role}`;
  msg.innerHTML = `<strong>${role}</strong><pre>${escapeHtml(content)}</pre>`;
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function resolveBearerToken(): Promise<string> {
  if (authMode === "auth0") {
    return getAuth0AccessToken();
  }
  if (!tokens) throw new Error("Demo tokens not loaded");
  return tokens[tokenSelect.value as keyof DemoTokens];
}

async function refreshAuditPanel(): Promise<void> {
  const sessionId = agent?.getSessionId() ?? "";
  const client: readonly AuditLogEntry[] = agent?.getAuditLog() ?? [];
  const auditUrl = resolveAuditUrl(resolveMcpUrl());

  let bearer: string;
  try {
    bearer = await resolveBearerToken();
  } catch {
    renderAuditPanel(
      logEl,
      { ok: false, error: "No Bearer token — sign in or pick a guest scope, then Initialize" },
      client,
      sessionId,
    );
    return;
  }

  const server = await fetchServerAudit(auditUrl, bearer, sessionId || undefined);
  renderAuditPanel(logEl, server, client, sessionId);
}

async function loadDemoAssets(): Promise<void> {
  publicKey = await fetch("/demo-public.pem").then((r) => r.text());
  if (isGuestDemoEnabled()) {
    tokens = await fetch("/demo-tokens.json").then((r) => r.json());
  }
}

function buildAgent(jwt: string): FlightAgent {
  const auth0 = getAuth0Config();
  const jwtTrust = auth0 ? jwtTrustFromAuth0(auth0) : {};
  return new FlightAgent({
    mcpUrl: resolveMcpUrl(),
    jwt,
    publicKeyPem: publicKey,
    ...jwtTrust,
    onStatus: (s) => {
      statusEl.textContent = s;
    },
    onLog: () => {
      void refreshAuditPanel();
    },
    onMessage: (role, content) => appendMessage(role, content),
  });
}

async function syncAuthUi(): Promise<void> {
  const auth0Config = getAuth0Config();
  const guestEnabled = isGuestDemoEnabled();

  if (!auth0Config) {
    authControls.hidden = true;
    guestTokenLabel.hidden = !guestEnabled;
    authMode = "guest";
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isAuth0Authenticated();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;
  guestTokenLabel.hidden = authenticated || !guestEnabled;

  if (authenticated) {
    authMode = "auth0";
    authStatusEl.textContent = await getAuth0UserLabel();
  } else {
    authMode = guestEnabled ? "guest" : "auth0";
    authStatusEl.textContent = guestEnabled
      ? "Guest demo — or sign in for Auth0"
      : "Sign in required";
  }
}

async function initAgent(): Promise<void> {
  initBtn.disabled = true;
  sendBtn.disabled = true;
  statusEl.textContent = "Initializing...";

  try {
    await syncAuthUi();
    await loadDemoAssets();

    if (authMode === "auth0" && !(await isAuth0Authenticated())) {
      throw new Error("Sign in with Auth0 first, or use guest demo");
    }
    if (authMode === "guest" && !tokens) {
      throw new Error("Guest demo tokens unavailable");
    }

    const jwt = await resolveBearerToken();
    agent = buildAgent(jwt);
    await agent.init();
    sendBtn.disabled = false;
    await refreshAuditPanel();
    appendMessage(
      "system",
      authMode === "auth0"
        ? "Agent initialized with Auth0 token. Try: 'Search flights from SFO to JFK'"
        : "Agent initialized (guest). Try: 'Search flights from SFO to JFK'",
    );
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    initBtn.disabled = false;
  }
}

async function sendMessage(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) return;

  if (!agent) {
    await initAgent();
    if (!agent) return;
  }

  inputEl.value = "";
  sendBtn.disabled = true;

  try {
    const jwt = await resolveBearerToken();
    agent.setToken(jwt);
    await agent.chat(text);
    await refreshAuditPanel();
  } catch (err) {
    appendMessage("system", `Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    sendBtn.disabled = false;
  }
}

authLoginBtn.addEventListener("click", () => void loginWithAuth0());
authLogoutBtn.addEventListener("click", () => {
  agent = null;
  void logoutAuth0();
});

initBtn.addEventListener("click", () => void initAgent());
sendBtn.addEventListener("click", () => void sendMessage());
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void sendMessage();
});

tokenSelect.addEventListener("change", () => {
  authMode = "guest";
  if (agent) {
    void (async () => {
      try {
        agent!.setToken(await resolveBearerToken());
        appendMessage(
          "system",
          `Switched to ${tokenSelect.options[tokenSelect.selectedIndex].text} token`,
        );
      } catch (err) {
        appendMessage("system", `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }
});

void syncAuthUi().then(() => {
  statusEl.textContent = getAuth0Config()
    ? "Sign in or pick guest scope, then Initialize"
    : "Click Initialize to load WebLLM + MCP";
});
