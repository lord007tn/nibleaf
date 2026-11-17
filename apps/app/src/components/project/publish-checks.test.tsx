// @vitest-environment jsdom

import { computeAccessibleName } from 'dom-accessibility-api';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
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
  const versions = new Map([
    ['v1', 'Stable مستقر'],
    ['v2', 'Next تجريبي'],
  ]);
  const firstVersionCheck = check({
    code: 'broken-internal-link',
    severity: 'error',
    pageId: 'page-v1',
    versionId: 'v1',
    title: 'Guide',
    path: 'guide',
    detail: '/gone?x=1&y=2#intro',
  });
  const secondVersionCheck = { ...firstVersionCheck, pageId: 'page-v2', versionId: 'v2' };
  const versionChecks = [firstVersionCheck, secondVersionCheck];
  const renderChecks = (checks: PublishCheck[], versionNames?: ReadonlyMap<string, string>) => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <PublishChecks checks={checks} loading={false} onFix={() => undefined} projectId="project-1" versionNames={versionNames} />,
    );
    return container;
  };

  it('shows each known version inside its Fix link and accessible name, preserving its page and evidence', () => {
    const container = renderChecks(versionChecks, versions);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.textContent)).toEqual(['FixVersion: \u2068Stable مستقر\u2069', 'FixVersion: \u2068Next تجريبي\u2069']);
    expect(links.map((link) => link.querySelector('bdi')?.textContent)).toEqual([
      'Version: \u2068Stable مستقر\u2069',
      'Version: \u2068Next تجريبي\u2069',
    ]);
    expect(links.map((link) => computeAccessibleName(link))).toEqual([
      'Fix “Guide”: Broken links · /gone?x=1&y=2#intro · /guide · Version: \u2068Stable مستقر\u2069',
      'Fix “Guide”: Broken links · /gone?x=1&y=2#intro · /guide · Version: \u2068Next تجريبي\u2069',
    ]);
    expect(links.map((link) => Object.fromEntries(new URL(link.href, 'https://app.test').searchParams))).toEqual([
      { page: 'page-v1', fix: 'broken-internal-link', fixTarget: '/gone?x=1&y=2#intro' },
      { page: 'page-v2', fix: 'broken-internal-link', fixTarget: '/gone?x=1&y=2#intro' },
    ]);
  });

  it('keeps single-version markup identical and ignores unknown or absent version metadata', () => {
    const single = [firstVersionCheck, { ...firstVersionCheck, pageId: 'other' }];
    expect(renderChecks(single, versions).innerHTML).toBe(renderChecks(single).innerHTML);
    const mixed = [
      ...versionChecks,
      { ...firstVersionCheck, pageId: 'unknown', versionId: 'unknown' },
      { ...firstVersionCheck, pageId: 'legacy', versionId: undefined },
    ];
    const links = [...renderChecks(mixed, versions).querySelectorAll('a')];
    expect(links.slice(2).map((link) => link.textContent)).toEqual(['Fix', 'Fix']);
    expect(renderChecks(mixed, new Map([['v1', 'Stable']])).querySelector('a bdi')).toBeNull();
    expect(renderChecks(mixed).querySelector('a bdi')).toBeNull();
  });

  it('translates the version label in Arabic and isolates mixed-direction version names', () => {
    document.documentElement.setAttribute('data-locale', 'ar');
    try {
      const links = [...renderChecks(versionChecks, versions).querySelectorAll('a')];
      expect(links.map((link) => link.querySelector('bdi')?.textContent)).toEqual([
        'الإصدار: \u2068Stable مستقر\u2069',
        'الإصدار: \u2068Next تجريبي\u2069',
      ]);
      expect(links.map((link) => computeAccessibleName(link))).toEqual([
        expect.stringContaining('الإصدار: \u2068Stable مستقر\u2069'),
        expect.stringContaining('الإصدار: \u2068Next تجريبي\u2069'),
      ]);
    } finally {
      document.documentElement.removeAttribute('data-locale');
    }
  });

  it('closes on Fix without altering truncated evidence navigation', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    const root = createRoot(container);
    const onFix = vi.fn();
    try {
      await act(async () =>
        root.render(
          <PublishChecks
            checks={[{ ...firstVersionCheck, reason: 'path-too-long' }, secondVersionCheck]}
            loading={false}
            onFix={onFix}
            projectId="project-1"
            versionNames={versions}
          />,
        ),
      );
      const link = container.querySelector('a');
      if (!link) throw new Error('Missing Fix link');
      link.addEventListener('click', (event) => event.preventDefault());
      await act(async () => link.click());
      expect(onFix).toHaveBeenCalledOnce();
      expect(new URL(link.href, 'https://app.test').searchParams.get('fixTarget')).toBeNull();
      expect(new URL(link.href, 'https://app.test').searchParams.get('page')).toBe('page-v1');
    } finally {
      await act(async () => root.unmount());
    }
  });

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
      'Fix “Get started”: Broken links · /configuration · /get-started',
      'Fix “Get started”: Broken links · /setup · /get-started',
      'Fix “Get started”: Empty pages · /get-started',
      'Fix “Get started”: Untitled pages · /get-started',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  // Sol review of #616: two pages with the same title shared one name.
  it('tells apart two pages with the same title by their address', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <PublishChecks
        checks={[
          check({ code: 'duplicate-title', pageId: 'a', title: 'Guide', path: 'web/guide', detail: 'cli/guide' }),
          check({ code: 'duplicate-title', pageId: 'b', title: 'Guide', path: 'cli/guide', detail: 'web/guide' }),
        ]}
        loading={false}
        onFix={() => undefined}
        projectId="project-1"
      />,
    );
    const names = [...container.querySelectorAll('a[href*="editor"]')].map((link) => link.getAttribute('aria-label'));
    expect(names).toEqual(['Fix “Guide”: Duplicate titles · /web/guide', 'Fix “Guide”: Duplicate titles · /cli/guide']);
  });
});
