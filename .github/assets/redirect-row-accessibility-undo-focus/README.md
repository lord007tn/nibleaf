# Redirect rows: Remove's name and focus after Undo (#751)

**Component fixture, not the dashboard and not production.** `capture.mjs` builds a temporary Vite fixture from the
real code and opens it in local headless Chromium through `tests/integration/lib/capture-env.mjs`, which keeps the
browser local-only. The fixture includes:

- the Redirects section (before: main's component at the merge base; after: this branch);
- the design system and the EN/AR catalogs;
- the project query and the config mutation;
- the design-system Sonner `Toaster`, placed as the dashboard places it (bottom-right, bottom-left in Arabic).

The sites ("Handbook", "Atlas") and their rules are fictional and public. The project `GET` and config `PATCH` are
answered by interception on the fixture origin; 0 requests left it.

Two pieces are fixture chrome, not product UI:

- the yellow bar at the top shows what has focus, with Chrome's computed role and name;
- the "Handbook / Atlas / Leave" buttons switch site or unmount the section.

Accessible names are Chrome's own (`Element.computedName`, enabled with the `ComputedAccessibilityInfo` Blink feature).
They are not a JavaScript re-implementation. Each step waits on a real signal, such as a toast attached or detached,
the row count, or the save bar going. The only fixed pauses are there for whoever watches the recordings.

## Order of work

1. `main-tests.txt`: the new and updated component tests against main's component, before any change. 11 fail.
2. `repro-main.json` and `repro-before-*.webm`: the same journeys in Chromium on main's component, before any change.
3. `evidence.json`, `before-*.webm` / `after-*.webm` and the sheets: before and after, from the fix commit
   (`head` in `evidence.json`).

## What was found on main

- **Focus after Undo: reproduced.** After a keyboard Undo (Alt+T, Tab, Enter), a mouse click or a phone tap, focus
  ended on Remove rather than on the restored rule. Leaving the toast makes Sonner hand focus back to whatever had it
  before the toast was entered, so the component's own move to the source field was undone.
- **A worse case: Undo without a focus move.** This covers a screen reader's activation or a tap that focuses nothing.
  Main pulled focus into the restored rule's source. The person had been typing in the next rule, and their next key
  went into the restored one: `/legacy` became `/legacy3` and was saved.
- **Remove's name: not reproduced in Chrome.** Chrome already named Remove "Remove redirect /legacy", taking the
  field's value through the embedded-control rule. jsdom's dom-accessibility-api gave "Remove redirect Redirect from
  path", which is what the earlier component test and review saw.

## After

- **Name:** each Remove is named "Remove redirect" plus the rule's source, from a hidden label with an id of its own per
  row. The source is wrapped in U+2066/U+2069, so it reads left to right in an Arabic name too. In `evidence.json` this
  shows as `⁦/legacy⁩`. The name follows the source as it is typed.
- **Keyboard, click or tap:** after Undo, focus lands on the restored rule's source and stays there through the toast's
  exit.
- **Dismissed without Undo:** Sonner returns focus to Remove, as before.
- **Undo without a focus move:** the person keeps their field, value and selection, shifted one row down with their
  rule. Their next key edits their own rule, and Ctrl+S saves exactly that (see the `PATCH` body).
- **Leaving or switching site:** a click on the exiting toast's Undo restores nothing and moves no focus.
- **Keep mine:** Undo still lands on the source. **Use theirs:** a late Undo does nothing.

| Files | What it shows |
| --- | --- |
| `before-keyboard-en-1440.webm`, `after-keyboard-en-1440.webm` | Keyboard Undo, dismiss, mouse Undo, Undo without a focus move then Ctrl+S, and the stale Undo after Leave and after switching to Atlas. |
| `before-phone-ar-390.webm`, `after-phone-ar-390.webm` | Arabic, 390 px, touch: tap Remove, tap Undo. |
| `focus-after-undo-{en,ar}-{1440,390}-{light,dark}.png` | Where focus is once a keyboard Undo's toast has gone: before (left) and after (right). |
| `evidence.json` | Names, every step's rows, focus (role, name, value, selection), toasts, save bar, conflict state and requests. |
