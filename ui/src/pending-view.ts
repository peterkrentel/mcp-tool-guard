import type { PendingRequest } from "./proxy-api.js";

export interface PendingListHandlers {
  onApprove(id: string): void;
  onDeny(id: string): void;
}

export function renderPendingList(
  container: HTMLElement,
  items: PendingRequest[],
  handlers: PendingListHandlers,
): void {
  if (items.length === 0) {
    container.innerHTML = '<p class="admin-hint">No pending requests.</p>';
    return;
  }

  container.innerHTML = items
    .map((p) => {
      const age = p.requested_at ? Math.round((Date.now() - new Date(p.requested_at).getTime()) / 1000) : "?";
      const badge = p.status === "pending"
        ? '<span style="color:#f90;font-weight:600">PENDING</span>'
        : p.status === "approved"
        ? '<span style="color:#4c4;font-weight:600">APPROVED</span>'
        : '<span style="color:#c44;font-weight:600">DENIED</span>';
      return `<div class="card" style="border-left:3px solid ${p.status === "pending" ? "#f90" : p.status === "approved" ? "#4c4" : "#c44"}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${p.tool}</strong>${badge}
        </div>
        <div class="card-meta">server: ${p.server_id} &nbsp;·&nbsp; needs: <code>${p.required_scope}</code></div>
        <div class="card-meta">agent has: ${(p.token_scopes ?? []).join(", ") || "(none)"}</div>
        <div class="card-meta mono" style="font-size:.7rem">${p.id} &nbsp;·&nbsp; ${age}s ago</div>
        ${p.status === "pending" ? `
        <div style="display:flex;gap:.5rem;margin-top:.4rem">
          <button type="button" data-approve="${p.id}" style="background:#2a5;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Approve</button>
          <button type="button" data-deny="${p.id}" style="background:#a22;color:#fff;border:none;padding:.25rem .75rem;border-radius:4px;cursor:pointer">Deny</button>
        </div>` : p.resolved_by ? `<div class="card-meta">by ${p.resolved_by}</div>` : ""}
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onApprove((btn as HTMLElement).dataset.approve!);
    });
  });

  container.querySelectorAll("[data-deny]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onDeny((btn as HTMLElement).dataset.deny!);
    });
  });
}
