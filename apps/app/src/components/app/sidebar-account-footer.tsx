import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
// Its own module so the radio items stay out of the reader's first load.
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@nibleaf/design-system/components/ui/dropdown-menu-radio';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@nibleaf/design-system/components/ui/sidebar';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { type Theme, useTheme } from '@nibleaf/design-system/theme';
import { INTERFACE_LOCALES } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { BookOpen, Bug, ChevronsUpDown, Keyboard, Languages, LogOut, Sparkles, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { InterfaceLanguageDialog } from '@/components/interface-language-dialog';
import { GITHUB_URL } from '@/lib/links';
import { authClient } from '@/services/auth-client';
import { signOutDashboard } from '@/services/dashboard-session';
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog';

const graphemes = (value: string): string[] => {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  }
  return Array.from(value); // Code points: never splits a surrogate pair.
};

/** Two characters for the avatar, from the name (first grapheme of the first
 *  two words) or else the email's local part. Graphemes, not UTF-16 units, so
 *  an emoji, a supplementary-plane letter or a combined Arabic letter is never
 *  cut in half. */
export const accountInitials = (user: { name?: string | null; email?: string | null } | null | undefined) => {
  const name = user?.name?.trim();
  if (name)
    return name
      .split(/\s+/)
      .map((part) => graphemes(part)[0] ?? '')
      .slice(0, 2)
      .join('')
      .toUpperCase();
  const local = user?.email?.split('@')[0]?.replace(/[^\p{L}\p{N}]/gu, '') ?? '';
  return graphemes(local).slice(0, 2).join('').toUpperCase();
};

const helpUrl = (locale: string) => `https://docs.nibleaf.com/${locale === 'ar' ? 'ar/' : ''}`;
const THEMES = [
  { value: 'light', label: 'settings.appearance.theme.light' },
  { value: 'dark', label: 'settings.appearance.theme.dark' },
  { value: 'system', label: 'settings.appearance.theme.system' },
] as const;

/** Shared sidebar footer: the signed-in account button + menu (account,
 *  theme, language, help, sign out). Used by the org and website sidebars. */
export function SidebarAccountFooter() {
  const { data: session } = authClient.useSession();
  // The /app route already resolved the session on the server: show it at once
  // and on every navigation instead of a "U / Account" flash or a skeleton
  // while the client re-checks (production audit WORKSPACE-28).
  const routeSession = useRouteContext({ from: '/app', select: (context) => context.routeSession });
  const user = session?.user ?? routeSession?.user ?? null;
  const { theme, setTheme } = useTheme();
  const { locale, t } = useLocale();
  const activeLocale = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // A dialog chosen from the menu opens only once the menu has finished closing
  // and returned focus, so Enter works like a click (WORKSPACE-17).
  const pendingDialog = useRef<'language' | 'shortcuts' | null>(null);
  const navigate = useNavigate();
  // Sign-out resets the whole cache for the next account, so it uses the real client.
  const queryClient = useQueryClient();
  const initials = accountInitials(user);

  return (
    <>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu
              onOpenChangeComplete={(open) => {
                if (open || !pendingDialog.current) return;
                const dialog = pendingDialog.current;
                pendingDialog.current = null;
                if (dialog === 'language') setLanguageOpen(true);
                else setShortcutsOpen(true);
              }}
            >
              <DropdownMenuTrigger
                aria-label={user ? undefined : t('nav.account')}
                render={
                  <SidebarMenuButton className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground" size="lg" />
                }
              >
                {user ? (
                  <Avatar className="size-9 rounded-lg">
                    {user.image ? <AvatarImage alt={user.name} src={user.image} /> : null}
                    <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Skeleton aria-hidden className="size-9 shrink-0 rounded-lg" />
                )}
                {user ? (
                  <div className="grid flex-1 text-start leading-tight">
                    <span className="truncate font-medium text-sm">
                      <bdi>{user.name || user.email}</bdi>
                    </span>
                    {user.name ? (
                      <span className="truncate text-muted-foreground text-xs">
                        <bdi dir="ltr">{user.email}</bdi>
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div aria-hidden className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                )}
                <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64" side="top">
                <DropdownMenuLabel className="flex items-center gap-3 py-2">
                  <Avatar className="size-9 rounded-lg">
                    {user?.image ? <AvatarImage alt={user.name} src={user.image} /> : null}
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user?.name || user?.email}</span>
                    {user?.name ? <span className="block truncate font-normal text-muted-foreground text-xs">{user.email}</span> : null}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Account settings are personal and reached only from here (§5.4.4). */}
                <DropdownMenuItem onClick={() => void navigate({ to: '/app/settings', search: { tab: 'account' } })}>
                  <UserRound className="size-4" />
                  {t('command.accountSettings')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    pendingDialog.current = 'language';
                  }}
                >
                  <Languages className="size-4" />
                  {t('account.language')}
                  <span className="ms-auto text-muted-foreground text-xs" dir={activeLocale.direction} lang={activeLocale.code}>
                    {activeLocale.native}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">{t('settings.appearance.theme.title')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup onValueChange={(value) => setTheme(value as Theme)} value={theme}>
                    {THEMES.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {t(option.label)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<a href={helpUrl(locale)} rel="noopener noreferrer" target="_blank" />}>
                  <BookOpen className="size-4" />
                  {t('account.menu.help')}
                </DropdownMenuItem>
                <DropdownMenuItem render={<a href={`${GITHUB_URL}/releases`} rel="noopener noreferrer" target="_blank" />}>
                  <Sparkles className="size-4" />
                  {t('account.menu.whatsNew')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    pendingDialog.current = 'shortcuts';
                  }}
                >
                  <Keyboard className="size-4" />
                  {t('account.menu.shortcuts')}
                </DropdownMenuItem>
                <DropdownMenuItem render={<a href={`${GITHUB_URL}/issues/new/choose`} rel="noopener noreferrer" target="_blank" />}>
                  <Bug className="size-4" />
                  {t('account.menu.reportProblem')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      await signOutDashboard(queryClient, () => navigate({ to: '/sign-in', replace: true }));
                    } catch {
                      toast.error(t('account.signOutError'));
                    }
                  }}
                  variant="destructive"
                >
                  <LogOut className="size-4" /> {t('account.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <InterfaceLanguageDialog onOpenChange={setLanguageOpen} open={languageOpen} />
      <KeyboardShortcutsDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
    </>
  );
}
