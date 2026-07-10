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
  it('excludes groups, hidden pages, noindex pages, and blocked languages', () => {
    const snap = snapshot(
      [
        page({ id: 'keep' }),
        page({ id: 'group', kind: 'GROUP' }),
        page({ id: 'hidden', hidden: true }),
        page({ id: 'noindex', config: { seo: { noindex: true } } }),
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
  });
});

describe('llmsPageUrl', () => {
  it('gives default-language default-version pages the clean canonical URL', () => {
    const snap = snapshot([page({ id: 'intro', versionId: 'v-main' })]);
    expect(llmsPageUrl(snap, snap.pages[0] as SnapshotPage, BASE)).toBe(`${BASE}/intro`);
  });
  it('adds a version prefix for non-default versions and ?lang for non-default languages', () => {
    const snap = snapshot([page({ id: 'guide', versionId: 'v-2', languageCode: 'ar' })]);
    expect(llmsPageUrl(snap, snap.pages[0] as SnapshotPage, BASE)).toBe(`${BASE}/v2/guide?lang=ar`);
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
    expect(txt).toContain(`- [Introduction](${BASE}/intro): Start here.`);
    expect(txt).toContain(`- [مقدمة](${BASE}/intro-ar?lang=ar)`);
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
  it('concatenates page markdown with per-page headers and source URLs', () => {
    const snap = snapshot([
      page({ id: 'intro', title: 'Introduction', content: '# Welcome\n\nHello.' }),
      page({ id: 'setup', title: 'Setup', content: 'Run the installer.' }),
    ]);
    const txt = buildLlmsFullTxt(snap, BASE);
    expect(txt).toContain('# Acme Docs');
    expect(txt).toContain('# Introduction');
    expect(txt).toContain(`Source: ${BASE}/intro`);
    expect(txt).toContain('Hello.');
    expect(txt).toContain('---');
    expect(txt).toContain(`Source: ${BASE}/setup`);
    expect(txt).toContain('Run the installer.');
  });
  it('excludes hidden and noindex pages from the full dump', () => {
    const snap = snapshot([page({ id: 'intro' }), page({ id: 'secret', hidden: true, content: 'TOP SECRET' })]);
    expect(buildLlmsFullTxt(snap, BASE)).not.toContain('TOP SECRET');
  });
});
