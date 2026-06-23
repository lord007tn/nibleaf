import { describe, expect, it } from 'vitest';
import {
  buildNavTree,
  buildSnapshot,
  defaultLanguage,
  extractHeadings,
  pageDescription,
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
});

const page = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id'>): SnapshotPage => ({
  parentId: null,
  languageCode: 'en',
  kind: 'PAGE',
  title: over.id,
  slug: over.id,
  path: over.id,
  icon: null,
  description: null,
  content: '',
  config: null,
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
  it('filters by language, treating legacy (no languageCode) pages as the requested language', () => {
    const tree = buildNavTree(
      [page({ id: 'en1', languageCode: 'en' }), page({ id: 'ar1', languageCode: 'ar' }), page({ id: 'legacy', languageCode: '' })],
      'en',
    );
    expect(tree.map((n) => n.id).sort()).toEqual(['en1', 'legacy']);
  });
});

describe('buildSnapshot', () => {
  const projectRow = {
    id: 'p1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    color: '#5546e8',
    logoUrl: null,
    faviconUrl: null,
    theme: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true }],
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
    position: 0,
    hidden: false,
  };

  it('coerces non-GROUP kinds to PAGE and backfills languageCode from the default language', () => {
    const snap = buildSnapshot(projectRow, [{ ...rawPage, kind: 'WEIRD' }], '2026-01-01');
    expect(snap.pages[0]?.kind).toBe('PAGE');
    expect(snap.pages[0]?.languageCode).toBe('en');
  });
  it('preserves GROUP kinds', () => {
    const snap = buildSnapshot(projectRow, [{ ...rawPage, kind: 'GROUP' }], '2026-01-01');
    expect(snap.pages[0]?.kind).toBe('GROUP');
  });
  it('synthesizes an English language when none are provided', () => {
    const snap = buildSnapshot({ ...projectRow, languages: [] }, [], '2026-01-01');
    expect(snap.project.languages).toEqual([{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }]);
  });
});

describe('pageDescription and defaultLanguage', () => {
  const proj = (languages: SnapshotLanguage[]): SnapshotProject => ({ languages }) as unknown as SnapshotProject;

  it('prefers an explicit description, else derives one from content', () => {
    expect(pageDescription({ description: 'Hi', content: 'x' })).toBe('Hi');
    expect(pageDescription({ description: null, content: '# Title\n\nBody text.' })).toContain('Body text');
  });
  it('returns the default language, falling back to first then English', () => {
    expect(defaultLanguage(proj([{ code: 'ar', label: 'ع', direction: 'RTL', isDefault: true, config: null }])).code).toBe('ar');
    expect(defaultLanguage(proj([])).code).toBe('en');
  });
});
