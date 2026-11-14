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
  setLocale: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({ locale: 'en', setLocale: mocks.setLocale, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));
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

// The real language and shortcuts dialogs: the bug was the closing menu
// returning focus to its trigger and dismissing the dialog it had just opened.
import { accountInitials, SidebarAccountFooter } from './sidebar-account-footer';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  // The language dialog's cmdk list relies on browser APIs jsdom does not implement.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
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

  it('takes whole graphemes, never half an emoji or a supplementary-plane letter', () => {
    // Emoji: a surrogate pair, and a ZWJ sequence that is one visible character.
    expect(accountInitials({ name: '🦊 Fox' })).toBe('🦊F');
    expect(accountInitials({ name: '👩‍👩‍👧 Team' })).toBe('👩‍👩‍👧T');
    // Arabic, including a letter with a combining vowel mark.
    expect(accountInitials({ name: 'ليلى أحمد' })).toBe('لأ');
    expect(accountInitials({ name: 'سَلمى' })).toBe('سَ');
    // Supplementary-plane letters, from the name and from the email.
    expect(accountInitials({ name: '𝒜da Byron' })).toBe('𝒜B');
    expect(accountInitials({ email: '𐐨𐐯𐐻@example.test' })).toBe('𐐀𐐇');
    // No lone surrogate: what `part[0]` used to produce.
    for (const initials of [accountInitials({ name: '🦊 Fox' }), accountInitials({ email: '𐐨𐐯𐐻@example.test' })]) {
      expect(Array.from(initials).every((char) => !/^[\uD800-\uDFFF]$/u.test(char))).toBe(true);
    }
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

  it.each([
    ['language', 'account.language', 'account.language.description'],
    ['shortcuts', 'account.menu.shortcuts', 'shortcuts.description'],
  ] as const)('opens the real %s dialog with the Enter key and keeps it open', async (_dialog, menuLabel, description) => {
    mocks.session = { user: { name: 'Ada Lovelace', email: 'ada@example.test' } };
    await render();
    await openMenu();
    const target = item(menuLabel);
    expect(target).toBeDefined();
    // Keyboard only: focus the item and press Enter, as a keyboard user does. No click().
    await act(async () => {
      target?.focus();
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      target?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    });
    await settle();
    await settle(); // the menu's close and focus return have finished
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain(description);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // Focus is inside the dialog, not back on the menu trigger. jsdom does not
    // run the browser's focus-return dismissal itself (the original bug): that
    // stays covered by the browser check in the PR (.github/assets/shell-polish).
    expect(dialog?.contains(document.activeElement)).toBe(true);
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
