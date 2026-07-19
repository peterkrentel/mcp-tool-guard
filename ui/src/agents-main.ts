import type { GuardConfig } from "@mcp-tool-guard/gateway";

import type { LlmProviderId } from "./llm/types.js";
import { listLlmProviders } from "./llm/providers.js";
import type { GatewayAgent } from "./gateway-agent.js";
import {
  activateAgentToken,
  addServer,
  approvePendingRequest,
  createAgent,
  denyPendingRequest,
  discoverTools,
  fetchGatewayAudit,
  listAgents,
  listPendingRequests,
  listServers,
  mcpUrlForServer,
  removeServer,
  revokeAgent,
  setAdminTokenProvider,
  vendToken,
  type PendingRequest,
  type RegisteredServer,
} from "./proxy-api.js";
import { renderThreeLayerAudit } from "./agents-audit-view.js";
import { renderPendingList } from "./pending-view.js";
import {
  GATEWAY_ADMIN_PERMISSION,
  getAuth0AccessToken,
  getAuth0Config,
  getAuth0UserLabel,
  handleAuthRedirect,
  hasGatewayAdminPermission,
  isAuth0Authenticated,
  jwtTrustFromAuth0,
  loginWithAuth0,
  logoutAuth0,
} from "./auth.js";
import { resolveProxyBase } from "./config.js";

interface ActiveAgent {
  name: string;
  clientId: string;
  clientSecret: string;
  token: string;
  scopes: string[];
  serverId: string;
}

const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;
const adminGateHintEl = document.getElementById("admin-gate-hint")!;
const addMcpForm = document.getElementById("add-mcp-form") as HTMLFormElement;
const createAgentForm = document.getElementById("create-agent-form") as HTMLFormElement;

const mcpListEl = document.getElementById("mcp-list")!;
const agentListEl = document.getElementById("agent-list")!;
const chatEl = document.getElementById("agents-chat")!;
const auditEl = document.getElementById("agents-audit")!;
const statusEl = document.getElementById("agents-status")!;
const llmSelect = document.getElementById("llm-select") as HTMLSelectElement;
const initBtn = document.getElementById("agents-init") as HTMLButtonElement;
const sendBtn = document.getElementById("agents-send") as HTMLButtonElement;
const inputEl = document.getElementById("agents-message") as HTMLInputElement;
const pendingListEl = document.getElementById("pending-list")!;
const pendingRefreshBtn = document.getElementById("pending-refresh") as HTMLButtonElement;

const AGENT_SESSION_KEY = "mcp-tool-guard-agent-session";

interface AgentSessionSecrets {
  token: string;
}

function readAgentSessions(): Record<string, AgentSessionSecrets> {
  try {
    const raw = sessionStorage.getItem(AGENT_SESSION_KEY);
    return raw ? (JSON.parse(raw) as Record<string, AgentSessionSecrets>) : {};
  } catch {
    return {};
  }
}

function writeAgentSession(clientId: string, secrets: AgentSessionSecrets): void {
  const map = readAgentSessions();
  map[clientId] = secrets;
  sessionStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(map));
}

function removeAgentSession(clientId: string): void {
  const map = readAgentSessions();
  delete map[clientId];
  sessionStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(map));
}

let servers: RegisteredServer[] = [];
let agents: ActiveAgent[] = [];
let selectedAgent: ActiveAgent | null = null;
let gatewayAgent: GatewayAgent | null = null;
let publicKeyPem = "";
let auditPoll: ReturnType<typeof setInterval> | null = null;
let controlPlaneAuthRequired = false;
let adminOpsEnabled = false;

setAdminTokenProvider(async () => {
  if (!getAuth0Config() || !(await isAuth0Authenticated())) return null;
  return getAuth0AccessToken();
});

function setFormEnabled(form: HTMLFormElement, enabled: boolean): void {
  for (const el of form.elements) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.disabled = !enabled;
    } else if (el instanceof HTMLSelectElement) {
      el.disabled = !enabled;
    } else if (el instanceof HTMLButtonElement) {
      el.disabled = !enabled;
    }
  }
}

async function loadControlPlaneAuthFlag(): Promise<void> {
  try {
    const base = resolveProxyBase().replace(/\/$/, "");
    const res = await fetch(`${base}/health`);
    if (!res.ok) return;
    const data = (await res.json()) as { control_plane_auth?: boolean };
    controlPlaneAuthRequired = Boolean(data.control_plane_auth);
  } catch {
    controlPlaneAuthRequired = Boolean(getAuth0Config());
  }
}

async function syncAdminUi(): Promise<void> {
  const auth0Config = getAuth0Config();
  await loadControlPlaneAuthFlag();

  if (!controlPlaneAuthRequired) {
    authControls.hidden = true;
    adminGateHintEl.textContent =
      "Control plane auth is off (local dev). Add MCP / create agent without sign-in.";
    adminOpsEnabled = true;
    setFormEnabled(addMcpForm, true);
    setFormEnabled(createAgentForm, true);
    return;
  }

  if (!auth0Config) {
    authControls.hidden = true;
    adminGateHintEl.textContent =
      "Set VITE_AUTH0_* on the UI and MCP_JWT_* on the proxy for operator sign-in.";
    adminOpsEnabled = false;
    setFormEnabled(addMcpForm, false);
    setFormEnabled(createAgentForm, false);
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isAuth0Authenticated();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;

  if (!authenticated) {
    authStatusEl.textContent = "Sign in to manage MCPs and agents";
    adminGateHintEl.textContent = `Requires Auth0 permission ${GATEWAY_ADMIN_PERMISSION}.`;
    adminOpsEnabled = false;
    setFormEnabled(addMcpForm, false);
    setFormEnabled(createAgentForm, false);
    return;
  }

  authStatusEl.textContent = await getAuth0UserLabel();
  const isAdmin = await hasGatewayAdminPermission();
  if (!isAdmin) {
    adminGateHintEl.textContent = `Signed in, but your token lacks ${GATEWAY_ADMIN_PERMISSION}. Assign it in Auth0, then sign out/in.`;
    adminOpsEnabled = false;
    setFormEnabled(addMcpForm, false);
    setFormEnabled(createAgentForm, false);
    return;
  }

  adminGateHintEl.textContent = `Control plane unlocked (${GATEWAY_ADMIN_PERMISSION}).`;
  adminOpsEnabled = true;
  setFormEnabled(addMcpForm, true);
  setFormEnabled(createAgentForm, true);
}

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

function syncSendButtonState(): void {
  sendBtn.disabled = !(selectedAgent && gatewayAgent);
}

async function refreshAgents(): Promise<void> {
  try {
    const listed = await listAgents();
    const sessions = readAgentSessions();
    agents = listed.map((record) => {
      const session = sessions[record.auth0ClientId];
      return {
        name: record.name,
        clientId: record.auth0ClientId,
        clientSecret: "",
        token: session?.token ?? "",
        scopes: record.scopes,
        serverId: record.serverId,
      };
    });
    if (
      selectedAgent &&
      !agents.some((a) => a.clientId === selectedAgent!.clientId)
    ) {
      selectedAgent = null;
      gatewayAgent = null;
      syncSendButtonState();
    }
    renderAgentCards();
  } catch {
    renderAgentCards();
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
    (btn as HTMLButtonElement).disabled = !adminOpsEnabled;
    btn.addEventListener("click", () => {
      if (!adminOpsEnabled) return;
      const id = (btn as HTMLElement).dataset.removeMcp!;
      if (!confirm(`Remove MCP server "${id}"? Any agent using it will stop working until it is re-registered.`)) {
        return;
      }
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
        <button type="button" data-revoke-agent="${a.clientId}" ${adminOpsEnabled ? "" : "disabled"}>Revoke</button>
      </div>`,
    )
    .join("");

  agentListEl.querySelectorAll("[data-select-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.selectAgent!;
      void activateSelectedAgent(id);
    });
  });

  agentListEl.querySelectorAll("[data-revoke-agent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!adminOpsEnabled) return;
      const id = (btn as HTMLElement).dataset.revokeAgent!;
      void (async () => {
        await revokeAgent(id);
        agents = agents.filter((a) => a.clientId !== id);
        removeAgentSession(id);
        if (selectedAgent?.clientId === id) selectedAgent = null;
        gatewayAgent = null;
        syncSendButtonState();
        statusEl.textContent = "Select or create an agent, then Initialize";
        renderAgentCards();
      })();
    });
  });
}

async function activateSelectedAgent(clientId: string): Promise<void> {
  const meta = agents.find((a) => a.clientId === clientId);
  if (!meta) return;

  statusEl.textContent = "Activating agent…";
  try {
    let token = readAgentSessions()[clientId]?.token;
    if (!token) {
      const vended = await activateAgentToken(clientId);
      token = vended.token;
      writeAgentSession(clientId, { token });
    }
    selectedAgent = { ...meta, token, clientSecret: "" };
    gatewayAgent = null;
    statusEl.textContent = `Selected ${meta.name}`;
    syncSendButtonState();
    renderAgentCards();
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  }
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

async function refreshPending(): Promise<void> {
  try {
    const items = await listPendingRequests();
    renderPendingList(pendingListEl, items, {
      onApprove: (id) => {
        void approvePendingRequest(id, "admin")
          .then(() => refreshPending())
          .catch((err) => { statusEl.textContent = err instanceof Error ? err.message : String(err); });
      },
      onDeny: (id) => {
        void denyPendingRequest(id, "admin")
          .then(() => refreshPending())
          .catch((err) => { statusEl.textContent = err instanceof Error ? err.message : String(err); });
      },
    });
  } catch (err) {
    pendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

pendingRefreshBtn.addEventListener("click", () => void refreshPending());

addMcpForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!adminOpsEnabled) {
    statusEl.textContent = `Sign in with ${GATEWAY_ADMIN_PERMISSION} first`;
    return;
  }
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
  const upstreamTokenEnv =
    ((form.elements.namedItem("mcp-upstream-token-env") as HTMLInputElement)?.value ?? "").trim() || undefined;
  const serverId = slugify(name) || slugify(url);
  void addServer({ id: serverId, url, scopes, upstream_token_env: upstreamTokenEnv })
    .then(() => {
      form.reset();
      statusEl.textContent = `MCP registered: ${serverId}`;
      return refreshServers();
    })
    .catch((err) => {
      statusEl.textContent = err instanceof Error ? err.message : String(err);
    });
});

createAgentForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!adminOpsEnabled) {
    statusEl.textContent = `Sign in with ${GATEWAY_ADMIN_PERMISSION} first`;
    return;
  }
  const form = e.target as HTMLFormElement;
  const name = (form.elements.namedItem("agent-name") as HTMLInputElement).value;
  const serverId = (form.elements.namedItem("agent-mcp") as HTMLSelectElement).value;
  const scopesRaw = (form.elements.namedItem("agent-scopes") as HTMLInputElement).value;
  const scopes = scopesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  void (async () => {
    statusEl.textContent = "Creating agent…";
    const created = await createAgent(name, scopes, serverId);
    const vended = await vendToken(created.clientId, created.clientSecret);
    writeAgentSession(created.clientId, { token: vended.token });
    const agent: ActiveAgent = {
      name: created.name,
      clientId: created.clientId,
      clientSecret: "",
      token: vended.token,
      scopes,
      serverId: created.serverId ?? serverId,
    };
    agents.push(agent);
    selectedAgent = agent;
    statusEl.textContent = `Agent ${name} created`;
    syncSendButtonState();
    renderAgentCards();
    form.reset();
  })().catch((err) => {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  });
});

function updateAgentMcpSelect(): void {
  const sel = document.getElementById("agent-mcp") as HTMLSelectElement;
  // Don't clobber the dropdown while the user has it open
  if (document.activeElement === sel) return;
  const newIds = servers.map((s) => s.id);
  const currentIds = Array.from(sel.options).map((o) => o.value);
  if (newIds.join(",") === currentIds.join(",")) return;
  const prev = sel.value;
  sel.innerHTML = newIds.map((id) => `<option value="${id}">${id}</option>`).join("");
  if (prev && newIds.includes(prev)) sel.value = prev;
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
    const auth0 = getAuth0Config();
    const jwtTrust = auth0 ? jwtTrustFromAuth0(auth0) : {};
    gatewayAgent = new GatewayAgent({
      serverId: selectedAgent.serverId,
      guardConfig: guardConfigForServer(serverMeta),
      mcpUrl: mcpUrlForServer(selectedAgent.serverId),
      jwt: selectedAgent.token,
      publicKeyPem,
      ...jwtTrust,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      llmId,
      onStatus: (s) => {
        statusEl.textContent = s;
      },
      onMessage: (role, content) => appendChat(role, content),
      onAudit: () => void refreshAudit(),
    });
    await gatewayAgent.init();
    syncSendButtonState();
    startAuditPoll();
    await refreshAudit();
    appendChat("system", `Agent ready — ${selectedAgent.name} → ${selectedAgent.serverId}`);
    initBtn.disabled = false;
  })().catch((err) => {
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    syncSendButtonState();
    initBtn.disabled = false;
  });
});

sendBtn.addEventListener("click", () => {
  void (async () => {
    const text = inputEl.value.trim();
    if (!text) return;
    if (!selectedAgent) {
      statusEl.textContent = "Select or create an agent first";
      syncSendButtonState();
      return;
    }
    if (!gatewayAgent) {
      statusEl.textContent = "Initialize the selected agent before sending";
      syncSendButtonState();
      return;
    }
    inputEl.value = "";
    sendBtn.disabled = true;
    try {
      gatewayAgent.setLlmId(llmSelect.value as LlmProviderId);
      await gatewayAgent.chat(text);
      await refreshAudit();
    } finally {
      syncSendButtonState();
    }
  })();
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

authLoginBtn.addEventListener("click", () => void loginWithAuth0());
authLogoutBtn.addEventListener("click", () => {
  gatewayAgent = null;
  selectedAgent = null;
  syncSendButtonState();
  void logoutAuth0().then(() => syncAdminUi());
});

populateLlmSelect();
syncSendButtonState();
void syncAdminUi().then(() =>
  refreshServers()
    .then(() => refreshAgents())
    .then(() => {
      updateAgentMcpSelect();
      setInterval(updateAgentMcpSelect, 3000);
      void refreshPending();
      setInterval(() => void refreshPending(), 5000);
    }),
);
