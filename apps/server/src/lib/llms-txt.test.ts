import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxt, llmsIndexablePages, llmsPageUrl } from './llms-txt';

const BASE = 'https://app.example.com/sites/proj_1';

const page = (over: Partial<SnapshotPage> & Pick<SnapshotPage, 'id'>): SnapshotPage => ({
  parentId: null,
  versionId: 'v-main',
  updatedAt: '2026-07-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: over.id,
  slug: over.id,
  path: over.id,
  icon: null,
  description: null,
  content: `Content of ${over.id}`,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  ...over,
});

const snapshot = (pages: SnapshotPage[], over?: Partial<SiteSnapshot['project']>): SiteSnapshot => ({
  project: {
    id: 'proj_1',
    name: 'Acme Docs',
    slug: 'acme',
    description: 'How to use Acme.',
    icon: null,
    config: null,
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
    ],
    versions: [
      { id: 'v-main', name: 'main', slug: 'main', isDefault: true },
      { id: 'v-2', name: 'v2', slug: 'v2', isDefault: false },
    ],
    ...over,
  },
  pages,
  generatedAt: '2026-07-01T00:00:00.000Z',
});

describe('llmsIndexablePages', () => {
  it('excludes groups, hidden pages, noindex pages, external canonicals, and blocked languages', () => {
    const snap = snapshot(
      [
        page({ id: 'keep' }),
        page({ id: 'group', kind: 'GROUP' }),
        page({ id: 'hidden', hidden: true }),
        page({ id: 'noindex', config: { seo: { noindex: true } } }),
        page({ id: 'external-canonical', config: { seo: { canonicalUrl: 'https://example.com/original' } } }),
        page({ id: 'blocked-lang', languageCode: 'ar' }),
      ],
      {
        languages: [
          { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
          { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: { seo: { allowIndex: false } } },
        ],
      },
    );
    expect(llmsIndexablePages(snap).map((p) => p.id)).toEqual(['keep']);
    // Behind sign-in, search indexing rules don't apply: every readable page
    // that isn't hidden is listed. Groups (including ungranted ancestors kept
    // as navigation labels) still carry no body.
    expect(llmsIndexablePages(snap, { privateSite: true }).map((p) => p.id)).toEqual(['keep', 'noindex', 'external-canonical', 'blocked-lang']);
  });
});

describe('llmsPageUrl', () => {
  it('gives default-language default-version pages the clean canonical URL', () => {
    const snap = snapshot([page({ id: 'intro', versionId: 'v-main' })]);
    expect(llmsPageUrl(snap, snap.pages[0] as SnapshotPage, BASE)).toBe(`${BASE}/intro.md`);
  });
  it('prefixes the language before a non-default version', () => {
    const snap = snapshot([page({ id: 'guide', versionId: 'v-2', languageCode: 'ar' })]);
    expect(llmsPageUrl(snap, snap.pages[0] as SnapshotPage, BASE)).toBe(`${BASE}/ar/v2/guide.md`);
  });

  it('percent-encodes non-ASCII path segments so the link stays a valid ASCII URL', () => {
    const snap = snapshot([page({ id: 'auth', path: 'الأدلة/المصادقة', languageCode: 'ar' })]);
    expect(llmsPageUrl(snap, snap.pages[0] as SnapshotPage, BASE)).toBe(
      `${BASE}/ar/%D8%A7%D9%84%D8%A3%D8%AF%D9%84%D8%A9/%D8%A7%D9%84%D9%85%D8%B5%D8%A7%D8%AF%D9%82%D8%A9.md`,
    );
  });
});

describe('buildLlmsTxt', () => {
  it('renders the site header, per-language sections, and page links with descriptions', () => {
    const snap = snapshot([
      page({ id: 'intro', title: 'Introduction', description: 'Start here.' }),
      page({ id: 'intro-ar', title: 'مقدمة', languageCode: 'ar' }),
    ]);
    const txt = buildLlmsTxt(snap, BASE);
    expect(txt).toContain('# Acme Docs');
    expect(txt).toContain('> How to use Acme.');
    expect(txt).toContain('## Docs (English)');
    expect(txt).toContain('## Docs (العربية)');
    expect(txt).toContain(`- [Introduction](${BASE}/intro.md): Start here.`);
    expect(txt).toContain(`${BASE}/ar/intro-ar.md`);
  });
  it('uses a single Docs section for single-language sites and omits excluded pages', () => {
    const snap = snapshot([page({ id: 'intro' }), page({ id: 'secret', hidden: true })], {
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    });
    const txt = buildLlmsTxt(snap, BASE);
    expect(txt).toContain('## Docs\n');
    expect(txt).not.toContain('## Docs (');
    expect(txt).not.toContain('secret');
  });
  it('collapses multi-line descriptions to one line', () => {
    const snap = snapshot([page({ id: 'intro', description: 'Line one\nline two' })], {
      languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    });
    expect(buildLlmsTxt(snap, BASE)).toContain(': Line one line two');
  });
});

describe('buildLlmsFullTxt', () => {
  it('prefers clean author SEO overrides for summaries in both AI documents', () => {
    const snap = snapshot([
      page({ id: 'intro', description: '**Summary** [link](/docs)', config: { seo: { metaDescription: '[!TIP] `Preferred` summary' } } }),
    ]);
    expect(buildLlmsTxt(snap, BASE)).toContain(': Preferred summary');
    expect(buildLlmsFullTxt(snap, BASE)).toContain('> Preferred summary');
  });
  it('concatenates page markdown with per-page headers and source URLs', () => {
    const snap = snapshot([
      page({ id: 'intro', title: 'Introduction', content: '# Welcome\n\nHello.' }),
      page({ id: 'setup', title: 'Setup', content: 'Run the installer.' }),
    ]);
    const txt = buildLlmsFullTxt(snap, BASE);
    expect(txt).toContain('# Acme Docs');
    expect(txt).toContain('# Introduction');
    expect(txt).toContain(`Source: ${BASE}/intro.md`);
    expect(txt).toContain('Hello.');
    expect(txt).toContain('---');
    expect(txt).toContain(`Source: ${BASE}/setup.md`);
    expect(txt).toContain('Run the installer.');
  });
  it('excludes hidden and noindex pages from the full dump', () => {
    const snap = snapshot([page({ id: 'intro' }), page({ id: 'secret', hidden: true, content: 'TOP SECRET' })]);
    expect(buildLlmsFullTxt(snap, BASE)).not.toContain('TOP SECRET');
  });
});

describe('an untitled page in llms.txt', () => {
  it('is listed and headed as "Untitled", never as an empty link', () => {
    const snap = snapshot([page({ id: 'draft', title: '' })]);
    expect(buildLlmsTxt(snap, BASE)).toContain('- [Untitled](');
    expect(buildLlmsTxt(snap, BASE)).not.toContain('[](');
    expect(buildLlmsFullTxt(snap, BASE)).toContain('# Untitled');
  });
});
