# Reader search query limit

The captures use the actual reader search dialog and the repository's fictional
`preview-harbor` site, served locally on app port 4310 with the dependency-free
API mock on port 4410. No database, account, provider, or production data is used.

Each before/after pair shows a valid query followed by a native clipboard paste
that exceeds the API's 200-code-point budget, on the same implementation. The
after state keeps whole graphemes and shows the localized limit hint.

| View | Before overflowing paste | After cut |
| --- | --- | --- |
| English desktop, 1280 × 800 | [Before](before-en-desktop.png) | [After](after-en-desktop.png) |
| Arabic desktop, 1280 × 800 | [Before](before-ar-desktop.png) | [After](after-ar-desktop.png) |
| English mobile viewport, 390 × 844 | [Before](before-en-mobile.png) | [After](after-en-mobile.png) |
| Arabic mobile viewport, 390 × 844 | [Before](before-ar-mobile.png) | [After](after-ar-mobile.png) |

[Interaction recording](interaction.webm) and [browser assertions](checks.json)
are produced by `tests/integration/reader-search-query/browser.mjs` using
`withLocalOnlyBrowser`. Set `NIBLEAF_DEVSTACK_LOCK` to the owner-provided shared
lock directory and acquire it as `reader/853` before starting the local stack.
The script verifies ownership and leaves service teardown and lock release to
the caller. It rejects non-local network attempts.

The browser regression uses native clipboard paste and Ctrl+Z in English and
Arabic, asserting that undo restores the exact text and caret or selection from
before the paste, and that subsequent typing edits at that restored position.
Forced unavailable, false-returning and throwing native-insertion cases reject
overflow without changing prior text, caret or the preceding undo entry. These
forced failures in Chromium do not establish native behavior in another browser.
It also checks selection replacement and stable live-region text.

Composition tests dispatch synthetic events in both event orders, including
Latin combining text and a first grapheme larger than the entire budget, which
must stay uncut while active without sending an empty request. This coverage does
not establish actual OS IME, Safari,
Gboard device, software-keyboard, or screen-reader speech behavior. Mobile
captures use desktop Chromium with a resized viewport.
