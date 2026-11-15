# Site footer: one draft per scope, and cleared values that stay cleared

**Component fixture, not the dashboard and not production.** Captures of Site configuration → Footer as it opens in
the editor's Configuration canvas, in English and Arabic at 1440 px and 390 px (light theme), and one recording of the
new form in use. Nothing here says anything about real sites, phones or screen readers.

## How they were made

`capture.mjs` builds a temporary Vite fixture from the real code: the section (through its compatibility re-export
`components/project-settings/footer-section.tsx`), the design system, the EN/AR catalogs, the project and language
queries and both save mutations. It opens the fixture in the local headless Chromium through
`tests/integration/lib/capture-env.mjs`, which keeps the browser local-only. It was run while holding the repository's
heavy-step lock.

The site ("Handbook") and its Arabic language (with SEO and a banner that belong to other forms) are fictional. Every
request is answered by interception on the fixture origin:

- the project and language `GET`s are served from an in-page store;
- a project `PATCH` merges `config.footer` key by key; a language `PATCH` sets the language's footer, and
  `footer: null` drops it and keeps its SEO and banner. That is a stand-in for the API; the real validators and merges
  are covered by `apps/server/src/actions/projects.test.ts` and `languages.writes.test.ts`.

No server, database or real site was used, and 0 requests left the fixture origin. The temporary build was deleted
after the run.

## Files

| Files | What it shows |
| --- | --- |
| `project-cleared-{en,ar}-{1440,390}.png` | The Default scope with the GitHub link and the copyright cleared, unsaved: the page's save bar says so. Links read left to right in Arabic too; the copyright field lets its text decide (`dir="auto"`). No `PATCH` was sent (asserted for every still). |
| `arabic-scope-{en,ar}-{1440,390}.png` | The Arabic scope: an Arabic copyright typed right to left over the project's as placeholder; the social links and the badge read-only, each saying it is global. |
| `flow-en-1440.webm` | The new form in use, step by step below. |
| `main-tests.txt` | The clearing regression run against main's component and this branch's: main drops the cleared key from the request. |

## The recording, step by step

`evidence.json` → `recordings[0].steps` reads back every step: the field values, which are read-only, the toasts,
whether Save shows, the save bar's status, the request count and the fixture's stored footer.

1. Default scope, pristine: no save bar.
2. The GitHub link and the copyright are cleared, then Save: one `PATCH` with only `github: ""` and `copyright: ""` (a project
   save sends only the keys the person changed), a refetch
   of the project, the status says "Saved", and the form is clean on the stored blanks.
3. The badge is turned off: the toggle alone shows the save bar. Saved as `{ "madeWithBadge": false }` alone.
4. The Arabic scope: links and badge read-only. A padded Arabic copyright is saved as
   `{ "config": { "footer": { "copyright": "…" } } }`, trimmed, with no social link or badge in it.
5. It is cleared and saved: `{ "config": { "footer": null } }`. The Arabic SEO and banner are kept.
6. Back to Default: the stored project footer (blank copyright and GitHub, badge off).
