import type { AuditLogEntry } from "@mcp-tool-guard/gateway";

import { FlightAgent } from "./agent.js";

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
let publicKey = "";

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

function renderAuditLog(entries: readonly AuditLogEntry[]): void {
  logEl.innerHTML = entries
    .slice()
    .reverse()
    .map(
      (e) =>
        `<div class="log-entry log-${e.decision}">
        <span class="log-time">${e.timestamp.slice(11, 19)}</span>
        <span class="log-decision">${e.decision.toUpperCase()}</span>
        <span class="log-tool">${e.tool}</span>
        <span class="log-scope">${e.required_scope}</span>
        ${e.reason ? `<span class="log-reason">${escapeHtml(e.reason)}</span>` : ""}
      </div>`,
    )
    .join("");
}

async function loadDemoAssets(): Promise<void> {
  publicKey = await fetch("/demo-public.pem").then((r) => r.text());
  tokens = await fetch("/demo-tokens.json").then((r) => r.json());
}

function currentToken(): string {
  if (!tokens) throw new Error("Demo tokens not loaded");
  return tokens[tokenSelect.value as keyof DemoTokens];
}

function buildAgent(): FlightAgent {
  return new FlightAgent({
    mcpUrl: "/mcp",
    jwt: currentToken(),
    publicKeyPem: publicKey,
    onStatus: (s) => {
      statusEl.textContent = s;
    },
    onLog: () => {
      if (agent) renderAuditLog(agent.getAuditLog());
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
    renderAuditLog(agent.getAuditLog());
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
