// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firstPublish: undefined as boolean | undefined,
  navigate: vi.fn(),
  landing: vi.fn(),
  recordStage: vi.fn(async () => undefined),
  projects: {} as { data?: Array<{ id: string }>; isSuccess: boolean },
}));

vi.mock('@nibleaf/i18n/standalone', () => ({ useStandaloneT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({ firstPublish: mocks.firstPublish }) }),
  useNavigate: () => mocks.navigate,
}));
vi.mock('@/components/organization/landing-redirect', () => ({
  LandingRedirect: (props: { section: string }) => {
    mocks.landing(props);
    return <div data-section={props.section} data-testid="landing-redirect" />;
  },
}));
vi.mock('@/hooks/api', () => ({ useProjects: () => mocks.projects }));
vi.mock('@/hooks/api/organization-query-options', () => ({ switcherQueryOptions: () => ({ queryKey: ['me', 'switcher'] }) }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/lib/first-publish-activation', () => ({ recordFirstPublishStage: mocks.recordStage }));

import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const AppLanding = Route.options.component as unknown as ComponentType;
const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => { firstPublish?: boolean };
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.firstPublish = undefined;
  mocks.projects = { data: undefined, isSuccess: false };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AppLanding />));
  return host;
}

describe('/app landing', () => {
  it('lands in the landing organization Websites by default', async () => {
    const host = await render();
    expect(host.querySelector<HTMLElement>('[data-testid="landing-redirect"]')?.dataset.section).toBe('websites');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('accepts firstPublish as a boolean or the string "true" only', () => {
    expect(validateSearch({ firstPublish: true })).toEqual({ firstPublish: true });
    expect(validateSearch({ firstPublish: 'true' })).toEqual({ firstPublish: true });
    expect(validateSearch({ firstPublish: '1' })).toEqual({});
    expect(validateSearch({})).toEqual({});
  });

  it('?firstPublish opens the first website editor', async () => {
    mocks.firstPublish = true;
    mocks.projects = { data: [{ id: 'starter' }, { id: 'other' }], isSuccess: true };
    const host = await render();
    expect(mocks.recordStage).toHaveBeenCalledWith('project_entered');
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/editor',
      params: { projectId: 'starter' },
      search: { firstPublish: true },
      replace: true,
    });
    expect(host.querySelector('[data-testid="landing-redirect"]')).toBeNull();
  });

  it('?firstPublish waits for the websites, then falls back to the landing org without any', async () => {
    mocks.firstPublish = true;
    const host = await render();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="landing-redirect"]')).toBeNull();
    mocks.projects = { data: [], isSuccess: true };
    await act(async () => root.render(<AppLanding />));
    expect(host.querySelector<HTMLElement>('[data-testid="landing-redirect"]')?.dataset.section).toBe('websites');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
