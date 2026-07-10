import { describe, expect, it } from 'vitest';
import {
  buildNavTree,
  buildSnapshot,
  defaultLanguage,
  extractHeadings,
  interpolateVariables,
  pageDescription,
  projectSlugFromSubdomainHost,
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
