import { mergeLanguageChrome } from '@nibleaf/shared';
import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  addRow,
  cleanAnchors,
  cleanRows,
  editRow,
  languageNavbarConfig,
  languageNavbarValues,
  type NavbarConfig,
  type NavbarValues,
  navbarProblems,
  navbarValues,
  projectNavbarPatch,
  removeRow,
  restoreRow,
  sentNavbarValues,
} from './navbar';

/** As stored: every field set, rows with and without `external`, an anchor with and without an icon. */
const STORED: NavbarConfig = {
  ctaLabel: 'Book a demo',
  ctaUrl: 'https://example.com/demo',
  links: [
    { label: 'Docs', href: '/docs' },
    { label: 'Blog', href: 'https://blog.example.com', external: true },
    { label: 'Status', href: 'https://status.example.com', external: false },
  ],
  tabs: [{ label: 'Guides', href: '/guides' }],
  anchors: [
    { label: 'Community', href: 'https://community.example.com', icon: 'users', external: true },
    { label: 'Support', href: 'mailto:help@example.com' },
  ],
  showSearch: false,
  changelog: true,
};

/**
 * The API's config merge (apps/server/src/actions/projects.ts `mergeConfig`):
 * an array replaces the stored one, an object merges one level deep.
 */
const mergeConfig = (existing: Record<string, unknown>, incoming: Record<string, unknown>) => {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key];
    merged[key] = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), ...value }
        : value;
  }
  return merged;
};
/**
 * A project save as the API takes it: the patch against `baseline` (by default
 * what is stored), through real JSON and `updateProjectBody`, merged into what
 * is stored, refetched.
 */
const saveProject = (stored: NavbarConfig | undefined, values: NavbarValues, baseline = navbarValues(stored)) => {
  const body = updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { navbar: projectNavbarPatch(values, baseline) } })));
  const config = JSON.parse(JSON.stringify(mergeConfig(stored ? { navbar: stored } : {}, body.config ?? {}))) as { navbar: NavbarConfig };
  return config.navbar;
};

describe('navbarValues', () => {
  it('reads every stored field, text and order as stored, `external` only where it was stored', () => {
    const values = navbarValues(STORED);
    expect(values.links).toStrictEqual([
      { label: 'Docs', href: '/docs' },
      { label: 'Blog', href: 'https://blog.example.com', external: true },
      { label: 'Status', href: 'https://status.example.com', external: false },
    ]);
    expect(values.anchors).toStrictEqual([
      { label: 'Community', href: 'https://community.example.com', icon: 'users', external: true },
      { label: 'Support', href: 'mailto:help@example.com', icon: '' },
    ]);
    expect(values).toMatchObject({ ctaLabel: 'Book a demo', ctaUrl: 'https://example.com/demo', showSearch: false, changelog: true });
  });

  it('defaults: blank CTA, empty lists, search on and the changelog link off', () => {
    expect(navbarValues(undefined)).toStrictEqual({ ctaLabel: '', ctaUrl: '', links: [], tabs: [], anchors: [], showSearch: true, changelog: false });
    expect(navbarValues({ showSearch: true, changelog: false })).toMatchObject({ showSearch: true, changelog: false });
  });

  it("a language scope: its own CTA label and lists beside the project's CTA URL and switches", () => {
    const values = languageNavbarValues({ ctaLabel: 'احجز', links: [{ label: 'التوثيق', href: '/docs' }] }, STORED);
    expect(values).toStrictEqual({
      ctaLabel: 'احجز',
      ctaUrl: 'https://example.com/demo',
      links: [{ label: 'التوثيق', href: '/docs' }],
      tabs: [],
      anchors: [],
      showSearch: false,
      changelog: true,
    });
    expect(languageNavbarValues(null, STORED)).toMatchObject({ ctaLabel: '', links: [], tabs: [], anchors: [] });
  });
});

describe('projectNavbarPatch', () => {
  const baseline = navbarValues(STORED);

  it('sends only the fields the draft changed; an untouched field is left out', () => {
    expect(projectNavbarPatch({ ...baseline, ctaLabel: 'Start' }, baseline)).toStrictEqual({ ctaLabel: 'Start' });
    expect(projectNavbarPatch(baseline, baseline)).toStrictEqual({});
  });

  it('a changed list is sent whole, so removing the last row of each sends []', () => {
    const patch = projectNavbarPatch({ ...baseline, links: [], tabs: [], anchors: [] }, baseline);
    expect(patch).toStrictEqual({ links: [], tabs: [], anchors: [] });
    expect(saveProject(STORED, { ...baseline, links: [], tabs: [], anchors: [] })).toMatchObject({ links: [], tabs: [], anchors: [] });
  });

  it('a changed CTA text is trimmed, and a cleared one is sent as ""', () => {
    expect(projectNavbarPatch({ ...baseline, ctaLabel: '  Start  ', ctaUrl: '   ' }, baseline)).toStrictEqual({ ctaLabel: 'Start', ctaUrl: '' });
  });

  it('keeps row text as typed, in order, with `external` true, false or absent; only fully blank rows are left out', () => {
    const links = [
      { label: '  Docs ', href: ' /docs ' },
      { label: ' ', href: '  ' },
      { label: 'Half', href: '' },
      { label: '', href: '/only-address' },
      { label: 'Blog', href: 'https://blog.example.com', external: true },
      { label: 'Status', href: 'https://status.example.com', external: false },
    ];
    expect(cleanRows(links)).toStrictEqual([
      { label: '  Docs ', href: ' /docs ' },
      { label: 'Half', href: '' },
      { label: '', href: '/only-address' },
      { label: 'Blog', href: 'https://blog.example.com', external: true },
      { label: 'Status', href: 'https://status.example.com', external: false },
    ]);
  });

  it('trims an anchor icon, or leaves it out when blank', () => {
    expect(
      cleanAnchors([
        { label: 'A', href: '/a', icon: '  users ' },
        { label: 'B', href: '/b', icon: '   ', external: true },
      ]),
    ).toStrictEqual([
      { label: 'A', href: '/a', icon: 'users' },
      { label: 'B', href: '/b', external: true },
    ]);
  });

  it('a switch-only edit sends that switch, explicitly', () => {
    expect(projectNavbarPatch({ ...baseline, showSearch: true }, baseline)).toStrictEqual({ showSearch: true });
    expect(saveProject(STORED, { ...baseline, showSearch: true })).toStrictEqual({ ...STORED, showSearch: true });
  });
});

describe('a save through the real validator and merge', () => {
  it('clears a stored CTA: the merge keeps "" instead of the old text, and the reader hides the CTA', () => {
    const navbar = saveProject(STORED, { ...navbarValues(STORED), ctaLabel: '', ctaUrl: '' });
    expect(navbar).toMatchObject({ ctaLabel: '', ctaUrl: '' });
    // The reader shows the CTA only when both texts are truthy.
    expect(Boolean(navbar.ctaLabel && navbar.ctaUrl)).toBe(false);
  });

  it('why a cleared text is sent as "": an omitted one comes back after the merge', () => {
    const body = updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { navbar: { ctaLabel: undefined, links: [] } } })));
    expect((mergeConfig({ navbar: STORED }, body.config ?? {}) as { navbar: NavbarConfig }).navbar.ctaLabel).toBe('Book a demo');
  });

  it("an untouched field keeps another writer's newer value; so does an untouched list", () => {
    const baseline = navbarValues(STORED);
    // Someone else changed the CTA and the tabs after this draft's baseline was read.
    const theirs = { ...STORED, ctaLabel: 'Talk to sales', tabs: [{ label: 'Theirs', href: '/theirs' }] };
    const stored = saveProject(theirs, { ...baseline, links: [{ label: 'Docs', href: '/docs' }] }, baseline);
    expect(stored).toStrictEqual({ ...theirs, links: [{ label: 'Docs', href: '/docs' }] });
  });

  it('what a save stores reads back as `sentNavbarValues` says, for a mixed draft', () => {
    const draft: NavbarValues = {
      ...navbarValues(STORED),
      ctaLabel: '  Start ',
      ctaUrl: '',
      links: [
        { label: ' Docs', href: '/docs ' },
        { label: '', href: '' },
        { label: 'Half', href: '' },
      ],
      anchors: [
        { label: 'A', href: '/a', icon: ' users ', external: false },
        { label: '', href: '', icon: 'ghost' },
      ],
      changelog: false,
    };
    const stored = saveProject(STORED, draft);
    expect(navbarValues(stored)).toStrictEqual(sentNavbarValues('project', draft, navbarValues(STORED)));
    // Saving what was read back sends nothing more.
    expect(projectNavbarPatch(navbarValues(stored), navbarValues(stored))).toStrictEqual({});
  });

  it('keeps the other config sections, and a site without a navbar stores only what changed', () => {
    const fresh = navbarValues(undefined);
    const body = updateProjectBody.parse(
      JSON.parse(JSON.stringify({ config: { navbar: projectNavbarPatch({ ...fresh, changelog: true }, fresh) } })),
    );
    expect(mergeConfig({ footer: { copyright: '© Acme' } }, body.config ?? {})).toStrictEqual({
      footer: { copyright: '© Acme' },
      navbar: { changelog: true },
    });
  });
});

describe('languageNavbarConfig', () => {
  const projectValues = navbarValues(STORED);

  it('sends the full override with its non-empty pieces only, and never the global fields', () => {
    const config = languageNavbarConfig({
      ...projectValues,
      ctaLabel: ' احجز ',
      links: [{ label: 'التوثيق', href: '/docs' }],
      tabs: [],
      anchors: [],
    });
    expect(config).toStrictEqual({ navbar: { ctaLabel: 'احجز', links: [{ label: 'التوثيق', href: '/docs' }] } });
    expect(updateLanguageBody.safeParse({ config }).success).toBe(true);
  });

  it('clears the override with null when every piece is empty, so the project navbar shows', () => {
    const config = languageNavbarConfig({ ...projectValues, ctaLabel: '  ', links: [{ label: '', href: ' ' }], tabs: [], anchors: [] });
    expect(config).toStrictEqual({ navbar: null });
    // The reader then falls back to the project navbar.
    const merged = mergeLanguageChrome({ navbar: STORED }, { navbar: undefined, seo: { metaTitle: 'توثيق' } }) as { navbar: NavbarConfig };
    expect(merged.navbar).toStrictEqual(STORED);
  });

  it('a language override replaces the project lists it sets, and keeps the global fields', () => {
    const { navbar } = languageNavbarConfig({ ...projectValues, ctaLabel: '', links: [{ label: 'التوثيق', href: '/docs' }], tabs: [], anchors: [] });
    const merged = mergeLanguageChrome({ navbar: STORED }, { navbar: navbar ?? undefined }) as { navbar: NavbarConfig };
    expect(merged.navbar).toStrictEqual({ ...STORED, links: [{ label: 'التوثيق', href: '/docs' }] });
  });

  it("`sentNavbarValues` for a language: the cleaned pieces, the project's global fields untouched", () => {
    const draft = { ...projectValues, ctaLabel: ' احجز ', links: [{ label: '', href: '' }], tabs: [{ label: 'أدلة', href: '/guides' }], anchors: [] };
    expect(sentNavbarValues('language', draft, projectValues)).toStrictEqual({
      ...projectValues,
      ctaLabel: 'احجز',
      links: [],
      tabs: [{ label: 'أدلة', href: '/guides' }],
      anchors: [],
    });
  });
});

describe('navbarProblems', () => {
  const clean = navbarValues(STORED);

  it('accepts the stored navbar, half-filled rows, blank rows and relative, mailto and tel addresses', () => {
    const values = {
      ...clean,
      links: [...clean.links, { label: 'Half', href: '' }, { label: '', href: '' }, { label: 'Call', href: 'tel:+15550100' }],
    };
    expect(navbarProblems('project', values, clean)).toStrictEqual([]);
  });

  it('refuses a dangerous scheme at the draft row that has it, past blank rows', () => {
    const links = [
      { label: '', href: '' },
      { label: 'Docs', href: '/docs' },
      { label: 'Bad', href: ' javascript:alert(1)' },
    ];
    const [problem, ...rest] = navbarProblems('project', { ...clean, links }, clean);
    expect(rest).toStrictEqual([]);
    expect(problem).toMatchObject({ key: 'links', rows: [2], fields: ['href'], message: 'Unsupported URL scheme.' });
  });

  it('refuses a dangerous CTA URL in the project scope; a language scope never sends it', () => {
    const values = { ...clean, ctaUrl: 'data:text/html,hi' };
    expect(navbarProblems('project', values, clean)).toMatchObject([{ key: 'ctaUrl', rows: [], fields: [] }]);
    expect(navbarProblems('language', values, clean)).toStrictEqual([]);
  });

  it('too many rows point at the rows past the cap', () => {
    const tabs = Array.from({ length: 12 }, (_, index) => ({ label: `Tab ${index}`, href: `/t${index}` }));
    expect(navbarProblems('project', { ...clean, tabs: [{ label: '', href: '' }, ...tabs] }, clean)).toMatchObject([
      { key: 'tabs', rows: [11, 12], fields: ['label', 'href'] },
    ]);
    expect(navbarProblems('language', { ...clean, tabs }, clean)).toMatchObject([{ key: 'tabs', rows: [10, 11] }]);
  });

  it('an anchor icon over 40 characters is refused on its icon', () => {
    const anchors = [{ label: 'A', href: '/a', icon: 'x'.repeat(41) }];
    expect(navbarProblems('project', { ...clean, anchors }, clean)).toMatchObject([{ key: 'anchors', rows: [0], fields: ['icon'] }]);
  });
});

describe('row edits', () => {
  it("Add appends a blank row; an edit keeps the row's other fields and `external`", () => {
    const rows = addRow([{ label: 'A', href: '/a', icon: 'x', external: true }], { label: '', href: '', icon: '' });
    expect(rows).toHaveLength(2);
    expect(editRow(rows, 0, 'label', 'B')[0]).toStrictEqual({ label: 'B', href: '/a', icon: 'x', external: true });
  });

  it('Remove then restore puts the row back as it was, keeping later edits to its neighbours', () => {
    const rows = navbarValues(STORED).links;
    const { rows: without, removed } = removeRow(rows, 1);
    const edited = editRow(without, 1, 'label', 'Status page');
    expect(restoreRow(edited, 1, removed)).toStrictEqual([rows[0], rows[1], { ...rows[2], label: 'Status page' }]);
    // A list that got shorter takes it back at its end.
    expect(restoreRow([], 0, removed)).toStrictEqual([removed]);
  });
});
