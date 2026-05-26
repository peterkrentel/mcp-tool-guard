import { fetchServerAudit, renderAuditPanel } from "./audit-view.js";
import { FlightAgent } from "./agent.js";
import { resolveAuditUrl, resolveMcpUrl } from "./config.js";

const chatEl = document.getElementById("chat")!;
const inputEl = document.getElementById("message") as HTMLInputElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const tokenSelect = document.getElementById("token") as HTMLSelectElement;
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("audit-log")!;
const initBtn = document.getElementById("init") as HTMLButtonElement;

interface DemoTokens {
  read_only: string;
  booking: string;
  admin: string;
}

let agent: FlightAgent | null = null;
let tokens: DemoTokens | null = null;

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

async function refreshAuditPanel(): Promise<void> {
  const sessionId = agent?.getSessionId() ?? "";
  const auditUrl = resolveAuditUrl(resolveMcpUrl());
  const server = await fetchServerAudit(auditUrl, sessionId || undefined);
  renderAuditPanel(logEl, server, sessionId);
}

async function loadDemoAssets(): Promise<void> {
  tokens = await fetch("/demo-tokens.json").then((r) => r.json());
}

function currentToken(): string {
  if (!tokens) throw new Error("Demo tokens not loaded");
  return tokens[tokenSelect.value as keyof DemoTokens];
}

function buildAgent(): FlightAgent {
  return new FlightAgent({
    mcpUrl: resolveMcpUrl(),
    jwt: currentToken(),
    onStatus: (s) => {
      statusEl.textContent = s;
    },
    onAfterToolCall: () => {
      void refreshAuditPanel();
    },
    onMessage: (role, content) => appendMessage(role, content),
  });
}

async function initAgent(): Promise<void> {
  initBtn.disabled = true;
  sendBtn.disabled = true;
  statusEl.textContent = "Initializing...";

  try {
    await loadDemoAssets();
    agent = buildAgent();
    await agent.init();
    sendBtn.disabled = false;
    await refreshAuditPanel();
    appendMessage("system", "Agent initialized. Try: 'Search flights from SFO to JFK'");
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
    agent.setToken(currentToken());
    await agent.chat(text);
    await refreshAuditPanel();
  } catch (err) {
    appendMessage("system", `Error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    sendBtn.disabled = false;
  }
}

initBtn.addEventListener("click", () => void initAgent());
sendBtn.addEventListener("click", () => void sendMessage());
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void sendMessage();
});

tokenSelect.addEventListener("change", () => {
  if (agent) {
    agent.setToken(currentToken());
    appendMessage("system", `Switched to ${tokenSelect.options[tokenSelect.selectedIndex].text} token`);
  }
});

statusEl.textContent = "Click Initialize to load WebLLM + MCP";
