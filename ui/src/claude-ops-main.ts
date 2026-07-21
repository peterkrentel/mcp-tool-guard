import {
  approvePendingRequest,
  denyPendingRequest,
  fetchGatewayAudit,
  listPendingRequests,
  setAdminTokenProvider,
} from "./proxy-api.js";
import { renderPendingList } from "./pending-view.js";
import { renderThreeLayerAudit } from "./agents-audit-view.js";
import { classifyClientType, type ClientType } from "./client-type.js";
import {
  GATEWAY_ADMIN_PERMISSION,
  getAuth0AccessToken,
  getAuth0Config,
  getAuth0UserLabel,
  handleAuthRedirect,
  hasGatewayAdminPermission,
  isAuth0Authenticated,
  loginWithAuth0,
  logoutAuth0,
} from "./auth.js";
import { resolveProxyBase } from "./config.js";

const authControls = document.getElementById("auth-controls")!;
const authLoginBtn = document.getElementById("auth-login") as HTMLButtonElement;
const authLogoutBtn = document.getElementById("auth-logout") as HTMLButtonElement;
const authStatusEl = document.getElementById("auth-status")!;
const adminGateHintEl = document.getElementById("admin-gate-hint")!;
const clientTypeSelect = document.getElementById("client-type-select") as HTMLSelectElement;
const opsPendingListEl = document.getElementById("ops-pending-list")!;
const opsAuditEl = document.getElementById("ops-audit")!;

let controlPlaneAuthRequired = false;
let opsEnabled = false;
let demoBearer = "";
let poll: ReturnType<typeof setInterval> | null = null;

setAdminTokenProvider(async () => {
  if (!getAuth0Config() || !(await isAuth0Authenticated())) return null;
  return getAuth0AccessToken();
});

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

async function syncOpsAdminGate(): Promise<void> {
  const auth0Config = getAuth0Config();
  await loadControlPlaneAuthFlag();

  if (!controlPlaneAuthRequired) {
    authControls.hidden = true;
    adminGateHintEl.textContent = "Control plane auth is off (local dev). Viewing without sign-in.";
    opsEnabled = true;
    return;
  }

  if (!auth0Config) {
    authControls.hidden = true;
    adminGateHintEl.textContent = "Set VITE_AUTH0_* on the UI and MCP_JWT_* on the proxy for operator sign-in.";
    opsEnabled = false;
    return;
  }

  authControls.hidden = false;
  await handleAuthRedirect();

  const authenticated = await isAuth0Authenticated();
  authLoginBtn.hidden = authenticated;
  authLogoutBtn.hidden = !authenticated;

  if (!authenticated) {
    authStatusEl.textContent = "Sign in to view Claude Code ops";
    adminGateHintEl.textContent = `Requires Auth0 permission ${GATEWAY_ADMIN_PERMISSION}.`;
    opsEnabled = false;
    return;
  }

  authStatusEl.textContent = await getAuth0UserLabel();
  const isAdmin = await hasGatewayAdminPermission();
  if (!isAdmin) {
    adminGateHintEl.textContent = `Signed in, but your token lacks ${GATEWAY_ADMIN_PERMISSION}. Assign it in Auth0, then sign out/in.`;
    opsEnabled = false;
    return;
  }

  adminGateHintEl.textContent = `Control plane unlocked (${GATEWAY_ADMIN_PERMISSION}).`;
  opsEnabled = true;
}

async function ensureDemoBearer(): Promise<string> {
  if (demoBearer) return demoBearer;
  const tokens = (await fetch("/demo-tokens.json").then((r) => r.json())) as Record<string, string>;
  demoBearer = tokens.admin ?? "";
  return demoBearer;
}

function selectedClientType(): ClientType | "all" {
  return clientTypeSelect.value as ClientType | "all";
}

async function refreshOpsPending(): Promise<void> {
  if (!opsEnabled) {
    opsPendingListEl.innerHTML = '<p class="admin-hint">Sign in to view pending requests.</p>';
    return;
  }
  try {
    const items = await listPendingRequests();
    const selected = selectedClientType();
    const filtered = selected === "all"
      ? items
      : items.filter((p) => classifyClientType(p.trace_id) === selected);
    renderPendingList(opsPendingListEl, filtered, {
      onApprove: (id) => {
        void approvePendingRequest(id, "admin")
          .then(() => refreshOpsPending())
          .catch((err) => {
            opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
          });
      },
      onDeny: (id) => {
        void denyPendingRequest(id, "admin")
          .then(() => refreshOpsPending())
          .catch((err) => {
            opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
          });
      },
    });
  } catch (err) {
    opsPendingListEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

async function refreshOpsAudit(): Promise<void> {
  if (!opsEnabled) {
    opsAuditEl.innerHTML = '<p class="admin-hint">Sign in to view audit activity.</p>';
    return;
  }
  try {
    const bearer = await ensureDemoBearer();
    const entries = await fetchGatewayAudit(bearer);
    const selected = selectedClientType();
    const filtered = selected === "all"
      ? entries
      : entries.filter((e) => classifyClientType(e.trace_id) === selected);
    renderThreeLayerAudit(opsAuditEl, filtered, "");
  } catch (err) {
    opsAuditEl.innerHTML = `<div class="log-error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}

function startOpsPoll(): void {
  if (poll) clearInterval(poll);
  poll = setInterval(() => {
    void refreshOpsPending();
    void refreshOpsAudit();
  }, 10000);
}

clientTypeSelect.addEventListener("change", () => {
  void refreshOpsPending();
  void refreshOpsAudit();
});

authLoginBtn.addEventListener("click", () => void loginWithAuth0());
authLogoutBtn.addEventListener("click", () => {
  void logoutAuth0().then(() => syncOpsAdminGate());
});

void syncOpsAdminGate().then(() => {
  void refreshOpsPending();
  void refreshOpsAudit();
  startOpsPoll();
});
