// @vitest-environment jsdom

import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' as string }));
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), useProjects: vi.fn() }));

// Real catalogs, controlled locale: the page count must come out translated and
// in the locale's own digits (Arabic-Indic for ar), not as a raw number.
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  const useLocale = () => ({
    locale: i18n.locale as Locale,
    setLocale: vi.fn(),
    t: (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, i18n.locale as Locale),
  });
  return { useLocale, useT: () => useLocale().t };
});
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}) }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects }));
vi.mock('@/components/app/new-project-dialog', () => ({ NewProjectDialog: () => null }));

import { Route } from './sites';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SitesPage = Route.options.component as unknown as ComponentType;

describe('SitesPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => root.render(<SitesPage />));
  };

  beforeEach(() => {
    i18n.locale = 'en';
    mocks.useProjects.mockReturnValue({
      isPending: false,
      data: [{ id: 'project-1', name: 'Docs', slug: 'docs', _count: { pages: 58, deployments: 3 } }],
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows the site page count through the translated count message', async () => {
    await render();

    expect(container.textContent).toContain('58 pages');
  });

  it('gives the site filter an explicit accessible name', async () => {
    await render();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute('aria-label')).toBe('Search…');
  });

  it('formats the page count in Arabic-Indic digits for the Arabic interface', async () => {
    i18n.locale = 'ar';
    await render();

    expect(container.textContent).toContain('٥٨ صفحة');
    expect(container.textContent).not.toContain('58');
  });
});
