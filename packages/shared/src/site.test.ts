import { describe, expect, it } from 'vitest';
import {
  buildNavTree,
  buildSnapshot,
  defaultLanguage,
  extractHeadings,
  interpolateVariables,
  mergeLanguageChrome,
  pageDescription,
  projectSlugFromSubdomainHost,
  publicLanguages,
  publicSiteSnapshot,
  resolvePageCategory,
  type SiteSnapshot,
  type SnapshotLanguage,
  type SnapshotPage,
  type SnapshotProject,
} from './site';

describe('extractHeadings', () => {
  it('extracts h1–h4 with depths and ignores h5+', () => {
    const hs = extractHeadings('# One\n## Two\n#### Four\n##### Five');
    expect(hs.map((h) => h.depth)).toEqual([1, 2, 4]);
    expect(hs[0]).toMatchObject({ depth: 1, text: 'One', id: 'one' });
  });
  it('ignores headings inside fenced code blocks', () => {
    const hs = extractHeadings('# Real\n```\n# Not a heading\n```\n## Also real');
    expect(hs.map((h) => h.text)).toEqual(['Real', 'Also real']);
  });
  it('produces a non-empty github-slugger id for an Arabic heading', () => {
    const [h] = extractHeadings('# مقدمة');
    expect(h?.text).toBe('مقدمة');
    expect(h?.id).toBeTruthy();
    expect(h?.id).not.toContain(' ');
  });
  it('disambiguates duplicate headings with -1/-2 suffixes', () => {
    const hs = extractHeadings('# Setup\n# Setup\n# Setup');
    expect(hs.map((h) => h.id)).toEqual(['setup', 'setup-1', 'setup-2']);
  });
  it('strips inline markdown from heading text so the slug matches the rendered DOM id', () => {
    // rehype-slug slugs the *rendered* text content, so links/bold/code must be
    // reduced to their text before slugging or the TOC anchor won't resolve.
    const [link] = extractHeadings('## See [the guide](/guide)');
    expect(link).toMatchObject({ text: 'See the guide', id: 'see-the-guide' });
    const [rich] = extractHeadings('## The **fast** `path` and _italics_');
    expect(rich).toMatchObject({ text: 'The fast path and italics', id: 'the-fast-path-and-italics' });
    const [img] = extractHeadings('## Logo ![alt](/logo.png) here');
    expect(img?.text).toBe('Logo  here');
  });
  it('handles long inline markup without regex backtracking', () => {
    const label = 'guide'.repeat(20_000);
    const [heading] = extractHeadings(`## [${label}](/guide) ###`);
    expect(heading?.text).toBe(label);
  });
});

const page = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id'>): SnapshotPage => ({
  parentId: null,
  versionId: 'v-main',
  updatedAt: '2026-01-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: over.id,
  slug: over.id,
  path: over.id,
  icon: null,
  description: null,
  content: '',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  ...over,
});

describe('buildNavTree', () => {
  it('nests children under groups and sorts siblings by position', () => {
    const tree = buildNavTree([
      page({ id: 'g', kind: 'GROUP', position: 0 }),
      page({ id: 'b', parentId: 'g', position: 1 }),
      page({ id: 'a', parentId: 'g', position: 0 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('omits hidden pages', () => {
    const tree = buildNavTree([page({ id: 'shown' }), page({ id: 'secret', hidden: true })]);
    expect(tree.map((n) => n.id)).toEqual(['shown']);
  });
  it('uses config.sidebarTitle as the nav label, falling back to the page title', () => {
    const tree = buildNavTree([
      page({ id: 'a', title: 'A Long Page Title', config: { sidebarTitle: 'Short' } }),
      page({ id: 'b', title: 'Plain', position: 1 }),
    ]);
    expect(tree.map((n) => n.title)).toEqual(['Short', 'Plain']);
  });
  it('filters pages strictly by language', () => {
    const tree = buildNavTree([page({ id: 'en1', languageCode: 'en' }), page({ id: 'ar1', languageCode: 'ar' })], 'en');
    expect(tree.map((n) => n.id)).toEqual(['en1']);
  });
  it('groups categorized siblings without changing their paths', () => {
    const tree = buildNavTree([
      page({ id: 'billing', path: 'blog/billing', position: 0, config: { category: 'Accounting', categoryOrder: 2 } }),
      page({ id: 'hotel', path: 'blog/hotel', position: 1, config: { category: 'Hotels', categoryIcon: 'hotel', categoryOrder: 1 } }),
      page({ id: 'room', path: 'blog/room', position: 2, config: { category: 'Hotels', categoryOrder: 1 } }),
    ]);
    expect(tree.map((node) => node.title)).toEqual(['Hotels', 'Accounting']);
    expect(tree[0]).toMatchObject({ kind: 'GROUP', icon: 'hotel' });
    expect(tree[0]?.children.map((node) => node.path)).toEqual(['blog/hotel', 'blog/room']);
  });
  it('keeps real groups ahead of virtual categories and uncategorized pages last', () => {
    const tree = buildNavTree([
      page({ id: 'loose', position: 0 }),
      page({ id: 'guides', kind: 'GROUP', position: 1 }),
      page({ id: 'setup', position: 2, config: { category: 'Start', categoryOrder: 0 } }),
    ]);
    expect(tree.map((node) => node.title)).toEqual(['guides', 'Start', 'loose']);
  });
  it('auto-organizes oversized flat English imports while explicit categories win', () => {
    const pages = Array.from({ length: 24 }, (_, index) =>
      page({
        id: `p${index}`,
        title: index === 0 ? 'Add New Hotel' : index === 1 ? 'Reservation Report' : `Miscellaneous guide ${index}`,
        position: index,
        ...(index === 2 ? { config: { category: 'Essentials', categoryOrder: 0 } } : {}),
      }),
    );
    const tree = buildNavTree(pages);
    expect(tree.map((node) => node.title)).toEqual(['Essentials', 'Hotels & rooms', 'Reports & operations', 'More guides']);
    expect(tree.flatMap((node) => node.children)).toHaveLength(24);
  });
});

describe('resolvePageCategory', () => {
  it('does not infer taxonomy for small hand-authored trees', () => {
    expect(resolvePageCategory(page({ id: 'hotel', title: 'Add Hotel' }), 3)).toBeNull();
  });
  it('recognizes a renamed get-started landing page', () => {
    expect(resolvePageCategory(page({ id: 'start', title: 'Get started with JoodBooking', slug: 'setup-your-joodbooking' }), 30)).toMatchObject({
      title: 'Getting started',
      order: 0,
    });
  });
  it('uses localized Arabic workflow labels for large imports', () => {
    expect(resolvePageCategory(page({ id: 'ar-hotel', title: 'إضافة فندق جديد', languageCode: 'ar' }), 30)).toMatchObject({
      title: 'الفنادق والغرف',
      order: 1,
    });
  });
});

describe('buildSnapshot', () => {
  const projectRow = {
    id: 'p1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null }],
    branches: [{ id: 'branch_main', name: 'main', isDefault: true }],
  };
  const rawPage = {
    id: 'x',
    parentId: null,
    title: 'X',
    slug: 'x',
    path: 'x',
    icon: null,
    description: null,
    content: '',
    config: null,
    languageCode: 'en',
    branchId: 'branch_main',
    kind: 'PAGE' as const,
    updatedAt: '2026-01-01T00:00:00.000Z',
    translationKey: null,
    position: 0,
    hidden: false,
  };

  it('preserves the required page language, version, and timestamp', () => {
    const snap = buildSnapshot(projectRow, [rawPage], '2026-01-01');
    expect(snap.pages[0]?.kind).toBe('PAGE');
    expect(snap.pages[0]?.languageCode).toBe('en');
    expect(snap.pages[0]?.versionId).toBe('branch_main');
    expect(snap.pages[0]?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('preserves GROUP kinds', () => {
    const snap = buildSnapshot(projectRow, [{ ...rawPage, kind: 'GROUP' }], '2026-01-01');
    expect(snap.pages[0]?.kind).toBe('GROUP');
  });
  it('rejects a project without exactly one default language', () => {
    expect(() => buildSnapshot({ ...projectRow, languages: [] }, [], '2026-01-01')).toThrow('exactly one default language');
  });
  it('carries each language’s enabled flag, defaulting missing flags to true', () => {
    const snap = buildSnapshot(
      {
        ...projectRow,
        languages: [
          { code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null },
          { code: 'ar', label: 'العربية', direction: 'RTL' as const, isDefault: false, enabled: false, config: null },
        ],
      },
      [rawPage],
      '2026-01-01',
    );
    expect(snap.project.languages.map((l) => [l.code, l.enabled])).toEqual([
      ['en', true],
      ['ar', false],
    ]);
  });
  it('layers ProjectTranslation identity into the published language config', () => {
    const snap = buildSnapshot(
      {
        ...projectRow,
        languages: [
          {
            code: 'en',
            label: 'English',
            direction: 'LTR' as const,
            isDefault: true,
            config: { seo: { allowIndex: false } },
            projectTranslations: [{ name: 'Localized docs', description: 'Localized description' }],
          },
        ],
      },
      [rawPage],
      '2026-01-01',
    );
    expect(snap.project.languages[0]?.config).toEqual({
      name: 'Localized docs',
      description: 'Localized description',
      seo: { allowIndex: false },
    });
  });
  it('deduplicates branch version slugs while preserving exact version ids on pages', () => {
    const snap = buildSnapshot(
      {
        ...projectRow,
        branches: [
          { id: 'branch_a', name: 'Foo Bar', isDefault: true },
          { id: 'branch_b', name: 'foo-bar', isDefault: false },
        ],
      },
      [
        { ...rawPage, id: 'a', branchId: 'branch_a' },
        { ...rawPage, id: 'b', branchId: 'branch_b' },
      ],
      '2026-01-01',
    );
    expect(snap.project.versions.map((version) => version.slug)).toEqual(['foo-bar', 'foo-bar-branch_b']);
    expect(snap.pages.map((page) => [page.id, page.versionId])).toEqual([
      ['a', 'branch_a'],
      ['b', 'branch_b'],
    ]);
  });
  it('interpolates {{ variables }} from config into page title/description/content at build time', () => {
    const snap = buildSnapshot(
      {
        ...projectRow,
        config: {
          variables: [
            { key: 'product', value: 'Nibleaf' },
            { key: 'api.version', value: 'v2' },
          ],
        },
      },
      [
        {
          ...rawPage,
          title: 'Welcome to {{ product }}',
          description: 'Docs for {{product}}',
          content: 'Use API {{ api.version }}. Unknown {{ nope }} stays.',
        },
      ],
      '2026-01-01',
    );
    expect(snap.pages[0]?.title).toBe('Welcome to Nibleaf');
    expect(snap.pages[0]?.description).toBe('Docs for Nibleaf');
    expect(snap.pages[0]?.content).toBe('Use API v2. Unknown {{ nope }} stays.');
  });
});

describe('interpolateVariables', () => {
  it('replaces known keys (with surrounding whitespace) and leaves unknown tokens intact', () => {
    expect(interpolateVariables('{{ a }} and {{b}} and {{c}}', { a: '1', b: '2' })).toBe('1 and 2 and {{c}}');
  });
  it('is a no-op when there are no variables', () => {
    expect(interpolateVariables('{{ a }}', {})).toBe('{{ a }}');
  });
});

describe('pageDescription and defaultLanguage', () => {
  const proj = (languages: SnapshotLanguage[]): SnapshotProject => ({ languages }) as unknown as SnapshotProject;

  it('prefers an explicit description, else derives one from content', () => {
    expect(pageDescription({ description: 'Hi', content: 'x' })).toBe('Hi');
    expect(pageDescription({ description: null, content: '# Title\n\nBody text.' })).toContain('Body text');
  });
  it('returns the one configured default language', () => {
    expect(defaultLanguage(proj([{ code: 'ar', label: 'ع', direction: 'RTL', isDefault: true, config: null }])).code).toBe('ar');
  });
  it('rejects a snapshot without one default language', () => {
    expect(() => defaultLanguage(proj([]))).toThrow('exactly one default language');
  });
});

describe('publicLanguages', () => {
  const lang = (over: Partial<SnapshotLanguage> & Pick<SnapshotLanguage, 'code'>): SnapshotLanguage => ({
    label: over.code,
    direction: 'LTR',
    isDefault: false,
    config: null,
    ...over,
  });

  it('drops disabled languages and keeps enabled ones', () => {
    const served = publicLanguages([
      lang({ code: 'en', isDefault: true, enabled: true }),
      lang({ code: 'ar', enabled: false }),
      lang({ code: 'fr', enabled: true }),
    ]);
    expect(served.map((l) => l.code)).toEqual(['en', 'fr']);
  });
  it('treats a missing enabled flag (pre-toggle snapshots) as enabled', () => {
    const served = publicLanguages([lang({ code: 'en', isDefault: true }), lang({ code: 'ar' })]);
    expect(served.map((l) => l.code)).toEqual(['en', 'ar']);
  });
  it('always serves the default language, even with a stale disabled flag', () => {
    const served = publicLanguages([lang({ code: 'en', isDefault: true, enabled: false }), lang({ code: 'ar', enabled: false })]);
    expect(served.map((l) => l.code)).toEqual(['en']);
  });
});

describe('mergeLanguageChrome', () => {
  const projectConfig = {
    navbar: { ctaLabel: 'Book a demo', ctaUrl: 'https://acme.dev/demo', links: [{ label: 'Docs', href: '/docs' }], showSearch: true },
    footer: { copyright: '© Acme', github: 'https://github.com/acme', madeWithBadge: true },
    banner: { enabled: true, message: 'v3 is here', dismissible: true },
    search: { placeholder: 'Search…', hotkey: 'cmdk' },
    styling: { primaryColor: '#5546e8' },
  };

  it('returns the input config unchanged (same reference) when the language overrides nothing', () => {
    expect(mergeLanguageChrome(projectConfig, null)).toBe(projectConfig);
    expect(mergeLanguageChrome(projectConfig, {})).toBe(projectConfig);
    expect(mergeLanguageChrome(projectConfig, { name: 'وثائق', seo: { metaTitle: 'X' } })).toBe(projectConfig);
    expect(mergeLanguageChrome(null, null)).toBeNull();
  });

  it('merges object sections one level deep: language values win per key, the rest fall through', () => {
    const merged = mergeLanguageChrome(projectConfig, { navbar: { ctaLabel: 'احجز عرضًا' }, footer: { copyright: '© أكمي' } });
    expect(merged?.navbar).toEqual({
      ctaLabel: 'احجز عرضًا',
      ctaUrl: 'https://acme.dev/demo',
      links: [{ label: 'Docs', href: '/docs' }],
      showSearch: true,
    });
    expect(merged?.footer).toEqual({ copyright: '© أكمي', github: 'https://github.com/acme', madeWithBadge: true });
    // Untouched sections keep the project values.
    expect(merged?.search).toBe(projectConfig.search);
    expect(merged?.styling).toBe(projectConfig.styling);
  });

  it('replaces arrays wholesale when the language defines them', () => {
    const merged = mergeLanguageChrome(projectConfig, { navbar: { links: [{ label: 'المستندات', href: '/ar/docs' }] } });
    expect(merged?.navbar).toMatchObject({ ctaLabel: 'Book a demo', links: [{ label: 'المستندات', href: '/ar/docs' }] });
  });

  it('treats empty strings, empty arrays, and nulls as no override', () => {
    const merged = mergeLanguageChrome(projectConfig, { navbar: { ctaLabel: '', links: [] }, footer: null, banner: { message: 'تحديث' } });
    expect(merged?.navbar).toBe(projectConfig.navbar);
    expect(merged?.footer).toBe(projectConfig.footer);
    expect(merged?.banner).toEqual({ enabled: true, message: 'تحديث', dismissible: true });
  });

  it('creates the section when the project config lacks it, and never mutates inputs', () => {
    const bare: Record<string, unknown> = {};
    const merged = mergeLanguageChrome(bare, { search: { placeholder: 'ابحث في المستندات' } });
    expect(merged?.search).toEqual({ placeholder: 'ابحث في المستندات' });
    expect(bare).toEqual({});
    expect(projectConfig.navbar.ctaLabel).toBe('Book a demo');
  });

  it('lets a language disable/enable the banner independently', () => {
    const merged = mergeLanguageChrome(projectConfig, { banner: { enabled: false } });
    expect(merged?.banner).toEqual({ enabled: false, message: 'v3 is here', dismissible: true });
  });
});

describe('publicSiteSnapshot', () => {
  const snapshot: SiteSnapshot = {
    project: {
      id: 'p1',
      name: 'Docs',
      slug: 'docs',
      description: null,
      icon: null,
      config: null,
      languages: [
        { code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null },
        { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: false, config: null },
      ],
      versions: [{ id: 'v1', name: 'main', slug: 'main', isDefault: true }],
    },
    pages: [page({ id: 'en1', languageCode: 'en' }), page({ id: 'ar1', languageCode: 'ar' })],
    generatedAt: '2026-01-01',
  };

  it('drops disabled languages and their pages', () => {
    const served = publicSiteSnapshot(snapshot);
    expect(served.project.languages.map((l) => l.code)).toEqual(['en']);
    expect(served.pages.map((p) => p.id)).toEqual(['en1']);
    // The input snapshot (potentially a shared cache entry) is untouched.
    expect(snapshot.project.languages).toHaveLength(2);
    expect(snapshot.pages).toHaveLength(2);
  });

  it('returns the snapshot unchanged (same reference) when every language serves', () => {
    const allEnabled: SiteSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, languages: snapshot.project.languages.map((l) => ({ ...l, enabled: true })) },
    };
    expect(publicSiteSnapshot(allEnabled)).toBe(allEnabled);
  });
});

describe('projectSlugFromSubdomainHost', () => {
  it('extracts a single-label project slug from the configured base domain', () => {
    expect(projectSlugFromSubdomainHost('docs.docs.example.com', 'docs.example.com')).toBe('docs');
    expect(projectSlugFromSubdomainHost('Docs.Docs.Example.Com:443', '*.docs.example.com')).toBe('docs');
  });

  it('rejects the apex, nested subdomains, and unrelated hosts', () => {
    expect(projectSlugFromSubdomainHost('docs.example.com', 'docs.example.com')).toBeNull();
    expect(projectSlugFromSubdomainHost('a.b.docs.example.com', 'docs.example.com')).toBeNull();
    expect(projectSlugFromSubdomainHost('docs.other.com', 'docs.example.com')).toBeNull();
  });
});
