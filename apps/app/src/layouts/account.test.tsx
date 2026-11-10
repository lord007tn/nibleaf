// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Switcher = {
  data?: { organizations: Array<{ id: string; slug: string; name: string }>; recent: unknown[]; landing: { id: string; slug: string } | null };
  isPending: boolean;
};

const mocks = vi.hoisted(() => ({ switcher: {} as Switcher }));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, ...props }: { children?: ReactNode; to: string; params?: { orgSlug: string } }) => (
    <a href={to.replace('$orgSlug', params?.orgSlug ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/api', () => ({ useSwitcher: () => mocks.switcher }));

import { AccountLayout } from './account';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.switcher = {
    isPending: false,
    data: {
      organizations: [
        { id: 'org-1', slug: 'acme', name: 'Acme Docs' },
        { id: 'org-2', slug: 'jood', name: 'JOODPMS' },
      ],
      recent: [],
      landing: { id: 'org-2', slug: 'jood' },
    },
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <AccountLayout>
        <p data-testid="content">Account content</p>
      </AccountLayout>,
    ),
  );
  return host;
}
const backLink = (host: HTMLElement) => host.querySelector<HTMLAnchorElement>('header a') as HTMLAnchorElement;

describe('AccountLayout', () => {
  it('links back to the landing organization by name', async () => {
    const host = await render();
    expect(host.querySelector('header')?.textContent).toContain('account.header');
    expect(backLink(host).getAttribute('href')).toBe('/app/o/jood/websites');
    // The name is isolated with FSI…PDI inside the sentence.
    expect(backLink(host).textContent).toBe('account.backTo(⁨JOODPMS⁩)');
    expect(host.querySelector('main [data-testid="content"]')).not.toBeNull();
  });

  it('links to /app/welcome without a landing organization', async () => {
    mocks.switcher = { isPending: false, data: { organizations: [], recent: [], landing: null } };
    const host = await render();
    expect(backLink(host).getAttribute('href')).toBe('/app/welcome');
    expect(backLink(host).textContent).toBe('account.backToWelcome');
  });

  it('falls back to welcome when the landing org is missing from the list', async () => {
    mocks.switcher = { isPending: false, data: { organizations: [], recent: [], landing: { id: 'gone', slug: 'gone' } } };
    const host = await render();
    expect(backLink(host).getAttribute('href')).toBe('/app/welcome');
  });

  it('shows a placeholder instead of a link while the switcher loads', async () => {
    mocks.switcher = { isPending: true };
    const host = await render();
    expect(host.querySelector('header a')).toBeNull();
    expect(host.querySelector('header [data-slot="skeleton"]')).not.toBeNull();
  });
});
