# Repo cleanup + landing page — design

Date: 2026-07-20
Source: cursor review of `main`@ecdfe95, plus follow-up asks from Peter (obfuscate named colleagues, remove personally-identifying screenshot content, GUI framing).

## Problem

Three unrelated issues surfaced in the same review pass:

1. **Sensitive content committed to a public repo.** `CHANGELOG.md`/`backlog.md` name a specific internal colleague by full name; six demo screenshots under `docs/images/demo/` show real personal browser chrome (bookmarks bar, tabs), and two of those also show a real personal Gmail address inside the app UI itself.
2. **Repo hygiene drift.** Junk scratch files at repo root, a broken example (wrong tool names, a token key that doesn't exist), and two backlog bookkeeping gaps (an item filed under the wrong priority section, two items cited in shipped docs but never given a row in `backlog.md`).
3. **The GUI still visually undersells the product.** All three UI entry points (`index.html`, `agents.html`, `claude-ops.html`) already share one nav bar and title, but `/` defaults to the flight chat POC — the thing the review says should be demoted, not featured.

None of this needs new gateway logic — it's redaction, deletion, doc fixes, and rearranging existing static pages.

## Scope

**In this PR:**
- Redact the named-colleague mentions to a generic reference
- Crop/redact the 6 screenshots with personal browser chrome
- Delete 4 junk root `.md` files
- Fix `examples/python-agent` (wrong tool names, wrong token key)
- Fix backlog.md: move BL-038 to the P1 section it already belongs to; file proper rows for BL-046 and BL-048 (both already described in shipped docs, just missing their backlog row)
- New root landing page + move flight demo off `/`, add one-line role caption to every page

**Explicitly deferred (separate follow-up work, not blocking):**
- Version/release cut (package.json + ROADMAP + RELEASE.md sync) — a release action, not hygiene
- BL-045 close-out — needs a live Render prod check, not a code edit
- BL-043/044 — need their own implementation work, not a docs fix
- `config.prod.yaml` vs `config.yaml` CI alignment check — a new CI feature
- Broader README/ROADMAP/CONCEPT "future tense" drift language — larger doc surface, scoped separately
- pptx edit — skipped per Peter (already generic, "The SVP" with no name attached)

## 1. Sensitive content

**Named colleague.** `CHANGELOG.md:11` and `backlog.md:284-287` each name a specific colleague by full name in the BL-047 cross-project note. Reword to refer to them generically (e.g. "an internal colleague's AI Proxy Engine project") — the technical content of the note (the cross-project observation about audit trail completeness) is unchanged, only the attribution.

**Screenshots.** 6 files need the top browser-chrome strip (address bar + bookmarks bar) cropped out:
`slack-approval-queue.png`, `slack-grafana-overview.png`, `auth0-access-token-jwtio.png`, `track2-github-agent-client-deny.png`, `claude-code-ops-approval.png`, `prod-ui-audit-success.png`.

The last two also show a real personal Gmail address inside the app's own "Sign out" row (not just the browser chrome) — that region gets a solid redaction box drawn over it in addition to the crop, since cropping the top strip alone won't remove it.

All edits are non-destructive in the sense that the app content / demo narrative in each image is preserved — only the browser frame and the one email string are removed. No other screenshots need changes (the rest either have no browser chrome, or only show information already public by design — the repo's own GitHub owner name/handle, or the intentional `demo-read@mcp-tool-guard.com` demo persona documented in CLAUDE.md).

## 2. Hygiene fixes

- Delete `firstslice.md`, `new-pat-local.md`, `prod-smoke-sliceB.md`, `smoke-pat-prod.md` (root-level scratch artifacts, no references elsewhere).
- `examples/python-agent/agent.py`: `search_flights` → `search_flights_tool`, `create_booking` → `create_booking_tool` (matching `servers/flight/server.py`'s actual `@mcp.tool()` names).
- `examples/python-agent/README.md`: same tool-name fixes in the sample output; `demo-tokens.json.full_access` → `demo-tokens.json.booking` (the only key that actually grants write scope and skips the approval flow).
- `backlog.md`: move the BL-038 entry from under `## P0 (next)` to `## P1 (important)` (its own `priority:` field already says P1 — it's filed under the wrong header, not misprioritized). Add rows for BL-046 (formal `X-Client-Type` header — already described in `docs/superpowers/specs/2026-07-19-claude-ops-view-design.md`) and BL-048 (agent-provisioning UX gap: `/agents.html`'s create-agent flow never surfaces a `clientSecret` — already described in `docs/claude-code-demo.md`), sourced from those docs.

## 3. Landing page

Current state: `index.html` (flight, at `/`), `agents.html`, `claude-ops.html` already share one `<nav class="site-nav">` and duplicate the "MCPToolGuard" `<h1>`; they differ only in nav order/active-link, `<h1>` text, and the one-line tagline under it.

Change:
- New minimal `index.html` at `/`: title + one-line project description ("JWT-scoped firewall for AI agent tool calls — proxy enforces, agents can't escalate their own access") + the same nav, reordered **Agent gateway → Claude Code ops → Flight demo (POC)**. No embedded app content — just the header and three links, so the first thing anyone sees is what the project is and where to go, not any one sub-page's UI.
- Move current flight-chat page content to `/flight-demo.html` (not `/flight.html` — `ui/vite.config.ts`'s dev proxy already maps the `/flight` prefix to the backend flight API; a same-named static page would collide with that proxy rule).
- Update the shared nav across all 4 pages to the new order and hrefs; append "(POC)" to the flight nav label and its on-page tagline.
- `ui/vite.config.ts`: update `build.rollupOptions.input` to add the new landing entry and rename `main` to point at the new flight page path.

## Testing

No new automated test — nothing here touches gateway enforcement logic (the only workspace with a test suite; see CLAUDE.md). Verification is manual:
- Visually re-check each cropped/redacted image
- `make dev`, confirm `/` shows the new landing page, all 3 nav links resolve, flight demo still functions at its new path
- `npm run typecheck` and `npm run check:demo-policy` stay green (touching HTML/vite config/backlog.md, not gateway policy, but both are CI gates worth confirming locally)

## Out of scope reminders

Per CLAUDE.md workflow rules: new branch, PR only, no direct `main` commits, no `gh` usage, CHANGELOG.md `[Unreleased]` entry required.
