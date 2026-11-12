import type { SearchChunk } from '@nibleaf/search';
import { describe, expect, it, vi } from 'vitest';

const parsed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@nibleaf/shared/reader-headings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/shared/reader-headings')>();
  return {
    ...actual,
    readerHeadings: (content: string) => {
      parsed.calls += 1;
      return actual.readerHeadings(content);
    },
  };
});

import { publishedSections } from './sections';

const lines = (...parts: string[]) => parts.join('\n');
const page = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-1',
  kind: 'PAGE' as const,
  hidden: false,
  languageCode: 'en',
  content: lines(
    '# Install',
    '',
    'Intro.',
    '',
    '## Example',
    '',
    'First.',
    '',
    '## With **npm**',
    '',
    'Run it.',
    '',
    '## Example',
    '',
    'Second.',
    '',
    '##### Fine print',
    '',
    'Small.',
  ),
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
let deployments = 0;
/** Each call reads a fresh deployment, so the shared heading cache never answers for another test. */
const resolve = (source: Partial<SearchChunk>, pages = [page()]) => {
  deployments += 1;
  const resolved = publishedSections(pages as never, `deployment-${deployments}`)(chunk(source));
  return resolved && { heading: resolved.heading, anchor: resolved.anchor };
};

describe('citations resolved against the published page', () => {
  it('keeps the section recorded at index time when the page renders it, even a repeated heading', () => {
    expect(resolve({ heading: 'Example', headingPath: ['Install', 'Example'], anchor: 'example-1' })).toEqual({
      heading: 'Example',
      anchor: 'example-1',
    });
  });

  it('labels the section as the page shows it, so label and link agree', () => {
    expect(resolve({ heading: 'With npm', anchor: 'with-npm' })).toEqual({ heading: 'With npm', anchor: 'with-npm' });
    // Indexed before anchors: found by its heading's text, inline Markdown and case aside.
    expect(resolve({ heading: 'with NPM', headingPath: ['Install', 'with NPM'] })).toEqual({ heading: 'With npm', anchor: 'with-npm' });
  });

  it('leaves out a source whose recorded section the page no longer renders, rather than guessing by its text', () => {
    expect(resolve({ heading: 'Example', headingPath: ['Install', 'Example'], anchor: 'gone' })).toBeUndefined();
  });

  it('matches a source indexed before anchors by text, an h5 or h6 to its nearest h1–h4 heading', () => {
    expect(resolve({ heading: 'Example', headingPath: ['Install', 'Example'] })).toEqual({ heading: 'Example', anchor: 'example' });
    expect(resolve({ heading: 'Fine print', headingPath: ['Install', 'Example', 'Fine print'] })).toEqual({
      heading: 'Example',
      anchor: 'example-1',
    });
  });

  it('checks ids the way the reader renders them: entities decoded, h5 and h6 counted', () => {
    const content = lines('## API &amp; keys', '', 'Text.', '', '##### Install', '', 'Small.', '', '## Install', '', 'Text.');
    expect(resolve({ heading: 'API & keys', anchor: 'api--keys' }, [page({ content })])).toEqual({ heading: 'API & keys', anchor: 'api--keys' });
    // `install` is the h5's id on the page: the h2's is `install-1`.
    expect(resolve({ heading: 'Install', anchor: 'install-1' }, [page({ content })])).toEqual({ heading: 'Install', anchor: 'install-1' });
  });

  it('cites the top of the page for text before any heading', () => {
    expect(resolve({})).toEqual({ heading: '', anchor: undefined });
  });

  it('leaves out a source whose page the published version does not have, or not for this reader', () => {
    expect(resolve({ heading: 'Removed section', headingPath: ['Removed section'] })).toBeUndefined();
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

  it('reads a published page’s headings once per deployment, and still checks every request’s pages', () => {
    const before = parsed.calls;
    const first = publishedSections([page()] as never, 'deployment-cached');
    const second = publishedSections([page()] as never, 'deployment-cached');
    expect(first(chunk({ heading: 'Example', anchor: 'example' }))?.anchor).toBe('example');
    expect(second(chunk({ heading: 'With npm', anchor: 'with-npm' }))?.anchor).toBe('with-npm');
    expect(parsed.calls - before).toBe(1);
    // The cache holds headings only: a request whose reader cannot read the page gets nothing.
    expect(publishedSections([] as never, 'deployment-cached')(chunk({ heading: 'Example', anchor: 'example' }))).toBeUndefined();
    publishedSections([page()] as never, 'another-deployment')(chunk({ heading: 'Example', anchor: 'example' }));
    expect(parsed.calls - before).toBe(2);
  });
});
