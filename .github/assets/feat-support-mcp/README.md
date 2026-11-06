# Evidence for the support MCP pull request

Captured on 2026-11-06 from a local stack built from this branch: dashboard, API and worker, with Postgres, ClickHouse (`ANALYTICS_MODE=clickhouse`), Dragonfly and MaxIO. Accounts and data are seeded test fixtures (`demo@nibleaf.test` is the owner, `support@nibleaf.test` is a plain `member`), not real people. Visitor searches and feedback were sent through the public site endpoints.

## Secrets

Every API key in the screenshots and videos is masked in the page before it is painted, so no frame contains a key. The dashboard's normal "ending in XXXX" hint is the only part shown. Preview tokens in the AI replay are shortened.

## Files

| File | What it shows |
|---|---|
| `before-api-keys-{en,ar}-{desktop,mobile390}.png` | The previous admin-only "API keys" tab: base-branch components, with the scope list limited to the scopes that existed before this change. |
| `after-member-{en,ar}-{desktop,mobile390}.png` | The new "AI assistants (MCP)" screen as a `member`, with presets, Full admin unavailable, and their own keys. |
| `after-owner-{en,ar}-desktop.png` | The owner sees everyone's keys with "Created by", can revoke them, and cannot rotate someone else's key. |
| `key-setup-walkthrough-{en-desktop,ar-mobile390}.gif` | Captured states: preset, key created (masked), setup for Claude Desktop, VS Code and ChatGPT, then Test connection. |
| `key-setup-{en-desktop,ar-mobile390}.webm` | Continuous recordings of the same flow (Playwright video). |
| `walk-*-4-tested.png` | Test connection result: "Connected · 26 tools available". |
| `ai-client-journey.gif` | Replay of the real Claude Code session against the local MCP endpoint, rendered from its recorded stream-json transcript (see below). |
| `journey-2-editor-draft.png`, `journey-2-publish-dialog.png` | The human reviews the AI draft in the editor. The dashboard publish dialog lists the same two changes the AI previewed. |
| `journey-3-live-{en,ar}-{desktop,mobile390}.png` | The published English page and its Arabic translation on the live site. |

## AI client replay

`ai-client-journey.gif` is a terminal-style rendering of five real `claude -p` turns (Claude Sonnet 5.5, `--strict-mcp-config` with only the Nibleaf server, using the member's Support writer key). The lines are taken from the recorded transcript and not edited, except that Arabic text is shown as `[Arabic]`, because the renderer cannot shape it, and preview tokens are shortened.

Phase 1 ran before commit `30658049`, which fixed a page-feedback language filter. That is why it reports no page feedback for the week; the fix is covered by tests.
