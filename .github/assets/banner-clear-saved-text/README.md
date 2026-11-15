# Banner settings: cleared saved text stays cleared

Component-fixture captures of Site configuration → Banner, with the reader banner rendered from the stored config.
These are **not** signed-in dashboard, server or production screenshots.

`capture.mjs` builds the real Banner settings form and the real reader `SiteBanner` with Vite. Before is both from the
merge base with `main`; after is this branch. The build includes the design system, the EN/AR catalogs, TanStack Query
and the app's own mutations. The page runs in headless Chromium through `tests/integration/lib/capture-env.mjs`, which
takes the dev-stack lock and lets no request leave the fixture origin.

The API is answered by interception with fictional data. A project PATCH merges `config.banner` one level deep and keeps
any key the patch leaves out, like the server's `mergeConfig`; the stored config survives a reload, so a reload is the
remount and refetch. The real `mergeConfig` and route validator are exercised by `apps/server/src/actions/projects.test.ts`,
not here. No server, database or account was used, and 0 requests went outside. The temporary build is deleted after the run.

| File | What it shows |
| --- | --- |
| `sheet-{en,ar}-{1440,390}-{light,dark}.png` | Before \| after, three rows, each "clear one saved field, save, reload": **message**, **link label**, **link address**. Before, the PATCH leaves the cleared key out, the merge keeps the old text and it comes back. After, the PATCH sends `""` and the field stays empty (the grey text is the field's placeholder). The reader follows: no banner without a message, no link without an address, and a blank label with an address reads "View details" / "عرض التفاصيل". |
| `flow-after-en-1440.webm` | After, EN, 1440, light. Clear the link label, save, reopen: still empty, the reader link reads "View details". Clear the message, save, reopen: still empty, no reader banner. |
| `evidence.json` | Per capture: the PATCH body, the config read back after the reload, each field's value, whether Save is offered, the reader banner's message and link (href and name), `dir`, page errors (none) and overflow (none). Also the recording's requests and steps. |

The script asserts on every run: before, the cleared key is missing from the PATCH and the old text returns; after, the
PATCH carries `""`, the readback keeps the sibling sections, the field is empty, and the reader shows exactly the
behaviour above. It also checks no overflow, no page errors and no outside requests.
