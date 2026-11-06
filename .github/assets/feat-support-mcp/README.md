# Evidence for the support MCP pull request

Captured on 2026-11-06 from a local stack built from this branch: dashboard, API and worker, with Postgres, ClickHouse (`ANALYTICS_MODE=clickhouse`), Dragonfly and MaxIO. Accounts and data are seeded test fixtures (`demo@nibleaf.test` is the owner, `support@nibleaf.test` is a plain `member`), not real people. Visitor searches and feedback were sent through the public site endpoints.

## Secrets

Every API key in the screenshots and videos is masked in the page before it is painted, so no frame contains a key. The dashboard's normal "ending in XXXX" hint is the only part shown. OAuth tokens never reach the browser, so no page shows one. Preview tokens in the AI replays are shortened.

## Files

### Before and after

| File | What it shows |
|---|---|
| `before-api-keys-{en,ar}-{desktop,mobile390}.png` | Before: the admin-only "API keys" tab (base-branch components; the scope list is limited to the scopes that existed then). |
| `after-member-{en,ar}-{desktop,mobile390}.png` | After, as a `member`: "Connect by signing in (recommended)" with the endpoint URL, then presets for a personal key, and their own keys. Each key shows its preset, one plain sentence, last used and latest activity; raw scopes sit in a collapsed "Technical details". Connected apps follows. |
| `after-owner-{en,ar}-desktop.png` | After, as the owner: everyone's keys with "Created by". The owner can revoke them but can't rotate someone else's key. |

### Connecting by signing in (OAuth)

| File | What it shows |
|---|---|
| `oauth-connect-{en-desktop,ar-mobile390}.gif` / `.webm` | A real MCP client (the MCP TypeScript SDK) adds the URL. The person signs in, chooses a project and a permission level, and approves. |
| `oauth-project-{en-desktop,ar-mobile390}.png` | The project step. Same-named projects show their workspace and slug. Full admin is offered only to admins. |
| `oauth-consent-{en-desktop,ar-mobile390}.png` | The consent step, in plain words. |
| `connected-apps-en-desktop.png`, `connected-apps-after-disconnect-en-desktop.png` | Settings lists the connected app with its permission level and latest activity. Disconnecting it stops it at once: its next request gets `401 invalid_token`. |
| `ai-client-oauth.gif` | Claude Code connected by signing in (see "AI client replays" below). |

### Connecting with a personal key

| File | What it shows |
|---|---|
| `key-setup-walkthrough-{en-desktop,ar-mobile390}.gif` | In order: preset, key created (masked), setup for Claude Desktop, VS Code and ChatGPT, Test connection, then the AI app's first request. |
| `key-setup-{en-desktop,ar-mobile390}.webm` | Continuous recordings of the same flow (Playwright video). |
| `walk-{en-desktop,ar-mobile390}-5-ai-app-connected.png` | "Connected · 26 tools available" from the dashboard's own test. Below it, "Your AI app is using this key." appears only after a separate MCP SDK client used the key. |

### The support journey

| File | What it shows |
|---|---|
| `ai-client-journey.gif` | Claude Code with a member's Support writer key (see below). |
| `journey-2-editor-draft.png`, `journey-2-publish-dialog.png` | The person reviews the AI draft in the editor. The dashboard publish dialog lists the same two changes the AI previewed. |
| `journey-3-live-{en,ar}-{desktop,mobile390}.png` | The published English page and its Arabic translation on the live site. |

## AI client replays

Both GIFs are terminal-style renderings of real `claude -p` turns (Claude Sonnet 5.5, `--strict-mcp-config` with only the Nibleaf server), taken from the recorded stream-json transcripts. Lines are not edited, with two exceptions: Arabic text is shown as `[Arabic]` because the renderer cannot shape it, and preview tokens are shortened.

- `ai-client-journey.gif` (personal key, five turns): the AI finds the searches with no results, drafts the missing Okta article, previews and publishes it once the person confirms, translates it to Arabic, then publishes again. Phase 1 ran before commit `30658049`, which fixed a page-feedback language filter. That is why it reports no page feedback for the week; tests cover the fix.
- `ai-client-oauth.gif` (OAuth access token from the sign-in flow): the weekly docs health report, then a small edit made with `update_page`. The edit carries the expected revision, so a person's newer edit is never overwritten. It ends with a publish preview; the AI does not publish.

The same SDK client also completed the sign-in flow with DPoP-bound tokens (`token_type: DPoP`). Replaying such a token without a proof is refused with `401` and an explanation in `WWW-Authenticate`.
