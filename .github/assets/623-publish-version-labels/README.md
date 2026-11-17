# Publish Fix version labels (#623)

The real publish dialog, design system, translations, query hooks and router,
with fictional API responses. These are isolated component captures, not a
signed-in production site. The two Guide pages have identical titles, paths,
languages, problem codes and evidence, in `Stable مستقر` and `Next تجريبي`.

`before-*` reproduces the identical visible and accessible Fix names on the
merge base. `after-*` shows the version inside each Fix link. Both phases cover
English and Arabic, 390 and 1440 pixels, light and dark. The Arabic and English
names mix writing directions. `evidence.json` records the names, target URLs,
requests, console errors and horizontal-overflow checks for all 16 captures.

`fix-navigation.webm` follows the second version's Fix link through the real
router to `/app/projects/project-1/editor?page=page-2` with `fix` and the exact
encoded `fixTarget`. The destination is explicitly a fixture URL receipt. This
does not verify the production editor runtime or a deployment. The dialog
closes and the original page ID and evidence remain intact.

The capture takes `acquireDevstackLock` before building and uses
`withLocalOnlyBrowser` with the local allowlist and fixture custom domain.
It starts no services or network listeners. All API requests are intercepted
GETs; unexpected API requests fail. **Non-local attempts: 0.**

Reproduce from the checkout root after installing dependencies, compiling i18n,
and building the server dependencies and RPC entry. First set
`NIBLEAF_DEVSTACK_LOCK` to the owner's shared machine-wide directory and check
that ports 4310 and 4410 have no listeners:

```sh
node .github/assets/623-publish-version-labels/capture.mjs
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if the installed Chromium differs from the
Playwright default. `NIBLEAF_DEVSTACK_LOCK` is required; the OS Temp default is
not shared by the owner's workflows. An initial capture used that Temp lock
without starting any services; the final captures were repeated under the
correct shared directory lock.
The script fails while another capture owns that lock; wait for its owner to
finish before retrying. Generated temporary harness files and the browser are
removed on completion.

Source contract audit: the worker calls its own `collectPublishIssues` adapter,
not the dialog's `collectPublishChecks` or `PublishCheck` type. The server only
returns these checks through `getPendingChanges`; MCP's pending-changes DTO and
publish preview explicitly select their unchanged fields. The new optional,
read-only server `versionId` comes directly from the snapshot page already in
hand. No publishing behavior, snapshot, worker or MCP output changes.

Focused regression tests additionally cover single-version markup parity,
unknown/missing version metadata, translated accessible names, `onFix`, and
overlong evidence that must not become `fixTarget`. Final cleanup reviewed the
seven changed application/server files and this fixture against that scope;
no additional actionable slop was found.
