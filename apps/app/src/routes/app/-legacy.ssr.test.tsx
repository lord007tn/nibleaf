// @vitest-environment node
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

// Server rendering has no `window` (merge council on #418): the redirect must
// read `newSite` through the router.
const mocks = vi.hoisted(() => ({ search: {} as Record<string, unknown>, redirect: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { validateSearch: (search: Record<string, unknown>) => unknown }) => ({
    options,
    useParams: () => ({ legacy: 'sites' }),
    useSearch: () => options.validateSearch(mocks.search),
  }),
}));
vi.mock('@/components/not-found', () => ({ NotFound: () => null }));
vi.mock('@/components/organization/landing-redirect', () => ({
  LandingRedirect: (props: unknown) => {
    mocks.redirect(props);
    return null;
  },
}));

import { Route } from './$legacy';

const Legacy = Route.options.component as unknown as ComponentType;

it.each([
  [{}, undefined],
  [{ newSite: true }, { newSite: true }],
])('renders /app/sites on the server (search %j)', (search, expected) => {
  expect(typeof window).toBe('undefined');
  mocks.search = search;
  expect(() => renderToString(<Legacy />)).not.toThrow();
  expect(mocks.redirect).toHaveBeenLastCalledWith({ section: 'websites', search: expected });
});
