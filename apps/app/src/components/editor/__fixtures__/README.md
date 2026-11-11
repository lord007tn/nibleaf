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
