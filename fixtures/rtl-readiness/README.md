# RTL documentation readiness fixtures

These fixtures exercise rubric `0.1.0` in the client-side Nibleaf RTL
documentation readiness grader. They are deliberately small and deterministic:

- `strong.html` contains positive evidence for every static check it can prove;
- `gaps.html` contains explicit failures rather than merely omitting optional
  content; and
- `ambiguous.html` demonstrates that unavailable evidence is reported as
  `unknown`, not converted into a failure or a zero.

`expected.json` records the stable summary expected from the current engine.
Browser-rendered navigation, search behavior, focus order, API controls, and
390-pixel layout remain manual or browser-automation checks. The local static
engine never claims to prove them.

Run the corpus with:

```bash
pnpm --filter @nibleaf/app test -- rtl-readiness.test.ts
```

Corrections should include the fixture, expected result, rationale, and rubric
version change when scoring semantics change.

