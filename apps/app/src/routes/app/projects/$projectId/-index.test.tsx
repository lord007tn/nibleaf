// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pending = { data: undefined, isPending: true };

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ projectId: 'project-1' }) }),
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className} href="/link">
      {children}
    </a>
  ),
}));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeployments: () => pending,
  useDomains: () => pending,
  usePages: () => pending,
  useProject: () => pending,
  useProjectMembers: () => pending,
  usePublishAnyway: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/api/analytics', () => ({ useProjectAnalytics: () => pending }));
vi.mock('@/hooks/api/query-options', () => ({ domainsQueryOptions: vi.fn(), projectMembersQueryOptions: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/components/analytics/views-area-chart', () => ({ ViewsAreaChart: () => null }));

import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SiteOverviewPage = Route.options.component as unknown as ComponentType;

describe('site overview first load', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('announces loading once for the page and keeps the heading free of block elements', async () => {
    await act(async () => root.render(<SiteOverviewPage />));

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The loading regions are still marked busy.
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(2);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('overview.title');
    expect(heading?.querySelector('div')).toBeNull();
    expect(heading?.querySelector('[data-slot="skeleton"]')?.tagName).toBe('SPAN');
  });
});
