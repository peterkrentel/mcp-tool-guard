"""Restore the public request path on Vercel.

vercel.json rewrites /mcp, /health and /audit to /api?__path=<original>. The Vercel Python
runtime may hand the app the rewritten URL, so put the original path back before routing.
The public /mcp (and the bare /api) map to wherever MCP is mounted in this entrypoint.
"""

from urllib.parse import parse_qsl, urlencode

PATH_PARAM = "__path"


class OriginalPathMiddleware:
    def __init__(self, app, mcp_path: str):
        self.app = app
        self.mcp_path = mcp_path

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        params = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
        original = next((v for k, v in params if k == PATH_PARAM), None)
        path = original if original is not None else scope["path"]
        if path in ("/mcp", "/api"):
            path = self.mcp_path
        scope = dict(scope)
        scope["path"] = path
        scope["raw_path"] = path.encode()
        scope["query_string"] = urlencode([(k, v) for k, v in params if k != PATH_PARAM]).encode()
        await self.app(scope, receive, send)
