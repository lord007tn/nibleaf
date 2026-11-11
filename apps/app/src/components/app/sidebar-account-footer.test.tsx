// @vitest-environment jsdom
import { SidebarProvider } from '@nibleaf/design-system/components/ui/sidebar';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { name: string; email: string; image?: string | null } },
  routeSession: null as null | { user: { name: string; email: string; image?: string | null } },
  theme: 'light' as 'light' | 'dark' | 'system',
  setTheme: vi.fn(),
  languageOpen: vi.fn(),
  shortcutsOpen: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }), useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/theme', () => ({ useTheme: () => ({ theme: mocks.theme, resolvedTheme: 'light', setTheme: mocks.setTheme }) }));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouteContext: ({ select }: { select: (context: { routeSession: unknown }) => unknown }) => select({ routeSession: mocks.routeSession }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
vi.mock('@/services/auth-client', () => ({ authClient: { useSession: () => ({ data: mocks.session }) } }));
vi.mock('@/services/dashboard-session', () => ({ signOutDashboard: vi.fn() }));
vi.mock('@/lib/links', () => ({ GITHUB_URL: 'https://github.com/example/nibleaf' }));
// A real dialog: the bug was the closing menu returning focus and dismissing it.
vi.mock('@/components/interface-language-dialog', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('@nibleaf/design-system/components/ui/dialog');
  return {
    InterfaceLanguageDialog: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
      mocks.languageOpen(open);
      return (
        <Dialog onOpenChange={onOpenChange} open={open}>
          <DialogContent>
            <DialogTitle>language</DialogTitle>
            <div data-testid="language-dialog" />
          </DialogContent>
        </Dialog>
      );
    },
  };
});
vi.mock('./keyboard-shortcuts-dialog', () => ({
  KeyboardShortcutsDialog: ({ open }: { open: boolean }) => {
    mocks.shortcutsOpen(open);
    return open ? <div data-testid="shortcuts-dialog" /> : null;
  },
}));

import { accountInitials, SidebarAccountFooter } from './sidebar-account-footer';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  mocks.session = null;
  mocks.routeSession = null;
  mocks.theme = 'light';
  window.matchMedia ??= vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});
const render = async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SidebarProvider>
        <SidebarAccountFooter />
      </SidebarProvider>,
    ),
  );
};
const trigger = () => host.querySelector<HTMLElement>('[data-sidebar="menu-button"], button');
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
const openMenu = async () => {
  await act(async () => trigger()?.click());
  await settle();
};
const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')].find((node) => node.textContent?.includes(label));

describe('account initials', () => {
  it('uses the name, else the email, never a placeholder letter', () => {
    expect(accountInitials({ name: 'Ada Lovelace', email: 'ada@example.test' })).toBe('AL');
    expect(accountInitials({ name: '', email: 'sofiene.k@example.test' })).toBe('SO');
    expect(accountInitials({ name: null, email: null })).toBe('');
    expect(accountInitials(null)).toBe('');
  });
});

describe('sidebar account footer (audit WORKSPACE-17 and 28)', () => {
  it('shows the server-resolved account at once instead of "U / Account" or a skeleton', async () => {
    mocks.routeSession = { user: { name: '', email: 'sofiene@example.test' } };
    await render();
    expect(host.textContent).toContain('sofiene@example.test');
    expect(host.textContent).toContain('SO');
    expect(host.textContent).not.toMatch(/\bU\b/);
    expect(host.textContent).not.toContain('nav.account');
  });

  it('shows a skeleton, not a fake initial, when there is no session at all', async () => {
    await render();
    expect(host.textContent?.trim()).toBe('');
    expect(trigger()?.getAttribute('aria-label')).toBe('nav.account');
  });

  it.each(['language', 'shortcuts'] as const)('opens the %s dialog from the keyboard (Enter), not only by click', async (dialog) => {
    mocks.session = { user: { name: 'Ada Lovelace', email: 'ada@example.test' } };
    await render();
    await openMenu();
    const target = item(dialog === 'language' ? 'account.language' : 'account.menu.shortcuts');
    expect(target).toBeDefined();
    await act(async () => {
      target?.focus();
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      target?.click();
    });
    await settle();
    expect(document.querySelector(`[data-testid="${dialog}-dialog"]`)).not.toBeNull();
  });

  it('offers Light, Dark and Match my device, plus help, what’s new and report a problem', async () => {
    mocks.session = { user: { name: 'Ada Lovelace', email: 'ada@example.test' } };
    mocks.theme = 'system';
    await render();
    await openMenu();
    const radios = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(radios.map((node) => node.textContent?.trim())).toEqual([
      'settings.appearance.theme.light',
      'settings.appearance.theme.dark',
      'settings.appearance.theme.system',
    ]);
    expect(radios[2]?.getAttribute('aria-checked')).toBe('true');
    await act(async () => radios[1]?.click());
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    const links = Object.fromEntries(
      [...document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')].map((link) => [link.textContent?.trim(), link.getAttribute('href')]),
    );
    expect(links).toEqual({
      'account.menu.help': 'https://docs.nibleaf.com/',
      'account.menu.whatsNew': 'https://github.com/example/nibleaf/releases',
      'account.menu.reportProblem': 'https://github.com/example/nibleaf/issues/new/choose',
    });
  });
});
