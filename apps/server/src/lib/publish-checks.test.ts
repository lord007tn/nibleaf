import { type AddonDeliveryPlanAssignment, projectAddonRowsForDelivery } from '@nibleaf/shared/addons';
import { buildSnapshot, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { collectPublishChecks } from './publish-checks';

let sequence = 0;
const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'path'>): SnapshotPage => {
  sequence += 1;
  const slug = overrides.path.split('/').at(-1) ?? '';
  return {
    id: `page-${sequence}`,
    parentId: null,
    versionId: 'v1',
    updatedAt: '2026-11-01T00:00:00.000Z',
    languageCode: 'en',
    kind: 'PAGE',
    title: `Page ${sequence}`,
    slug,
    icon: null,
    description: null,
    content: 'Some body text.',
    config: null,
    translationKey: null,
    position: sequence,
    hidden: false,
    ...overrides,
  };
};

const snapshot = (pages: SnapshotPage[], config: Record<string, unknown> | null = null, extra: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config,
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
    ],
    versions: [
      { id: 'v1', name: 'Latest', slug: 'latest', isDefault: true },
      { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
    ],
  },
  pages,
  generatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});

const codes = (site: SiteSnapshot, code: string) => collectPublishChecks(site).filter((check) => check.code === code);
const linkChecks = (content: string, others: SnapshotPage[] = [], config: Record<string, unknown> | null = null) => {
  const linking = page({ path: 'guides/intro', title: 'Introduction', content });
  return codes(snapshot([linking, ...others], config), 'broken-internal-link').map((check) => check.detail);
};

describe('broken-internal-link', () => {
  it('flags a link to a page deleted from the snapshot (the audit case) and blocks while the broken-link check is on', () => {
    const configuration = page({ path: 'configuration', title: 'Configuration' });
    const linking = page({ path: 'guides/intro', title: 'Introduction', content: 'See [Configuration](/configuration) for options.' });
    expect(codes(snapshot([linking, configuration]), 'broken-internal-link')).toEqual([]);

    const afterDelete = codes(snapshot([linking]), 'broken-internal-link');
    expect(afterDelete).toEqual([
      {
        code: 'broken-internal-link',
        severity: 'error',
        pageId: linking.id,
        languageCode: 'en',
        title: 'Introduction',
        path: 'guides/intro',
        detail: '/configuration',
      },
    ]);
  });

  it('is a warning when the site turned the broken-link check (or all publish checks) off', () => {
    expect(codes(snapshot([page({ path: 'a', content: '[x](/gone)' })], { addons: { brokenLinks: false } }), 'broken-internal-link')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
    expect(codes(snapshot([page({ path: 'a', content: '[x](/gone)' })], { addons: { ciChecks: false } }), 'broken-internal-link')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
  });

  it('ignores anchors and queries on a page that exists, and reports a missing page with an anchor', () => {
    const target = page({ path: 'configuration' });
    // `configuration#x` is relative, so from guides/intro it means guides/configuration.
    expect(linkChecks('[a](/configuration#options) [b](/configuration?tab=1) [c](#local) [d](configuration#x)', [target])).toEqual([
      'configuration#x',
    ]);
    expect(linkChecks('[a](/configuration#options) [b](/configuration?tab=1) [c](#local) [d](../configuration#x)', [target])).toEqual([]);
    expect(linkChecks('[a](/missing#options)')).toEqual(['/missing#options']);
  });

  it('resolves relative links from the page directory', () => {
    const sibling = page({ path: 'guides/setup' });
    expect(linkChecks('[a](setup) [b](./setup) [c](../guides/setup)', [sibling])).toEqual([]);
    expect(linkChecks('[a](nope)', [sibling])).toEqual(['nope']);
  });

  it('respects language prefixes, ?lang= and the default-language fallback', () => {
    const arabic = page({ path: 'دليل', languageCode: 'ar', title: 'دليل' });
    const english = page({ path: 'setup' });
    expect(
      linkChecks('[a](/ar/دليل) [b](/دليل?lang=ar) [c](/en/setup) [d](/ar/setup) [e](/%D8%AF%D9%84%D9%8A%D9%84?lang=ar)', [arabic, english]),
    ).toEqual([]);
    // An English-only page is not in Arabic, and the Arabic page is not in English.
    expect(linkChecks('[a](/دليل) [b](/ar/missing)', [arabic, english])).toEqual(['/دليل', '/ar/missing']);
  });

  it('accepts group prefixes, the site root, the API reference, reserved files and assets', () => {
    const child = page({ path: 'guides/advanced/tuning' });
    const site = snapshot(
      [
        page({
          path: 'guides/intro',
          content: '[a](/guides/advanced) [b](/) [c](/api-reference) [d](/sitemap.xml) [e](/files/manual.pdf) [f](/changelog)',
        }),
        child,
      ],
      null,
      {
        openapi: { title: 'API', path: 'api-reference', contentHash: 'h', updatedAt: '2026-11-01T00:00:00.000Z', document: {} },
      },
    );
    expect(codes(site, 'broken-internal-link')).toEqual([]);
  });

  it('does not flag a link a redirect covers', () => {
    const redirects = [{ from: '/configuration', to: '/settings' }];
    expect(linkChecks('[a](/configuration) [b](/configuration#top)', [page({ path: 'settings' })], { redirects })).toEqual([]);
  });

  it('ignores external links, mail links and links inside code', () => {
    const content = [
      '[a](https://example.com/missing) [b](mailto:team@example.com) [c](//cdn.example.com/x)',
      'Use `[inline](/inline-missing)` here.',
      '```md',
      '[fenced](/fenced-missing)',
      '```',
      '<pre>[pre](/pre-missing)</pre>',
    ].join('\n');
    expect(linkChecks(content)).toEqual([]);
  });

  it('checks links that render: inline, linked images, used references and component hrefs, not unused definitions', () => {
    const content = [
      'See [the guide][ref] and [![Logo](/logo.png)](/image-link-missing).',
      '',
      '<Card title="Next" href="/card-attribute" />',
      '',
      '[ref]: /reference-missing',
      '[unused]: /unused-definition',
      '',
      '[^1]: A footnote, not a link.',
    ].join('\n');
    expect(linkChecks(content)).toEqual(['/reference-missing', '/image-link-missing', '/card-attribute']);
  });

  it('keeps links inside their docs version', () => {
    const v2Page = page({ path: 'only-in-v2', versionId: 'v2' });
    const v2Linking = page({ path: 'start', versionId: 'v2', content: '[a](/only-in-v2) [b](/only-in-v1)' });
    const v1Page = page({ path: 'only-in-v1' });
    const v1Linking = page({ path: 'home', content: '[a](/v2/only-in-v2) [b](/only-in-v2)' });
    const details = codes(snapshot([v2Page, v2Linking, v1Page, v1Linking]), 'broken-internal-link').map((check) => [check.path, check.detail]);
    expect(details).toEqual([
      ['start', '/only-in-v1'],
      ['home', '/only-in-v2'],
    ]);
  });

  it('does not count hidden pages as targets, and does not check hidden pages', () => {
    const hidden = page({ path: 'secret', hidden: true, content: '[x](/gone)' });
    expect(linkChecks('[a](/secret)', [hidden])).toEqual(['/secret']);
  });
});

describe('missing-alt', () => {
  it('flags markdown and HTML images without alt text', () => {
    const content = [
      '![](/a.png)',
      '![Diagram of the flow](/b.png)',
      '<img src="/c.png" alt="" />',
      '<img src="/d.png" />',
      '<img src="/e.png" alt="Chart" />',
      '<img src="/f.png" alt={caption} />',
    ].join('\n\n');
    expect(codes(snapshot([page({ path: 'a', content })]), 'missing-alt').map((check) => [check.severity, check.detail])).toEqual([
      ['warning', '/a.png'],
      ['warning', '/c.png'],
      ['warning', '/d.png'],
    ]);
  });

  it('ignores images in code', () => {
    expect(codes(snapshot([page({ path: 'a', content: '```\n![](/a.png)\n```' })]), 'missing-alt')).toEqual([]);
  });

  it('flags reference-style images, a multiline <img> and an <img> inside a component', () => {
    const content = [
      '![][shot]',
      '',
      '[shot]: /reference.png',
      '',
      '<img',
      '  src="/multiline.png"',
      '/>',
      '',
      '<Frame>',
      '  <img src="/framed.png" alt="" />',
      '</Frame>',
    ].join('\n');
    expect(codes(snapshot([page({ path: 'a', content })]), 'missing-alt').map((check) => check.detail)).toEqual([
      '/reference.png',
      '/multiline.png',
      '/framed.png',
    ]);
  });
});

describe('untitled-page', () => {
  it.each(['', '  ', 'Untitled', 'صفحة بدون عنوان', 'New group'])('flags the placeholder title %j', (title) => {
    expect(codes(snapshot([page({ path: 'a', title })]), 'untitled-page')).toEqual([expect.objectContaining({ severity: 'warning', detail: '' })]);
  });

  it('accepts a real title that merely contains the word', () => {
    expect(codes(snapshot([page({ path: 'a', title: 'Untitled drafts and how to name them' })]), 'untitled-page')).toEqual([]);
  });
});

describe('stray-characters', () => {
  it('flags a lone slash paragraph and a literal --- that did not become a divider', () => {
    const content = ['Intro.', '', '/', '', '\\---', '', '\\-\\-\\-', '', '<p>---</p>', '', '<p>/</p>', '', '---', '', 'Text after a divider.'].join(
      '\n',
    );
    expect(codes(snapshot([page({ path: 'a', content })]), 'stray-characters').map((check) => check.detail)).toEqual(['/', '---']);
  });

  it('accepts a divider, a path in prose, a table rule and code', () => {
    const content = [
      'Intro.',
      '',
      '---',
      '',
      'Open / to search.',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```',
      '/',
      '\\---',
      '```',
    ].join('\n');
    expect(codes(snapshot([page({ path: 'a', content })]), 'stray-characters')).toEqual([]);
  });
});

describe('unreadable-slug', () => {
  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(81)],
    ['placeholder', 'untitled-3'],
    ['cuid', 'cmh3k2x9q0000abcdefghijkl'],
    ['uuid', '3f2b6c1e-8a4d-4c2e-9b7f-1a2b3c4d5e6f'],
    ['importer id', 'group-9e4c82a8'],
    // Assembled so secret scanners don't read the made-up nanoid-style slug as a credential.
    ['nanoid-style', ['Xk29', 'fLq01', 'ZpR7tYw'].join('')],
    ['percent-encoded', '%D8%AF%D9%84'],
  ])('flags a %s slug', (_label, slug) => {
    expect(codes(snapshot([page({ path: slug || 'x', slug })]), 'unreadable-slug')).toEqual([expect.objectContaining({ detail: slug })]);
  });

  it.each(['getting-started', 'دليل-البدء', 'api-v2', 'oauth2-setup', 'faq', 'ipv6configuration'])('accepts the readable slug %s', (slug) => {
    expect(codes(snapshot([page({ path: slug, slug })]), 'unreadable-slug')).toEqual([]);
  });
});

describe('empty-page', () => {
  it('flags a page with no body but not a group', () => {
    const empty = page({ path: 'a', content: '  \n<!-- todo -->\n' });
    const group = page({ path: 'b', kind: 'GROUP', content: '' });
    expect(codes(snapshot([empty, group]), 'empty-page').map((check) => check.pageId)).toEqual([empty.id]);
  });

  it.each([
    ['only an HTML comment', '<!-- only a comment -->', true],
    ['only an MDX comment', '{/* draft notes */}', true],
    ['several comments and blank lines', '<!-- a -->\n\n{/* b */}\n<!-- c\nspanning lines -->\n', true],
    ['a comment and text', '<!-- note -->\nReal content.', false],
    ['an unclosed comment (rendered as text)', '<!-- never closed', false],
  ])('treats a page with %s as empty: %s', (_case, content, empty) => {
    expect(codes(snapshot([page({ path: 'a', content })]), 'empty-page')).toHaveLength(empty ? 1 : 0);
  });

  it('reports an empty page and every other finding on it: a commented-out link renders nothing', () => {
    const commented = page({ path: 'a', content: '<!-- [a](/missing) -->' });
    expect(collectPublishChecks(snapshot([commented])).map((check) => [check.code, check.detail])).toEqual([['empty-page', '']]);
  });
});

describe('duplicate-title', () => {
  it('flags pages with the same title under the same parent and language only', () => {
    const first = page({ path: 'a', title: 'Setup' });
    const second = page({ path: 'b', title: ' setup ' });
    const otherParent = page({ path: 'g/c', title: 'Setup', parentId: 'group-1' });
    const otherLanguage = page({ path: 'd', title: 'Setup', languageCode: 'ar' });
    const checks = codes(snapshot([first, second, otherParent, otherLanguage]), 'duplicate-title');
    expect(checks.map((check) => [check.pageId, check.detail])).toEqual([
      [first.id, 'b'],
      [second.id, 'a'],
    ]);
  });

  it('leaves untitled duplicates to the untitled check', () => {
    expect(codes(snapshot([page({ path: 'a', title: 'Untitled' }), page({ path: 'b', title: 'Untitled' })]), 'duplicate-title')).toEqual([]);
  });
});

describe('collectPublishChecks', () => {
  it('reports nothing for a clean site and skips disabled languages', () => {
    const site = snapshot([page({ path: 'start', title: 'Start' }), page({ path: 'setup', title: 'Setup', content: 'See [start](/start).' })]);
    expect(collectPublishChecks(site)).toEqual([]);
    const disabled = snapshot([page({ path: 'x', title: 'Untitled', languageCode: 'ar' })]);
    disabled.project.languages = disabled.project.languages.map((language) => (language.code === 'ar' ? { ...language, enabled: false } : language));
    expect(collectPublishChecks(disabled)).toEqual([]);
  });

  it('lists errors first and stays linear on a large site', () => {
    const site = (count: number): SiteSnapshot =>
      snapshot(
        Array.from({ length: count }, (_, index) =>
          page({
            path: `section-${index % 20}/page-${index}`,
            title: `Topic ${index}`,
            content: `[next](/section-${(index + 1) % 20}/page-${index + 1})\n\n![](/img-${index}.png)`,
          }),
        ),
      );
    /** Fastest of a few runs, so one slow tick on a shared CI core can't decide the result. */
    const fastestMs = (input: SiteSnapshot, rounds: number): number => {
      let fastest = Number.POSITIVE_INFINITY;
      for (let round = 0; round < rounds; round += 1) {
        const started = performance.now();
        collectPublishChecks(input);
        fastest = Math.min(fastest, performance.now() - started);
      }
      return fastest;
    };
    const small = site(100);
    const large = site(400);
    collectPublishChecks(small); // warm up the Markdown pipeline
    const checks = collectPublishChecks(large);
    expect(checks[0]).toEqual(expect.objectContaining({ code: 'broken-internal-link', severity: 'error' }));
    expect(checks.filter((check) => check.code === 'missing-alt')).toHaveLength(400);
    // Like against like on the same machine: 4x the pages stays near 4x the
    // time (quadratic work would be 16x), however slow the CI core is.
    expect(fastestMs(large, 2)).toBeLessThanOrEqual(6 * fastestMs(small, 3) + 50);
  });
});

/** Stored add-on rows with CI checks and broken links on, as a new site has. */
const STORED_ADDONS = [
  { key: 'ci-checks', enabled: true, config: {} },
  { key: 'broken-links', enabled: true, config: {} },
];
const deliveringPlan: AddonDeliveryPlanAssignment = {
  status: 'active',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  plan: {
    key: 'free',
    active: true,
    entitlements: ['addons.ci-checks', 'addons.broken-links'].map((capabilityKey) => ({ capabilityKey, enabled: true, meter: null })),
  },
};

/** A draft snapshot built exactly as the worker and `getCurrentSnapshot` build
 *  it: stored add-ons on, then projected through the site's plan assignment. */
function deliveredSnapshot(assignment: AddonDeliveryPlanAssignment | null): SiteSnapshot {
  return buildSnapshot(
    {
      id: 'project-1',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: { addons: { ciChecks: true, brokenLinks: true } },
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null }],
      branches: [{ id: 'b', name: 'main', isDefault: true }],
      addons: projectAddonRowsForDelivery(STORED_ADDONS, assignment, null),
    },
    [
      {
        id: 'intro',
        parentId: null,
        branchId: 'b',
        languageCode: 'en',
        kind: 'PAGE',
        title: 'Intro',
        slug: 'intro',
        path: 'intro',
        icon: null,
        description: null,
        content: 'See [configuration](/configuration).',
        config: null,
        translationKey: null,
        position: 0,
        hidden: false,
        updatedAt: '2026-11-01T00:00:00.000Z',
      },
    ],
    '2026-11-01T00:00:00.000Z',
  );
}

describe('broken-link severity follows the delivered add-on state (as the worker)', () => {
  it('is a warning when the plan does not deliver the add-ons, even though they are stored on', () => {
    expect(codes(deliveredSnapshot(null), 'broken-internal-link')).toEqual([
      expect.objectContaining({ severity: 'warning', detail: '/configuration' }),
    ]);
  });

  it('is an error when a plan delivers the add-ons', () => {
    expect(codes(deliveredSnapshot(deliveringPlan), 'broken-internal-link')).toEqual([
      expect.objectContaining({ severity: 'error', detail: '/configuration' }),
    ]);
  });
});

describe('over-long links in the dialog', () => {
  it('shows only the start of a link too long to serve, with its reason', () => {
    const href = `/${'x'.repeat(3000)}`;
    const [check] = codes(snapshot([page({ path: 'home', content: `See [it](${href}).` })]), 'broken-internal-link');
    expect(check).toMatchObject({ reason: 'path-too-long' });
    expect(check?.detail.length).toBeLessThanOrEqual(81);
    expect(check?.detail.endsWith('…')).toBe(true);
  });
});
