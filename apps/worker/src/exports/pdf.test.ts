import type { SiteSnapshot } from '@nibleaf/shared/site';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdf } from './pdf';

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch } }));

const snapshot: SiteSnapshot = {
  project: {
    id: 'public',
    name: 'Published guide',
    slug: 'guide',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null }],
    versions: [{ id: 'main', name: 'Main', slug: 'main', isDefault: true }],
  },
  generatedAt: '2026-10-17T00:00:00.000Z',
  pages: ['first', 'second', 'hidden'].map((id, position) => ({
    id,
    parentId: null,
    versionId: 'main',
    languageCode: 'en',
    kind: 'PAGE',
    title: id,
    slug: id,
    path: id,
    icon: null,
    description: null,
    config: null,
    translationKey: null,
    position,
    hidden: id === 'hidden',
    updatedAt: '2026-10-17T00:00:00.000Z',
    content: id === 'first' ? '[Next](/second) [Hidden](/hidden) [External](https://example.com)' : id,
  })),
};

function browserFixture() {
  const html: string[] = [];
  const pageCloses: ReturnType<typeof vi.fn>[] = [];
  const browser = {
    close: vi.fn(),
    newPage: vi.fn(async () => {
      let content = '';
      const close = vi.fn();
      pageCloses.push(close);
      return {
        route: vi.fn(),
        close,
        setContent: vi.fn(async (value: string) => {
          content = value;
          html.push(value);
        }),
        pdf: vi.fn(async () => {
          const part = await PDFDocument.create();
          const width = content.includes('<header>') ? 100 : content.includes('id="page-first"') ? 200 : 300;
          const page = part.addPage([width, 400]);
          const annotations = [...content.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) =>
            part.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [0, 0, 10, 10],
              A: { S: 'URI', URI: PDFString.of(match[1] ?? '') },
            }),
          );
          page.node.set(PDFName.of('Annots'), part.context.obj(annotations));
          return part.save();
        }),
      };
    }),
  };
  return { browser, html, pageCloses };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('bounded PDF rendering', () => {
  it('embeds an image whose Markdown URL contains escaped parentheses', async () => {
    const fixture = browserFixture();
    launch.mockResolvedValue(fixture.browser);
    const article = snapshot.pages[0];
    if (!article) throw new Error('Missing article fixture');
    await renderPdf(
      { ...snapshot, pages: [{ ...article, content: '![Logo](/assets/lo\\(go\\).png)' }] },
      [{ key: 'assets/lo(go).png', url: '/assets/lo(go).png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
      { executablePath: '/synthetic/chromium' },
    );
    expect(fixture.html[1]).toContain('src="data:image/png;base64,AQID"');
  });

  it('combines the cover and visible articles in order and restores cross-article destinations', async () => {
    const fixture = browserFixture();
    launch.mockResolvedValue(fixture.browser);
    const result = await renderPdf(snapshot, [], { executablePath: '/synthetic/chromium' });
    const document = await PDFDocument.load(result.bytes);
    const pages = document.getPages();
    expect(pages.map((page) => page.getWidth())).toEqual([100, 200, 300]);
    expect(document.getTitle()).toBe('Published guide');
    expect(document.getCreationDate()?.toISOString()).toBe(snapshot.generatedAt);
    expect(fixture.html.filter((html) => html.includes('<header>'))).toHaveLength(1);
    expect(fixture.html.some((html) => html.includes('id="page-hidden"'))).toBe(false);
    const first = pages[1];
    const second = pages[2];
    if (!first || !second) throw new Error('Missing visible PDF articles');
    const annotations =
      first.node
        .Annots()
        ?.asArray()
        .map((ref) => document.context.lookup(ref, PDFDict)) ?? [];
    const actions = annotations.map((annotation) => annotation.lookupMaybe(PDFName.of('A'), PDFDict));
    expect(actions[0]?.lookup(PDFName.of('S'), PDFName).toString()).toBe('/GoTo');
    expect(actions[0]?.lookup(PDFName.of('D'), PDFArray).get(0)).toEqual(second.ref);
    expect(actions[1]).toBeUndefined();
    expect(actions[2]?.lookup(PDFName.of('URI'), PDFString).decodeText()).toBe('https://example.com');
    expect(fixture.pageCloses.every((close) => close.mock.calls.length === 1)).toBe(true);
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it('stops between articles on cancellation and closes Chromium', async () => {
    const fixture = browserFixture();
    launch.mockResolvedValue(fixture.browser);
    const cancelled = new Error('Export cancelled');
    const checkCancelled = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(cancelled);
    await expect(renderPdf(snapshot, [], { executablePath: '/synthetic/chromium', checkCancelled })).rejects.toBe(cancelled);
    expect(fixture.html).toHaveLength(1);
    expect(fixture.pageCloses[0]).toHaveBeenCalledOnce();
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });

  it('closes the current context and browser when printing an article fails', async () => {
    const fixture = browserFixture();
    const page = await fixture.browser.newPage();
    fixture.browser.newPage.mockResolvedValueOnce(page);
    const failure = new Error('Page crashed');
    page.pdf.mockRejectedValueOnce(failure);
    launch.mockResolvedValue(fixture.browser);
    await expect(renderPdf(snapshot, [], { executablePath: '/synthetic/chromium' })).rejects.toBe(failure);
    expect(page.close).toHaveBeenCalledOnce();
    expect(fixture.browser.close).toHaveBeenCalledOnce();
  });
});
