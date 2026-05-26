"""Vercel serverless entrypoint for the Flight MCP server."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import create_app  # noqa: E402

# Vercel routes /api/* to this handler; mount MCP at root of the function.
app = create_app("/")
