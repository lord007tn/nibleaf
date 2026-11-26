// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SitePage } from '@/hooks/api/types';
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

const page = (overrides: Partial<SitePage> = {}): SitePage => ({
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
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    title: 'إشعارات الويب',
    description: 'استقبل أحداث الشحنات على نقطة النهاية الخاصة بك.',
    excerpt: '',
    icon: null,
    path: 'guides/webhooks',
    content: 'نص الصفحة.',
    headings: [],
    config: {},
  },
  activeLanguage: 'ar',
  activeVersion: 'main',
  versions: [{ id: 'version-1', name: 'Main', slug: 'main', isDefault: true }],
  languageConfig: null,
  languages: [{ code: 'ar', isDefault: true, path: 'guides/webhooks' }],
  breadcrumbs: [
    { title: 'الأدلة', path: 'guides', section: true },
    { title: 'إشعارات الويب', path: 'guides/webhooks' },
  ],
  prev: null,
  next: null,
  ...overrides,
});

// Every rule in the reader stylesheet that tunes the article title (`… > h1`).
const titleSelectors = () => {
  const css = readFileSync(resolve('src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter((selector) => !selector.startsWith('@') && /> h1$/.test(selector));
};

afterEach(() => document.body.replaceChildren());

describe('the published page header', () => {
  it('keeps the title where the theme rules for it (Manuscript face, RTL leading, balanced wrap) can reach it', async () => {
    const html = await renderCompleteHtml(<SitePageView data={page()} lang="ar" projectId="project-1" />);
    // The chrome the reader route renders around the article, in a theme with its own title rule.
    document.body.innerHTML = `<div class="nibleaf-site-chrome" data-theme-id="manuscript" dir="rtl">${html}</div>`;
    const title = document.querySelector('article h1');
    const selectors = titleSelectors();
    expect(selectors.length).toBeGreaterThanOrEqual(3);
    for (const selector of selectors) expect([selector, title?.matches(selector)]).toEqual([selector, true]);
  }, 30_000);

  it('holds the section trail, the title and the page actions together, the title last but one', async () => {
    const html = await renderCompleteHtml(<SitePageView data={page()} lang="ar" projectId="project-1" />);
    document.body.innerHTML = html;
    const header = document.querySelector('[data-reader-page-header]');
    expect(
      [...(header?.children ?? [])].map((child) => child.tagName.toLowerCase() + (child.hasAttribute('data-page-actions') ? '[actions]' : '')),
    ).toEqual(['nav', 'h1', 'div[actions]']);
  });
});
