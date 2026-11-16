These fictional clipboard samples retain the characteristic Google Docs internal
GUID wrapper, CSS marks, paragraph-wrapped lists and Notion block/checkbox
wrappers. They are representative regression fixtures, reconstructed from those
formats, not authenticated captures from a live Google Docs or Notion account.
No customer content or identifiers are included.

`google-docs.reconstructed.html` and `notion.reconstructed.html` describe the same three-level
bullet/numbered tree, including editor filler paragraphs and breaks.
Google Docs includes `aria-level`, `role="presentation"`, styled spans and
sibling child lists, rather than assuming every list is already inside its li.
`mixed-document.reconstructed.html` also covers headings, marks, links, code, tables, tasks and
Arabic text. Browser media uses synthetic paste events carrying these samples.

`jsx-openers-main.json` holds main's (14209455) results for the component opening tags
that `jsx-openers-match-main.test.ts` generates: the nodes each page loads as, its save, and
its save after the title or caption is edited, plus whether `@mdx-js/mdx` compiles the page.
The test checks the editor still gives main's results, except for the Frames #579 reads with
no backslash escapes, which the test sets out. Regenerate it only when attribute parsing
changes on purpose, by running the test's generator against that version's editor.

`non-frame-main.json` holds a digest of main's result (nodes, save, save after an attribute
edit) for each page without a Frame that `frame-main-differential.test.ts` generates: seeded
component openers and the serializer corpus's pages. It was made by running that test against
main's editor with `WRITE_NON_FRAME_MAIN=1`.

`non-frame-714-main.json` holds main's result (nodes, save, save after an attribute edit) for
the pages of that test with a value #714 reads differently or a character inserted into the
opener, where main saves the page with a loss; each record hashes to its digest in
`non-frame-main.json`. For the `{/"/}` value it also holds main's save of the same page with the
value a plain `"x"`. The test's #714 exception reads them. It was made by running that test
against main's `mdx-roundtrip.ts` with `WRITE_NON_FRAME_714_MAIN=1`.

`blank-line-attribute-main.json` holds a digest of main's result (nodes with their attributes,
save, save after an attribute edit) for each page that `attribute-blank-line-main-differential.test.ts`
generates: seeded openers for every registry component with no blank line inside any attribute
value, the serializer corpus, the generated opening tags above and the hard-wrapped pages. It was
made by running that test against main's `mdx-roundtrip.ts` with `WRITE_BLANK_LINE_MAIN=1` (#721).

`autosave-writes-main.json` holds how many writes main (5eae6bf7) sent for each seeded sequence
of edits, undos, flushes and landed writes in the #728 differential of
`routes/app/projects/$projectId/-editor-typing-latency.test.tsx`. The test checks the editor never
sends more (#735). It was made by running that test against main's `editor-save-queue.ts` with
`WRITE_AUTOSAVE_WRITES_MAIN=1`. Regenerate it only when the sequences change on purpose.

`autosave-review-main.json` holds main's (5eae6bf7) result for each seed of the #735 review
differential in the same test file: the writes sent, and whether the server ended with the final
draft. Those sequences add another client's copy arriving and the server storing a write
normalized. The test checks the editor never sends more writes, and stores the final draft
whenever main did. It was made against main's `editor-save-queue.ts` with
`WRITE_AUTOSAVE_REVIEW_MAIN=1`.
