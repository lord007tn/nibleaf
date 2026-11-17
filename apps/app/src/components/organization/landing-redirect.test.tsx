// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SwitcherResult = {
  data?: { organizations: unknown[]; recent: unknown[]; landing: { slug: string } | null };
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => void;
};

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refetch: vi.fn(),
  switcher: {} as SwitcherResult,
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
// The auth surfaces translate through AUTH_MESSAGES (MKT-001); give them the
// same translator and locale as the @nibleaf/i18n/react mock above.
vi.mock('@/lib/auth-messages', async () => {
  const react = (await import('@nibleaf/i18n/react')) as unknown as {
    useT?: () => (key: string, variables?: Record<string, string | number>) => string;
    useLocale?: () => Record<string, unknown>;
  };
  // Plain names: the mocks are read per render, not called as hooks here. A
  // mock without one of them throws on access, hence the `in` checks.
  const readT = 'useT' in react ? react.useT : undefined;
  const readLocale = 'useLocale' in react ? react.useLocale : undefined;
  const authLocale = (): Record<string, unknown> => ({ locale: 'en', setLocale: () => undefined, ...(readLocale ? readLocale() : { t: readT?.() }) });
  return { useAuthLocale: authLocale, useAuthT: () => (readT ? readT() : authLocale().t) };
});

vi.mock('@nibleaf/i18n/standalone', () => ({ useStandaloneT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/api', () => ({ useSwitcher: () => mocks.switcher }));

import { LandingRedirect } from './landing-redirect';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.switcher = { data: undefined, isSuccess: false, isError: false, isFetching: true, refetch: mocks.refetch };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(element));
  return host;
}
const success = (landing: { slug: string } | null) => ({
  data: { organizations: [], recent: [], landing },
  isSuccess: true,
  isError: false,
  isFetching: false,
  refetch: mocks.refetch,
});

describe('LandingRedirect', () => {
  it('shows a loader and does not navigate while the switcher loads', async () => {
    const host = await render(<LandingRedirect section="websites" />);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('replaces the URL with the landing org section, keeping the search', async () => {
    mocks.switcher = success({ slug: 'acme' });
    const search = { firstPublish: 'x' };
    await render(<LandingRedirect search={search} section="members" />);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/o/$orgSlug/members',
      params: { orgSlug: 'acme' },
      search,
      replace: true,
    });
  });

  it('sends someone without any organization to /app/welcome', async () => {
    mocks.switcher = success(null);
    await render(<LandingRedirect section="websites" />);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/welcome', replace: true });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error instead of an empty account when the switcher fails', async () => {
    mocks.switcher = { data: undefined, isSuccess: false, isError: true, isFetching: false, refetch: mocks.refetch };
    const host = await render(<LandingRedirect section="websites" />);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('error.title');
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => alert?.querySelector('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
