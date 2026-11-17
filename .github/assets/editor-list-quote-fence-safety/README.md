# PR #843 regression repair evidence

The regression suite is `apps/app/src/components/editor/list-quote-fence-safety.test.ts`.
No pre-existing test or fixture expectations were changed.

## Nested quote fitting

Input (JSON string): `"- Top\n  - > Alpha"`.

- Before: `"- Top\n  - \n\n  > Alpha"`. The empty marker becomes a setext underline.
- After, matching main: `"- Top\n\n  - \n\n  > Alpha"`.

Four cases check main's exact saved bytes and render the saved page through the
actual `MarkdownRenderer`. They require `<p dir="auto">Top</p>` and reject `<h2`.
The fix propagates nested items' schema-fitting safety to their ancestors while
allowing a safe loose child list to keep its tight parent.

## Literal quote characters in code

Input (JSON string): `"- ~~~js\n  >\n- b"`.

- Before: `"- ~~~js\n  >\n  ~~~\n- b"`.
- After, matching main and the original source: `"- ~~~js\n  >\n- b"`.

Sixteen cases cover `~~~`, five tildes, three backticks and four backticks with
`>`, `>>`, `> >` and a leading space before `>`, over four load/save cycles.
Four more cases put the literal character behind actual quote and nested-list
prefixes. Only those real prefixes are removed before the whitespace check.
Four preservation guards cover empty unclosed fences, whose last source line is
their opener rather than code; these also pass on the original PR head.
The PR's original ten list/fence tests remain unchanged.

## Visual verification scope

The task prohibits a development server, so no running-app screenshots or video
were captured. Exact saved-source assertions and actual published-reader HTML
assertions provide the equivalent verification for these serialization repairs;
video would add no interaction evidence. No deployment or live-site claim is made.
