// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PublishCheck } from '@/hooks/api/types';
import { PublishChecks } from './publish-checks';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ params, search, children, ...props }: { params: { projectId: string }; search: Record<string, string>; children: ReactNode }) => (
    <a {...props} href={`/app/projects/${params.projectId}/editor?${new URLSearchParams(search)}`}>
      {children}
    </a>
  ),
}));

const check = (overrides: Partial<PublishCheck> & Pick<PublishCheck, 'code'>): PublishCheck => ({
  severity: 'warning',
  pageId: 'home',
  languageCode: 'en',
  title: 'Get started',
  path: 'get-started',
  detail: '',
  ...overrides,
});

describe('site structure checks in the publish dialog', () => {
  it('names, for each language, the page its readers land on instead of the home page, and opens the home page to fix it', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <PublishChecks
        checks={[
          check({
            code: 'home-untranslated',
            detail: JSON.stringify({ language: 'ar', landing: 'كيف نضيف وسما', key: 'start', path: 'get-started' }),
          }),
          check({ code: 'home-untranslated', detail: JSON.stringify({ language: 'fr', landing: 'Étiquettes', key: null, path: 'get-started' }) }),
        ]}
        loading={false}
        onFix={() => undefined}
        projectId="project-1"
      />,
    );
    expect(container.textContent).toContain('Home page not translated');
    expect(container.textContent).toContain('Arabic readers who open your site land on “كيف نضيف وسما”.');
    expect(container.textContent).toContain('French readers who open your site land on “Étiquettes”.');
    // The exact change: the home page's translation key, or (without one) its address.
    expect(container.textContent).toContain('To fix it, set the Translation key of the Arabic home page to “start” in Page settings.');
    expect(container.textContent).toContain(
      'To fix it, give the French home page the address “/get-started”, or give both pages the same Translation key in Page settings.',
    );
    // One row for the home page, with its Fix link.
    expect([...container.querySelectorAll('a[href*="editor"]')].map((link) => link.getAttribute('href'))).toEqual([
      '/app/projects/project-1/editor?page=home&fix=home-untranslated',
    ]);
  });

  it('flags docs under a "Blog" section with a hint to rename it', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <PublishChecks
        checks={[check({ code: 'blog-root-group', pageId: 'blog', title: 'Blog', path: 'blog' })]}
        loading={false}
        onFix={() => undefined}
        projectId="project-1"
      />,
    );
    expect(container.textContent).toContain('Docs filed under “Blog”');
    expect(container.textContent).toContain('Rename the section to what its pages are');
  });
});

describe('Fix buttons', () => {
  // P1-ED-002: two problems on one page produced two identical "Fix Get started in the editor".
  it('names each Fix after its page and its problem, so no two buttons share a name', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <PublishChecks
        checks={[
          check({ code: 'broken-internal-link', severity: 'error', detail: '/configuration' }),
          check({ code: 'broken-internal-link', severity: 'error', detail: '/setup' }),
          check({ code: 'untitled-page' }),
          check({ code: 'empty-page' }),
        ]}
        loading={false}
        onFix={() => undefined}
        projectId="project-1"
      />,
    );
    const names = [...container.querySelectorAll('a[href*="editor"]')].map((link) => link.getAttribute('aria-label'));
    expect(names).toEqual([
      'Fix “Get started”: Broken links · /configuration',
      'Fix “Get started”: Broken links · /setup',
      'Fix “Get started”: Empty pages',
      'Fix “Get started”: Untitled pages',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
