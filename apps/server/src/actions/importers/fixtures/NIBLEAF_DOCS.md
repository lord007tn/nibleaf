The Nibleaf preserve-mode golden uses `nibleaf-docs.source.zip`, recorded from
`lord007tn/nibleaf` at `72699708f3939eb503ab31053b136b2776988573`.
The archive contains the original Markdown/MDX/JSON bytes and a manifest of all
repository paths under `docs/`. Image bytes are omitted; their paths remain in
the mock repository so asset-reference rewriting is exercised without downloads.

The separate current-repository test still imports today's `docs/` twice and
checks preserve-mode equality. Its content is allowed to change independently
of the pinned conversion golden, including in GitHub's PR merge checkout.

To deliberately refresh the recording, run:

```sh
pnpm --filter @nibleaf/server fixtures:record-docs <full-commit-SHA>
```

Update the expected revision in `mintlify.test.ts`, regenerate the golden using
the unchanged baseline importer for that revision, and review the output diff.
No Git history or network access is required when the fixture runs in CI.
