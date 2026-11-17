# Ask AI settings copy (#642)

`capture.mjs` builds the real `AiAnswersPage` and design system with the compiled
EN/AR catalogs. Hooks return fictional capabilities and status; mutations throw
if invoked. The small navigation fixture uses the real `sectionLabelKey('ai')`
mapping. These are component captures, not a signed-in dashboard or production
acceptance run.

The matrix covers unavailable, off (including the idle source checklist), ready,
and error (daily limit exhausted), in EN/AR at 390/1440 px in light/dark themes.
Assertions check the localized brand, switch state or absence, navigation name,
error text, page errors, and horizontal overflow. `evidence.json` records the run.

Reproduce after installing dependencies and compiling i18n. Configure
`NIBLEAF_DEVSTACK_LOCK` to the machine-wide shared lock directory and verify
that ports 4310 and 4410 are not already listening before capture:

```sh
node .github/assets/ask-ai-settings-copy/capture.mjs
```

Respect the shared heavy-command RAM/lock gate before running. The script requires
the shared lock configuration, acquires it, and uses `withLocalOnlyBrowser`, allowing only
`localhost:4310`, with no custom domains. Built files are answered by interception;
no app/API server, database, production proxy, or provider is started or contacted.
The local-only helper fails the run if any non-local address is attempted.

Static screenshots are the evidence for this copy-only change: there is no
interaction or motion change requiring a video. Feature availability and switch
behavior remain derived from the unmodified runtime capability model.
