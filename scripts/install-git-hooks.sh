#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SOURCE_HOOK="$REPO_ROOT/.githooks/pre-commit"
TARGET_HOOK="$HOOKS_DIR/pre-commit"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "ERROR: .git/hooks not found. Run from inside a git worktree." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_HOOK" ]]; then
  echo "ERROR: source hook not found: $SOURCE_HOOK" >&2
  exit 1
fi

cp "$SOURCE_HOOK" "$TARGET_HOOK"
chmod +x "$TARGET_HOOK"

echo "Installed pre-commit hook: $TARGET_HOOK"
