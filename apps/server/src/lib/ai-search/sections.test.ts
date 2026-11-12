import type { SearchChunk } from '@nibleaf/search';
import { describe, expect, it } from 'vitest';
import { publishedSections } from './sections';

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-1',
  kind: 'PAGE' as const,
  hidden: false,
  languageCode: 'en',
  content: '# Install\n\nIntro.\n\n## Example\n\nFirst.\n\n## With **npm**\n\nRun it.\n\n## Example\n\nSecond.\n\n##### Fine print\n\nSmall.',
  ...overrides,
});
const chunk = (overrides: Partial<SearchChunk> = {}): SearchChunk => ({
  id: 'c1',
  pageId: 'page-1',
  ordinal: 0,
  title: 'Install',
  path: 'install',
  description: '',
  heading: '',
  headingPath: [],
  content: 'text',
  contentHash: 'h',
  language: 'en',
  direction: 'ltr',
  visible: true,
  ...overrides,
});
const resolve = (source: Partial<SearchChunk>, pages = [page()]) => {
  const resolved = publishedSections(pages as never)(chunk(source));
  return resolved && { heading: resolved.heading, anchor: resolved.anchor };
};

describe('citations resolved against the published page', () => {
  it('keeps the section recorded at index time when the page renders it, even a repeated heading', () => {
    expect(resolve({ heading: 'Example', headingPath: ['Install', 'Example'], anchor: 'example-1' })).toEqual({
      heading: 'Example',
      anchor: 'example-1',
    });
  });

  it('labels the section as the table of contents does, so label and link agree', () => {
    expect(resolve({ heading: 'With npm', anchor: 'with-npm' })).toEqual({ heading: 'With npm', anchor: 'with-npm' });
    // Indexed before anchors: found by its heading's text, inline Markdown and case aside.
    expect(resolve({ heading: 'with NPM', headingPath: ['Install', 'with NPM'] })).toEqual({ heading: 'With npm', anchor: 'with-npm' });
  });

  it('resolves a stale or missing anchor by heading text, then by the nearest ancestor the page renders', () => {
    expect(resolve({ heading: 'Example', headingPath: ['Install', 'Example'], anchor: 'gone' })).toEqual({ heading: 'Example', anchor: 'example' });
    // h5: the reader renders no id for it, so its h1 ancestor is the section.
    expect(resolve({ heading: 'Fine print', headingPath: ['Install', '', '', '', 'Fine print'] })).toEqual({ heading: 'Install', anchor: 'install' });
  });

  it('cites the top of the page for text before any heading', () => {
    expect(resolve({})).toEqual({ heading: '', anchor: undefined });
  });

  it('leaves out a source whose section, or page, the published version does not have', () => {
    expect(resolve({ heading: 'Removed section', headingPath: ['Removed section'], anchor: 'removed-section' })).toBeUndefined();
    expect(resolve({ pageId: 'another-version', heading: 'Example', anchor: 'example' })).toBeUndefined();
    expect(resolve({ heading: 'Example', anchor: 'example' }, [page({ hidden: true })])).toBeUndefined();
    expect(resolve({ heading: 'Example', anchor: 'example' }, [page({ kind: 'GROUP' })])).toBeUndefined();
    // A source from the page's translation is not this page's section.
    expect(resolve({ heading: 'Example', anchor: 'example', language: 'ar' })).toBeUndefined();
  });

  it('keeps a real section whose id is too long to carry, linked to the page top', () => {
    const heading = `Very ${'long '.repeat(60)}heading`;
    expect(resolve({ heading }, [page({ content: `## ${heading}\n\nText.` })])).toEqual({ heading, anchor: undefined });
  });
});
