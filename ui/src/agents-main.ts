import type { GuardConfig } from "@mcp-tool-guard/gateway";

import type { LlmProviderId } from "./llm/types.js";
import { listLlmProviders } from "./llm/providers.js";
import type { GatewayAgent } from "./gateway-agent.js";
import {
  addServer,
  createAgent,
  discoverTools,
  fetchGatewayAudit,
  listServers,
  mcpUrlForServer,
  removeServer,
  revokeAgent,
  vendToken,
  type RegisteredServer,
} from "./proxy-api.js";
import { renderThreeLayerAudit } from "./agents-audit-view.js";

interface ActiveAgent {
  name: string;
  clientId: string;
  clientSecret: string;
  token: string;
  scopes: string[];
  serverId: string;
}

const mcpListEl = document.getElementById("mcp-list")!;
const agentListEl = document.getElementById("agent-list")!;
const chatEl = document.getElementById("agents-chat")!;
const auditEl = document.getElementById("agents-audit")!;
const statusEl = document.getElementById("agents-status")!;
const llmSelect = document.getElementById("llm-select") as HTMLSelectElement;
const initBtn = document.getElementById("agents-init") as HTMLButtonElement;
const sendBtn = document.getElementById("agents-send") as HTMLButtonElement;
const inputEl = document.getElementById("agents-message") as HTMLInputElement;

let servers: RegisteredServer[] = [];
let agents: ActiveAgent[] = [];
let selectedAgent: ActiveAgent | null = null;
let gatewayAgent: GatewayAgent | null = null;
let publicKeyPem = "";
let auditPoll: ReturnType<typeof setInterval> | null = null;

function guardConfigForServer(server: RegisteredServer): GuardConfig {
  const tools: Record<string, { required_scope: string }> = {};
  for (const [tool, scopeList] of Object.entries(server.scopes)) {
    const required = scopeList[0];
    if (required) tools[tool] = { required_scope: required };
  }
  return {
    servers: {
      [server.id]: { url: server.url, tools },
    },
  };
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function appendChat(role: string, content: string): void {
  const msg = document.createElement("div");
  msg.className = `message message-${role}`;
  msg.innerHTML = `<strong>${role}</strong><pre>${content.replace(/</g, "&lt;")}</pre>`;
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function populateLlmSelect(): void {
  llmSelect.innerHTML = "";
  for (const p of listLlmProviders()) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.configured ? p.label : `${p.label} (${p.hint})`;
    opt.disabled = !p.configured;
    llmSelect.appendChild(opt);
  }
}

async function refreshServers(): Promise<void> {
  servers = await listServers();
  mcpListEl.innerHTML = servers
    .map(
      (s) => `<div class="card">
        <strong>${s.id}</strong>
        <div class="card-meta">${s.url}</div>
        <div class="card-meta">${Object.keys(s.scopes).length} tools</div>
        <button type="button" data-remove-mcp="${s.id}">Remove</button>
      </div>`,
    )
    .join("");
  mcpListEl.querySelectorAll("[data-remove-mcp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.removeMcp!;
      void removeServer(id).then(refreshServers);
    });
  });
  renderAgentCards();
}

function renderAgentCards(): void {
  agentListEl.innerHTML = agents
    .map(
      (a) => `<div class="card ${selectedAgent?.clientId === a.clientId ? "card-active" : ""}">
        <strong>${a.name}</strong>
        <div class="card-meta">${a.serverId} · ${a.scopes.join(", ")}</div>
        <div class="card-meta mono">${a.clientId.slice(0, 12)}…</div>
        <button type="button" data-select-agent="${a.clientId}">Use</button>
        <button type="button" data-revoke-agent="${a.clientId}">Revoke</button>
      </div>`,
    )
    .join("");

  agentListEl.querySelectorAll("[data-select-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.selectAgent!;
      selectedAgent = agents.find((a) => a.clientId === id) ?? null;
      renderAgentCards();
    });
  });

  agentListEl.querySelectorAll("[data-revoke-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.revokeAgent!;
      void (async () => {
        await revokeAgent(id);
        agents = agents.filter((a) => a.clientId !== id);
        if (selectedAgent?.clientId === id) selectedAgent = null;
        gatewayAgent = null;
        renderAgentCards();
      })();
    });
  });
}

async function refreshAudit(): Promise<void> {
  if (!selectedAgent) return;
  try {
    const entries = await fetchGatewayAudit(
      selectedAgent.token,
      gatewayAgent?.getSessionId(),
    );
    renderThreeLayerAudit(auditEl, entries, gatewayAgent?.getSessionId() ?? "");
  } catch (err) {
    auditEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

function startAuditPoll(): void {
  if (auditPoll) clearInterval(auditPoll);
  auditPoll = setInterval(() => void refreshAudit(), 2000);
}

document.getElementById("add-mcp-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const name = (form.elements.namedItem("mcp-name") as HTMLInputElement).value;
  const url = (form.elements.namedItem("mcp-url") as HTMLInputElement).value;
  const toolsRaw = (form.elements.namedItem("mcp-tools") as HTMLTextAreaElement).value;
  const scopes: Record<string, string[]> = {};
  for (const line of toolsRaw.split("\n")) {
    const [tool, scopePart] = line.split("=").map((s) => s.trim());
    if (!tool || !scopePart) continue;
    scopes[tool] = scopePart.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const serverId = slugify(name) || slugify(url);
  void addServer({ id: serverId, url, scopes })
    .then(() => {
      form.reset();
      statusEl.textContent = `MCP registered: ${serverId}`;
      return refreshServers();
    })
    .catch((err) => {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
    });
});

document.getElementById("create-agent-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const name = (form.elements.namedItem("agent-name") as HTMLInputElement).value;
  const serverId = (form.elements.namedItem("agent-mcp") as HTMLSelectElement).value;
  const scopesRaw = (form.elements.namedItem("agent-scopes") as HTMLInputElement).value;
  const scopes = scopesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  void (async () => {
    statusEl.textContent = "Creating agent…";
    const created = await createAgent(name, scopes);
    const vended = await vendToken(created.clientId, created.clientSecret);
    const agent: ActiveAgent = {
      name: created.name,
      clientId: created.clientId,
      clientSecret: created.clientSecret,
      token: vended.token,
      scopes,
      serverId,
    };
    agents.push(agent);
    selectedAgent = agent;
    statusEl.textContent = `Agent ${name} created`;
    renderAgentCards();
    form.reset();
  })().catch((err) => {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  });
});

function updateAgentMcpSelect(): void {
  const sel = document.getElementById("agent-mcp") as HTMLSelectElement;
  sel.innerHTML = servers
    .map((s) => `<option value="${s.id}">${s.id}</option>`)
    .join("");
}

initBtn.addEventListener("click", () => {
  void (async () => {
    if (!selectedAgent) {
      statusEl.textContent = "Select or create an agent first";
      return;
    }
    initBtn.disabled = true;
    statusEl.textContent = "Initializing…";
    publicKeyPem = await fetch("/demo-public.pem").then((r) => r.text());
    const llmId = llmSelect.value as LlmProviderId;
    const serverMeta = servers.find((s) => s.id === selectedAgent!.serverId);
    if (!serverMeta) throw new Error("Selected MCP server not found");
    const tools = await discoverTools(selectedAgent.serverId, selectedAgent.token);
    const { GatewayAgent } = await import("./gateway-agent.js");
    gatewayAgent = new GatewayAgent({
      serverId: selectedAgent.serverId,
      guardConfig: guardConfigForServer(serverMeta),
      mcpUrl: mcpUrlForServer(selectedAgent.serverId),
      jwt: selectedAgent.token,
      publicKeyPem,
      jwtIssuer: import.meta.env.VITE_AUTH0_DOMAIN
        ? `https://${import.meta.env.VITE_AUTH0_DOMAIN}/`
        : undefined,
      jwtAudience: import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      llmId,
      onStatus: (s) => {
        statusEl.textContent = s;
      },
      onMessage: (role, content) => appendChat(role, content),
      onAudit: () => void refreshAudit(),
    });
    await gatewayAgent.init();
    sendBtn.disabled = false;
    startAuditPoll();
    await refreshAudit();
    appendChat("system", `Agent ready — ${selectedAgent.name} → ${selectedAgent.serverId}`);
    initBtn.disabled = false;
  })().catch((err) => {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    initBtn.disabled = false;
  });
});

sendBtn.addEventListener("click", () => {
  void (async () => {
    const text = inputEl.value.trim();
    if (!text || !gatewayAgent) return;
    inputEl.value = "";
    sendBtn.disabled = true;
    try {
      gatewayAgent.setLlmId(llmSelect.value as LlmProviderId);
      await gatewayAgent.chat(text);
      await refreshAudit();
    } finally {
      sendBtn.disabled = false;
    }
  })();
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

populateLlmSelect();
void refreshServers().then(() => {
  updateAgentMcpSelect();
  setInterval(updateAgentMcpSelect, 3000);
});
