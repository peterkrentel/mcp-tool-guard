"""Restore the public request path on Vercel.

vercel.json rewrites /mcp, /health and /audit to /api?__path=<original>. The Vercel Python
runtime may hand the app the rewritten URL, so put the original path back before routing.
The public /mcp (and the bare /api) map to wherever MCP is mounted in this entrypoint.
"""

import json
from urllib.parse import parse_qsl, urlencode

PATH_PARAM = "__path"
DEBUG_PARAM = "__debug"


class OriginalPathMiddleware:
    def __init__(self, app, mcp_path: str, entry: str):
        self.app = app
        self.mcp_path = mcp_path
        self.entry = entry

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        params = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
        original = next((v for k, v in params if k == PATH_PARAM), None)
        if any(k == DEBUG_PARAM for k, _ in params):
            body = json.dumps({
                "entry": self.entry,
                "path": scope.get("path"),
                "root_path": scope.get("root_path"),
                "raw_path": (scope.get("raw_path") or b"").decode(),
                "query": scope.get("query_string", b"").decode(),
            }).encode()
            await send({"type": "http.response.start", "status": 200,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
            return
        path = original if original is not None else scope["path"]
        if path in ("/mcp", "/api"):
            path = self.mcp_path
        scope = dict(scope)
        scope["path"] = path
        scope["raw_path"] = path.encode()
        scope["query_string"] = urlencode([(k, v) for k, v in params if k != PATH_PARAM]).encode()
        await self.app(scope, receive, send)
