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
        checks={[check({ code: 'home-untranslated', detail: 'ar|كيف نضيف وسما' }), check({ code: 'home-untranslated', detail: 'fr|Étiquettes' })]}
        loading={false}
        onFix={() => undefined}
        projectId="project-1"
      />,
    );
    expect(container.textContent).toContain('Home page not translated');
    expect(container.textContent).toContain('Arabic readers who open your site land on “كيف نضيف وسما”.');
    expect(container.textContent).toContain('French readers who open your site land on “Étiquettes”.');
    // One row for the home page, with its Fix link.
    expect([...container.querySelectorAll('a[href*="editor"]')].map((link) => link.getAttribute('href'))).toEqual([
      '/app/projects/project-1/editor?page=home',
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
