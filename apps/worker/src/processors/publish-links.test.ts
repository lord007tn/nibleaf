import { type AddonDeliveryPlanAssignment, projectAddonRowsForDelivery } from '@nibleaf/shared/addons';
import { buildSnapshot, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({}),
  clickHouseWritesEnabled: () => false,
  deterministicAnalyticsEventId: vi.fn(),
  buildAnalyticsEvent: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ Prisma: { DbNull: null }, prisma: {} }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { SEARCH: 'search', PUBLISH: 'publish' } }));
vi.mock('../lib/publish-activation', () => ({ recordPublishReady: vi.fn() }));
vi.mock('../env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('../lib/notify', () => ({ notifyDeployment: vi.fn() }));
vi.mock('../lib/usage-ingest', () => ({ DurableUsageEnqueueError: Error, enqueueAnalyticsEvent: vi.fn() }));

// The publish dialog's preflight lives in the server app; the parity test runs
// the same snapshot through it and through this worker gate.
import { collectPublishChecks } from '../../../server/src/lib/publish-checks';
import { collectPublishIssues } from './publish';

let sequence = 0;
const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'path'>): SnapshotPage => {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    parentId: null,
    versionId: 'v1',
    updatedAt: '2026-11-01T00:00:00.000Z',
    languageCode: 'en',
    kind: 'PAGE',
    title: `Page ${sequence}`,
    slug: overrides.path.split('/').at(-1) ?? '',
    icon: null,
    description: null,
    content: 'Body.',
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
      { code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, enabled: false, config: null },
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

/** The hrefs the worker gate rejects, read back from its issue details. */
const brokenLinks = (site: SiteSnapshot): string[] =>
  collectPublishIssues(site)
    .filter((issue) => issue.type === 'broken-link')
    .map((issue) => /^Link to "(.*)" does not match any page\.$/.exec(issue.detail)?.[1] ?? issue.detail);

const linking = (content: string, overrides: Partial<SnapshotPage> = {}) =>
  page({ path: 'guides/intro', title: 'Introduction', content, ...overrides });

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

describe('worker broken-link gate: cases the old gate wrongly rejected', () => {
  const settings = page({ path: 'settings' });
  const arabic = page({ path: 'دليل', languageCode: 'ar', title: 'دليل' });
  const englishOnly = page({ path: 'setup' });

  it.each<[string, () => SiteSnapshot]>([
    [
      'a link a configured redirect covers',
      () => snapshot([linking('[a](/configuration)'), settings], { redirects: [{ from: '/configuration', to: '/settings' }] }),
    ],
    ['a /ar/… language-prefixed link', () => snapshot([linking('[a](/ar/دليل) [b](/ar/%D8%AF%D9%84%D9%8A%D9%84)'), arabic])],
    ['a /en/… prefix for the default language', () => snapshot([linking('[a](/en/setup)'), englishOnly])],
    [
      'a group path the reader forwards to its first page',
      () => snapshot([linking('[a](/reference) [b](../reference)'), page({ path: 'reference/limits' })]),
    ],
    ['a link inside a fenced code block', () => snapshot([linking('```md\n[a](/missing)\n```')])],
    ['a link inside inline code and <pre>', () => snapshot([linking('Write `[a](/missing)`.\n\n<pre>[b](/missing-too)</pre>')])],
    ['?lang= for a page that falls back to the default language', () => snapshot([linking('[a](/setup?lang=ar)'), englishOnly])],
    [
      'an Arabic page linking to an English-only page',
      () => snapshot([page({ path: 'مقدمة', languageCode: 'ar', content: '[a](/setup)' }), englishOnly]),
    ],
    [
      'the API reference route',
      () =>
        snapshot([linking('[a](/api-reference)')], null, {
          openapi: { title: 'API', path: 'api-reference', contentHash: 'h', updatedAt: '2026-11-01T00:00:00.000Z', document: {} },
        }),
    ],
    [
      'a link from a default-version page into another version',
      () => snapshot([linking('[a](/v2/only-in-v2)'), page({ path: 'only-in-v2', versionId: 'v2' })]),
    ],
    [
      'a broken link on a page in a disabled language (not published)',
      () => snapshot([page({ path: 'intro', languageCode: 'fr', content: '[a](/missing)' })]),
    ],
  ])('accepts %s', (_case, build) => {
    expect(brokenLinks(build())).toEqual([]);
  });

  it('accepts the changelog route and reserved files (as before)', () => {
    expect(
      brokenLinks(snapshot([linking('[a](/changelog) [b](/sitemap.xml) [c](/llms.txt) [d](/robots.txt) [e](/files/guide.pdf) [f](/)'), settings])),
    ).toEqual([]);
  });
});

describe('worker broken-link gate: what still blocks', () => {
  const english = page({ path: 'guides/start', content: '[Arabic guide](/group-9e4c82a8/intro?lang=ar)' });
  const arabic = page({ path: 'group-9e4c82a8/intro', languageCode: 'ar', content: '[English guide](/guides/start?lang=en)' });

  it('accepts translated destinations in both directions', () => {
    expect(brokenLinks(snapshot([english, arabic]))).toEqual([]);
  });

  it.each(['zz', 'AR', 'ar&lang=en', ''])('rejects an unknown or ambiguous target language %j', (language) => {
    const changed = { ...english, content: `[Target](/group-9e4c82a8/intro?lang=${language})` };
    expect(collectPublishIssues(snapshot([changed, arabic]))).toEqual([
      expect.objectContaining({ type: 'broken-link', pageTitle: english.title, pagePath: 'guides/start' }),
    ]);
  });

  it('does not use a destination from another version or a hidden page', () => {
    expect(brokenLinks(snapshot([english, { ...arabic, versionId: 'v2' }]))).not.toEqual([]);
    expect(brokenLinks(snapshot([english, { ...arabic, hidden: true }]))).not.toEqual([]);
  });

  it('rejects a link to a deleted page, a redirect for another path, and an unknown /xx/ prefix', () => {
    const site = snapshot([linking('[a](/configuration#options) [b](/ar/missing) [c](/de/settings)'), page({ path: 'settings' })], {
      redirects: [{ from: '/old', to: '/settings' }],
    });
    expect(brokenLinks(site)).toEqual(['/configuration#options', '/ar/missing', '/de/settings']);
  });

  it('keeps its gating: off with CI checks or the broken-link add-on, and grammar honours skipGrammarChecks', () => {
    const pages = [linking('[a](/gone) Please recieve this.')];
    expect(collectPublishIssues(snapshot(pages, { addons: { ciChecks: false, grammarLinter: true } }))).toEqual([]);
    expect(collectPublishIssues(snapshot(pages, { addons: { brokenLinks: false, grammarLinter: true } })).map((issue) => issue.type)).toEqual([
      'grammar',
    ]);
    expect(collectPublishIssues(snapshot(pages, { addons: { grammarLinter: true } }), { skipGrammarChecks: true })).toEqual([
      { type: 'broken-link', pageTitle: 'Introduction', pagePath: 'guides/intro', detail: 'Link to "/gone" does not match any page.' },
    ]);
  });
});

describe('publish dialog and worker parity', () => {
  it('reports exactly the same broken links for the same snapshot', () => {
    const pages = [
      page({ path: 'start', title: 'Start' }),
      page({ path: 'reference/limits', title: 'Limits' }),
      page({ path: 'دليل', languageCode: 'ar', title: 'دليل' }),
      page({ path: 'secret', hidden: true, content: '[x](/hidden-page-link)' }),
      page({ path: 'only-in-v2', versionId: 'v2', content: '[ok](/only-in-v2) [broken](/start)' }),
      page({
        path: 'guides/intro',
        title: 'Introduction',
        content: [
          '[ok](/start#top) [ok](/reference) [ok](/ar/دليل) [ok](/دليل?lang=ar) [ok](/old) [ok](/changelog) [ok](/api)',
          '[broken](/configuration) [broken](/ar/missing) [broken](limits) [broken](/secret) [broken](/دليل?lang=ar&lang=en#x)',
          '[broken](/v2/ar/only-in-v2) [broken][used]',
          '',
          '<Card href="/card-attribute" />',
          '',
          '[used]: /reference-missing',
          '[unused]: /unused-definition',
          '',
          '```',
          '[in code](/code-missing)',
          '```',
        ].join('\n'),
      }),
      page({
        path: 'components',
        content: [
          '<CardGroup><Card href="/start" /><Card href={"/expression-card"} /></CardGroup>',
          '<RelatedCard href="/related-missing" />',
          '<RelatedCard href="/old" />',
          '<Button href="/button-missing">Next</Button>',
          '<Button href="/start">Start</Button>',
          '<a href="/anchor-missing">Next</a>',
          '<a href="/start">Start</a>',
          '<RelatedCard href={destination} />',
          '<Button href={"/expression-button"}>Next</Button>',
          '<a href={destination}>Next</a>',
          '<Note href="/not-a-link" />',
        ].join('\n\n'),
      }),
      page({ path: 'مقدمة', languageCode: 'ar', content: '[ok](/start) [broken](/nowhere)' }),
      // A page whose only content is a commented-out link: an empty page, and no link renders.
      page({ path: 'commented', title: 'Commented', content: '<!-- [a](/commented-missing) -->' }),
    ];
    const site = snapshot(
      pages,
      { redirects: [{ from: '/old', to: '/start' }] },
      {
        openapi: { title: 'API', path: 'api', contentHash: 'h', updatedAt: '2026-11-01T00:00:00.000Z', document: {} },
      },
    );

    const dialog = collectPublishChecks(site)
      .filter((check) => check.code === 'broken-internal-link')
      .map((check) => `${check.path} ${check.detail}`);
    const worker = collectPublishIssues(site)
      .filter((issue) => issue.type === 'broken-link')
      .map((issue) => `${issue.pagePath} ${/^Link to "(.*)" does not match any page\.$/.exec(issue.detail)?.[1]}`);

    expect(new Set(worker)).toEqual(new Set(dialog));
    expect(dialog.sort()).toEqual(
      [
        'guides/intro /ar/missing',
        'guides/intro /configuration',
        'guides/intro /card-attribute',
        'components /related-missing',
        'components /button-missing',
        'components /anchor-missing',
        'guides/intro /v2/ar/only-in-v2',
        'guides/intro /reference-missing',
        'guides/intro /secret',
        'guides/intro /دليل?lang=ar&lang=en#x',
        'guides/intro limits',
        'only-in-v2 /start',
        'مقدمة /nowhere',
      ].sort(),
    );
    // Blocking in the dialog exactly when the worker would reject the publish.
    expect(
      collectPublishChecks(site)
        .filter((check) => check.code === 'broken-internal-link')
        .every((check) => check.severity === 'error'),
    ).toBe(true);
  });

  it('agrees on a page whose only content is a commented-out link: an empty-page warning, nothing blocking', () => {
    const site = snapshot([page({ path: 'start' }), page({ path: 'commented', content: '<!-- [a](/missing) -->' })]);
    const dialog = collectPublishChecks(site);
    expect(dialog.map((check) => [check.code, check.severity])).toEqual([['empty-page', 'warning']]);
    expect(collectPublishIssues(site)).toEqual([]);
    expect(dialog.some((check) => check.severity === 'error')).toBe(collectPublishIssues(site).length > 0);
  });

  it.each<[string, AddonDeliveryPlanAssignment | null]>([
    ['no plan (add-ons stored on, not delivered)', null],
    ['a plan that delivers the add-ons', deliveringPlan],
  ])('makes the same blocking decision with %s', (_case, assignment) => {
    const site = deliveredSnapshot(assignment);
    const dialogBlocks = collectPublishChecks(site).some((check) => check.severity === 'error');
    const workerBlocks = collectPublishIssues(site).some((issue) => issue.type === 'broken-link');
    expect(dialogBlocks).toBe(workerBlocks);
    expect(workerBlocks).toBe(assignment !== null);
  });
});

describe('worker broken-link gate: enforcement follows the delivered add-on state (as on main)', () => {
  it('does not block when the plan does not deliver the add-ons, even though they are stored on', () => {
    const site = deliveredSnapshot(null);
    expect((site.project.config as { addons: Record<string, unknown> }).addons).toMatchObject({ ciChecks: false, brokenLinks: false });
    expect(collectPublishIssues(site)).toEqual([]);
  });

  it('blocks when a plan delivers the add-ons', () => {
    expect(collectPublishIssues(deliveredSnapshot(deliveringPlan))).toEqual([
      { type: 'broken-link', pageTitle: 'Intro', pagePath: 'intro', detail: 'Link to "/configuration" does not match any page.' },
    ]);
  });
});
