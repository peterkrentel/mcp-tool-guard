"""ASGI middleware — enforce JWT scopes on MCP tools/call."""

from __future__ import annotations

import json
from typing import Any

from guard import FlightToolGuard


class JwtToolGuardMiddleware:
    def __init__(self, app: Any, guard: FlightToolGuard) -> None:
        self.app = app
        self.guard = guard

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or not self.guard.enabled:
            await self.app(scope, receive, send)
            return

        if scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return

        body = await _read_body(receive)
        replay = _replay_receive(body, receive)

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            await self.app(scope, replay, send)
            return

        if payload.get("method") != "tools/call":
            await self.app(scope, replay, send)
            return

        tool_name = payload.get("params", {}).get("name", "")
        request_id = payload.get("id")
        bearer = FlightToolGuard.extract_bearer(_extract_header(scope, "authorization"))

        trace_id = _extract_header(scope, "x-trace-id")
        session_id = _extract_header(scope, "x-session-id")

        result = self.guard.authorize(
            tool_name,
            bearer,
            session_id=session_id,
            trace_id=trace_id,
        )
        if not result.allowed:
            message = result.reason or "Access denied"
            await _send_jsonrpc_error(scope, send, request_id, message)
            return

        await self.app(scope, replay, send)


async def _read_body(receive: Any) -> bytes:
    body = b""
    while True:
        message = await receive()
        if message["type"] == "http.disconnect":
            break
        if message["type"] != "http.request":
            continue
        body += message.get("body", b"")
        if not message.get("more_body", False):
            break
    return body


def _replay_receive(body: bytes, receive: Any) -> Any:
    """Replay the cached request body, then forward to the original receive.

    FastMCP may call receive() during SSE streaming to detect client disconnect;
    returning a fake http.disconnect after the first replay breaks those responses.
    """
    sent = False

    async def inner() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return inner


def _extract_header(scope: dict[str, Any], name: str) -> str | None:
    target = name.lower().encode()
    for key, value in scope.get("headers", []):
        if key.lower() == target:
            return value.decode("latin-1")
    return None


async def _send_jsonrpc_error(
    scope: dict[str, Any],
    send: Any,
    request_id: Any,
    message: str,
) -> None:
    body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32001, "message": message},
        }
    ).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 403,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
