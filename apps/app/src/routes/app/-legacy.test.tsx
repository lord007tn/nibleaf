// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ legacy: 'sites', redirect: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ legacy: mocks.legacy }) }),
}));
vi.mock('@/components/not-found', () => ({ NotFound: () => <h1 data-testid="not-found">not found</h1> }));
vi.mock('@/components/organization/landing-redirect', () => ({
  LandingRedirect: (props: { section: string; search?: unknown }) => {
    mocks.redirect(props);
    return null;
  },
}));

import { Route } from './$legacy';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const Legacy = Route.options.component as unknown as ComponentType;
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});
const render = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Legacy />));
  return host;
};

it.each([
  ['sites', 'websites'],
  ['people', 'members'],
  ['members', 'members'],
  ['analytics', 'analytics'],
])('sends the old /app/%s into the landing organization (%s)', async (legacy, section) => {
  mocks.legacy = legacy;
  await render();
  expect(mocks.redirect).toHaveBeenCalledWith({ section, search: undefined });
});

it('keeps /app/sites?newSite=true opening New website', async () => {
  mocks.legacy = 'sites';
  window.history.replaceState(null, '', '/app/sites?newSite=true');
  await render();
  expect(mocks.redirect).toHaveBeenCalledWith({ section: 'websites', search: { newSite: true } });
});

it('shows not-found for anything else under /app', async () => {
  mocks.legacy = 'unknown-page';
  const host = await render();
  expect(host.querySelector('[data-testid="not-found"]')).not.toBeNull();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
