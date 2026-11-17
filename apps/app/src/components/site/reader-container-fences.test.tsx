import { PassThrough } from 'node:stream';
import { extractHeadings } from '@nibleaf/shared';
import { readerSections } from '@nibleaf/shared/reader-headings';
import { AFTER_FENCE, FENCE_CONTAINER_REPROS } from '@nibleaf/shared/testing/fence-cases';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
import { normalizeMdxBlocks } from './mdx-config';
import { SitePageView } from './site-page-view';

vi.mock('@/components/site/page-alternates-context', () => ({ useSitePageAlternates: () => ({ setAlternates: vi.fn() }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));

const renderCompleteHtml = (node: ReactNode): Promise<string> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', (chunk) => {
      html += chunk.toString();
    });
    output.on('end', () => resolve(html));
    output.on('error', reject);
    const { pipe } = renderToPipeableStream(node, { onAllReady: () => pipe(output), onError: reject });
  });

/** A published page as the server sends it: headings come from `extractHeadings` (actions/sites.ts). */
const published = (content: string): SitePage => ({
  project: {
    id: 'project-1',
    name: 'Example docs',
    slug: 'example',
    description: null,
    config: { visibility: 'public', addons: { feedback: false, editSuggestions: false, issueLinks: false } },
    primaryDomain: null,
  },
  page: {
    id: 'page-1',
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    title: 'Start',
    description: 'A public page.',
    excerpt: 'A public page.',
    icon: null,
    path: 'start',
    content,
    headings: extractHeadings(content),
    config: { mode: 'default' },
  },
  activeLanguage: 'en',
  activeVersion: 'main',
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languageConfig: null,
  languages: [{ code: 'en', isDefault: true, path: 'start' }],
  breadcrumbs: [{ title: 'Start', path: 'start' }],
  prev: null,
  next: null,
});

describe('the published reader after a fence in a quote or list item (#587)', () => {
  it.each(FENCE_CONTAINER_REPROS)(
    'keeps the heading, its section, its outline entry and the video after %s',
    async (_name, example) => {
      const content = `${example}${AFTER_FENCE}`;
      expect(extractHeadings(content).map(({ text }) => text)).toEqual(['After']);
      expect(readerSections(content).map(({ text }) => text)).toEqual(['After']);
      expect(normalizeMdxBlocks(content)).toContain('<mdxembed provider="youtube" videoid="M7lc1UVf-VE"');
      const html = await renderCompleteHtml(<SitePageView data={published(content)} lang="en" projectId="project-1" />);
      expect(html).toMatch(/<h2[^>]* id="after"/);
      expect(html).toContain('href="#after"');
      expect(html).toContain('data-theme-component="video-embed"');
    },
    // The first deferred render also compiles the Markdown dependency graph.
    30_000,
  );
});
