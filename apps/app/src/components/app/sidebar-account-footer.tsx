import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@nibleaf/design-system/components/ui/sidebar';
import { useTheme } from '@nibleaf/design-system/theme';
import { INTERFACE_LOCALES } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronsUpDown, Languages, LogOut, Moon, Sun } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { InterfaceLanguageDialog } from '@/components/interface-language-dialog';
import { authClient } from '@/services/auth-client';

const subscribeToHydration = () => () => undefined;

/** Shared sidebar footer: the signed-in account button + menu (theme, language,
 *  sign out). Used by both the global app sidebar and the per-site sidebar. */
export function SidebarAccountFooter() {
  const { data: session } = authClient.useSession();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const visibleSession = hydrated ? session : null;
  const { setTheme, resolvedTheme } = useTheme();
  const { locale, t } = useLocale();
  const activeLocale = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];
  const [languageOpen, setLanguageOpen] = useState(false);
  const navigate = useNavigate();

  const initials = (visibleSession?.user?.name ?? 'U')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground" size="lg" />
                }
              >
                <Avatar className="size-9 rounded-lg">
                  {visibleSession?.user?.image ? <AvatarImage alt={visibleSession.user.name} src={visibleSession.user.image} /> : null}
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start leading-tight">
                  <span className="truncate font-medium text-sm" dir="auto">
                    {visibleSession?.user?.name ?? t('nav.account')}
                  </span>
                  <span className="truncate text-muted-foreground text-xs" dir="ltr">
                    {visibleSession?.user?.email ?? ''}
                  </span>
                </div>
                <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64" side="top">
                <DropdownMenuLabel className="flex items-center gap-3 py-2">
                  <Avatar className="size-9 rounded-lg">
                    {visibleSession?.user?.image ? <AvatarImage alt={visibleSession.user.name} src={visibleSession.user.image} /> : null}
                    <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{visibleSession?.user?.name ?? t('nav.account')}</span>
                    <span className="block truncate font-normal text-muted-foreground text-xs">{visibleSession?.user?.email ?? ''}</span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                  {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {resolvedTheme === 'dark' ? t('account.lightMode') : t('account.darkMode')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguageOpen(true)}>
                  <Languages className="size-4" />
                  {t('account.language')}
                  <span className="ms-auto text-muted-foreground text-xs" lang={activeLocale.code} dir={activeLocale.direction}>
                    {activeLocale.native}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await authClient.signOut();
                    navigate({ to: '/sign-in' });
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
      <InterfaceLanguageDialog open={languageOpen} onOpenChange={setLanguageOpen} />
    </>
  );
}
