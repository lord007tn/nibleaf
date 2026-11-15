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
