#!/usr/bin/env python3
"""
Minimal Python backend agent — demonstrates non-browser MCP tool calls
through the mcp-tool-guard proxy.

Usage:
  export GATEWAY_URL=https://your-gateway.onrender.com
  export AGENT_JWT=<your-demo-or-m2m-token>   # or set AGENT_JWT_FILE
  python agent.py

The agent calls 'search_flights_tool' (read_only scope) then attempts
'create_booking_tool' (write scope) — the latter returns 202 + pending_id
unless the token already has write scope (see AGENT_JWT below).
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8787")
SERVER_ID = os.environ.get("SERVER_ID", "flight")

# Token resolution: env var takes priority, then file path
def load_jwt() -> str:
    token = os.environ.get("AGENT_JWT", "").strip()
    if token:
        return token
    token_file = os.environ.get("AGENT_JWT_FILE", "").strip()
    if token_file:
        path = Path(token_file).expanduser()
        if path.exists():
            return path.read_text().strip()
    # Dev fallback: read from the demo-tokens.json shipped with the UI
    demo_path = Path(__file__).parents[2] / "ui" / "public" / "demo-tokens.json"
    if demo_path.exists():
        tokens = json.loads(demo_path.read_text())
        print("[agent] Using demo read_only token from ui/public/demo-tokens.json", file=sys.stderr)
        return tokens.get("read_only", "")
    raise RuntimeError(
        "No JWT found. Set AGENT_JWT or AGENT_JWT_FILE environment variable."
    )


# ---------------------------------------------------------------------------
# MCP JSON-RPC over HTTP (stateless, SSE not required for tools/call)
# ---------------------------------------------------------------------------
_req_id = 0

def next_id() -> int:
    global _req_id
    _req_id += 1
    return _req_id


def mcp_call(
    tool: str,
    arguments: dict,
    jwt: str,
    approval_token: str | None = None,
) -> dict:
    """
    Send a tools/call JSON-RPC request to the guard proxy.
    Returns the raw response dict (may include result, error, or status='pending').
    """
    url = f"{GATEWAY_URL.rstrip('/')}/{SERVER_ID}/mcp"
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": next_id(),
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }).encode()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {jwt}",
        "X-Agent-Id": "python-backend-agent",
    }
    if approval_token:
        headers["X-Approval-Token"] = approval_token

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        # 202 is returned as an HTTPError by urllib; parse and return
        if e.code == 202:
            return json.loads(body)
        raise RuntimeError(f"HTTP {e.code}: {body}") from e


def gateway_get(path: str, jwt: str, pending_poll_token: str | None = None) -> dict:
    url = f"{GATEWAY_URL.rstrip('/')}{path}"
    headers = {"Authorization": f"Bearer {jwt}"}
    if pending_poll_token:
        headers["X-Pending-Token"] = pending_poll_token
    req = urllib.request.Request(
        url,
        headers=headers,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ---------------------------------------------------------------------------
# Approval polling helper
# ---------------------------------------------------------------------------
def wait_for_approval(
    pending_id: str,
    jwt: str,
    pending_poll_token: str | None = None,
    timeout: int = 60,
) -> str | None:
    """
    Poll GET /pending/:id until status='approved' and approval_token is present.
    Returns the approval_token or None on timeout/denial.
    """
    print(f"[agent] Waiting for approval of pending request {pending_id} …")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            data = gateway_get(
                f"/pending/{pending_id}",
                jwt,
                pending_poll_token=pending_poll_token,
            )
        except Exception as exc:
            print(f"[agent] Poll error: {exc}", file=sys.stderr)
            time.sleep(2)
            continue

        item = data.get("pending", {})
        status = item.get("status", "pending")
        if status == "approved":
            token = data.get("approval_token")
            if token:
                print(f"[agent] Approved — got approval token")
                return token
        elif status == "denied":
            print("[agent] Request denied by operator.")
            return None
        time.sleep(1)

    print("[agent] Timed out waiting for approval.")
    return None


# ---------------------------------------------------------------------------
# Main agent logic
# ---------------------------------------------------------------------------
def run() -> None:
    jwt = load_jwt()
    print(f"[agent] Gateway: {GATEWAY_URL}  Server: {SERVER_ID}")

    # --- Tool 1: search_flights_tool (read_only scope — should always succeed) ---
    print("\n[agent] Calling search_flights_tool …")
    result = mcp_call("search_flights_tool", {"origin": "JFK", "destination": "LHR"}, jwt)
    if "result" in result:
        content = result["result"].get("content", [])
        for block in content:
            if block.get("type") == "text":
                print("[agent] Flights:", block["text"][:300])
    elif result.get("result", {}).get("status") == "pending":
        print("[agent] search_flights_tool returned pending — unexpected (read_only scope)")
    elif "error" in result:
        print(f"[agent] search_flights_tool error: {result['error']}")

    # --- Tool 2: create_booking_tool (write scope — may return 202 pending) ---
    print("\n[agent] Calling create_booking_tool …")
    result = mcp_call(
        "create_booking_tool",
        {"flight_id": "FL001", "passenger_name": "Ada Lovelace", "seat": "12A"},
        jwt,
    )

    inner = result.get("result", {})
    if inner.get("status") == "pending":
        pending_id = inner.get("pending_id")
        pending_poll_token = inner.get("pending_poll_token")
        print(f"[agent] Booking requires approval — pending_id: {pending_id}")
        approval_token = wait_for_approval(
            pending_id,
            jwt,
            pending_poll_token=pending_poll_token,
        )
        if approval_token:
            print("[agent] Retrying create_booking_tool with approval token …")
            retry = mcp_call(
                "create_booking_tool",
                {"flight_id": "FL001", "passenger_name": "Ada Lovelace", "seat": "12A"},
                jwt,
                approval_token=approval_token,
            )
            content = retry.get("result", {}).get("content", [])
            for block in content:
                if block.get("type") == "text":
                    print("[agent] Booking result:", block["text"])
        # else: denied or timed out — already printed
    elif "result" in result:
        content = inner.get("content", [])
        for block in content:
            if block.get("type") == "text":
                print("[agent] Booking result:", block["text"])
    elif "error" in result:
        print(f"[agent] create_booking_tool error: {result['error']['message']}")

    print("\n[agent] Done.")


if __name__ == "__main__":
    run()
