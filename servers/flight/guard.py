"""Server-side JWT scope enforcement for Flight MCP (mirrors gateway/guard.ts)."""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jwt
import yaml

logger = logging.getLogger("mcp-tool-guard")

SERVER_ID = "flight"


@dataclass
class ToolConfig:
    required_scope: str
    alert: bool = False
    log_level: str = "info"


@dataclass
class GuardResult:
    allowed: bool
    required_scope: str
    reason: str | None = None
    token_scopes: list[str] = field(default_factory=list)


@dataclass
class AuditEntry:
    timestamp: str
    decision: str
    server: str
    tool: str
    required_scope: str
    token_scopes: list[str]
    reason: str | None = None
    alert: bool = False
    duration_ms: int | None = None


class FlightToolGuard:
    def __init__(self, tools: dict[str, ToolConfig], public_key_pem: str) -> None:
        self.tools = tools
        self.public_key_pem = public_key_pem
        self.enabled = os.environ.get("MCP_GUARD_ENABLED", "true").lower() != "false"
        self._audit: list[AuditEntry] = []

    @classmethod
    def load(cls) -> FlightToolGuard:
        config_path = Path(__file__).parent / "guard_config.yaml"
        raw = yaml.safe_load(config_path.read_text())
        tools_raw = raw.get("tools", {})
        tools = {
            name: ToolConfig(
                required_scope=cfg["required_scope"],
                alert=bool(cfg.get("alert", False)),
                log_level=str(cfg.get("log_level", "info")),
            )
            for name, cfg in tools_raw.items()
        }
        return cls(tools=tools, public_key_pem=_load_public_key_pem())

    @staticmethod
    def extract_scopes(payload: dict[str, Any]) -> list[str]:
        raw = payload.get("scope") or payload.get("scopes") or payload.get("scp")
        if not raw:
            return []
        if isinstance(raw, list):
            return [str(s) for s in raw]
        return [s for s in str(raw).replace(",", " ").split() if s]

    @staticmethod
    def has_scope(token_scopes: list[str], required: str) -> bool:
        if required in token_scopes:
            return True
        resource = required.split(":", 1)[0]
        return f"{resource}:*" in token_scopes or "*" in token_scopes

    def _log(self, entry: AuditEntry, tool_cfg: ToolConfig | None) -> None:
        self._audit.append(entry)
        payload = {
            "timestamp": entry.timestamp,
            "decision": entry.decision,
            "server": entry.server,
            "tool": entry.tool,
            "required_scope": entry.required_scope,
            "token_scopes": entry.token_scopes,
            "reason": entry.reason,
            "duration_ms": entry.duration_ms,
        }
        if tool_cfg and tool_cfg.alert:
            logger.warning("[MCPToolGuard ALERT] %s", json.dumps(payload))
        else:
            logger.info("[MCPToolGuard] %s", json.dumps(payload))

    def authorize(self, tool: str, bearer_token: str | None) -> GuardResult:
        start = time.perf_counter()
        tool_cfg = self.tools.get(tool)
        required = tool_cfg.required_scope if tool_cfg else "(unknown)"

        if not bearer_token:
            self._log(
                AuditEntry(
                    timestamp=_now(),
                    decision="deny",
                    server=SERVER_ID,
                    tool=tool,
                    required_scope=required,
                    token_scopes=[],
                    reason="Missing Authorization: Bearer token",
                    duration_ms=_ms(start),
                ),
                tool_cfg,
            )
            return GuardResult(
                allowed=False,
                required_scope=required,
                reason="Missing Authorization: Bearer token",
            )

        try:
            payload = jwt.decode(
                bearer_token,
                self.public_key_pem,
                algorithms=["RS256"],
            )
            scopes = self.extract_scopes(payload)
        except jwt.PyJWTError as exc:
            self._log(
                AuditEntry(
                    timestamp=_now(),
                    decision="deny",
                    server=SERVER_ID,
                    tool=tool,
                    required_scope=required,
                    token_scopes=[],
                    reason=f"JWT validation failed: {exc}",
                    duration_ms=_ms(start),
                ),
                tool_cfg,
            )
            return GuardResult(
                allowed=False,
                required_scope=required,
                reason=f"JWT validation failed: {exc}",
            )

        if not tool_cfg:
            reason = f"Tool '{tool}' not configured for server '{SERVER_ID}'"
            self._log(
                AuditEntry(
                    timestamp=_now(),
                    decision="deny",
                    server=SERVER_ID,
                    tool=tool,
                    required_scope="(unknown)",
                    token_scopes=scopes,
                    reason=reason,
                    duration_ms=_ms(start),
                ),
                None,
            )
            return GuardResult(allowed=False, required_scope="(unknown)", reason=reason, token_scopes=scopes)

        allowed = self.has_scope(scopes, tool_cfg.required_scope)
        reason = None if allowed else f"Missing required scope '{tool_cfg.required_scope}'"
        self._log(
            AuditEntry(
                timestamp=_now(),
                decision="allow" if allowed else "deny",
                server=SERVER_ID,
                tool=tool,
                required_scope=tool_cfg.required_scope,
                token_scopes=scopes,
                reason=reason,
                alert=tool_cfg.alert,
                duration_ms=_ms(start),
            ),
            tool_cfg,
        )
        return GuardResult(
            allowed=allowed,
            required_scope=tool_cfg.required_scope,
            reason=reason,
            token_scopes=scopes,
        )

    def recent_audit(self, limit: int = 100) -> list[dict[str, Any]]:
        return [
            {
                "timestamp": e.timestamp,
                "decision": e.decision,
                "server": e.server,
                "tool": e.tool,
                "required_scope": e.required_scope,
                "token_scopes": e.token_scopes,
                "reason": e.reason,
            }
            for e in self._audit[-limit:]
        ]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _load_public_key_pem() -> str:
    inline = os.environ.get("MCP_GUARD_PUBLIC_KEY_PEM")
    if inline:
        return inline.replace("\\n", "\n")

    root = Path(__file__).resolve().parent
    repo = root.parent.parent
    for candidate in (
        root / "demo-public.pem",
        repo / "ui" / "public" / "demo-public.pem",
        repo / "keys" / "demo-public.pem",
    ):
        if candidate.is_file():
            return candidate.read_text()

    raise RuntimeError(
        "No JWT public key found. Set MCP_GUARD_PUBLIC_KEY_PEM or run make keys."
    )
