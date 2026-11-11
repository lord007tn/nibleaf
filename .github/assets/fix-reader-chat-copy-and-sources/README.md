# Reader chat: clean copy and one title per page

Captured with headless Chromium against an isolated local stack, taken under the shared dev-stack lock and removed
right after. The site was built from this repo's own EN/AR product docs. "Connect a custom domain" is English-only on
purpose.

No AI provider key is configured locally. The reader, the panel and this PR's code are real. The answers were replayed
into the panel in the exact SSE/AG-UI wire format the chat API emits, with the seeded pages' real sections and
heading ids. Same method as `operations/ux/reader-ask-ai.md` §1.

- `en-1440-light-01-answer`, `en-1440-dark-01-answer`, `en-390-light-01-answer`: the answer. Step 3 cites a second
  chunk of **Add your domain** (`[S4]`), so its chip reads **1**, like the first citation of that section.
- `*-02-sources*`: the sources list. **Connect a custom domain** is shown once, with its three sections numbered
  1–3. "Add your domain" is listed once, though two chunks of it were cited.
- `en-1440-light-03-sources-two-pages`: an answer citing two pages lists each page once, in the order it is first
  cited.
- `ar-1440-*-0[12]-*-ar-docs`, `ar-390-light-0[12]-*`: an Arabic answer from Arabic docs. The page groups lay out
  right to left.
- `ar-1440-light-03-sources-en-docs`: an Arabic answer from English-only docs. The English page group keeps its
  left-to-right layout.
- `en-copied.txt`, `ar-copied.txt`: what **Copy answer** put on the clipboard as plain text, read back from the
  browser's clipboard.
