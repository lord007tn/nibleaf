import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { BarChart3, BookText, ChevronsUpDown, Languages, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { authClient } from '@/lib/auth-client';
import { useLocale } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

// Account-level nav. Members live per-site now (each site's Settings → Members),
// so they're not here; Analytics stays as the cross-site global view.
const NAV = [
  { to: '/app', labelKey: 'nav.sites', icon: BookText, exact: true },
  { to: '/app/analytics', labelKey: 'nav.analytics', icon: BarChart3, exact: false },
  { to: '/app/settings', labelKey: 'nav.settings', icon: Settings, exact: false },
] as const satisfies ReadonlyArray<{ to: string; labelKey: MessageKey; icon: typeof BookText; exact: boolean }>;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = authClient.useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();

  const initials = (session?.user?.name ?? 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background">✎</span>
          <span className="font-semibold tracking-tight">Plume</span>
          <span className="ms-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t('brand.oss')}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.account')}</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const label = t(item.labelKey);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton isActive={active} tooltip={label} render={<Link to={item.to} />}>
                    <item.icon className="size-4" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  // A plain host <button> — Base UI's Menu.Trigger can't compose a
                  // nested useRender component (SidebarMenuButton) as its render
                  // target (throws Base UI #31).
                  <button
                    type="button"
                    className="flex h-12 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-start text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[popup-open]:bg-sidebar-accent [&_svg]:size-4 [&_svg]:shrink-0"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground text-xs">
                      {initials}
                    </span>
                    <div className="grid flex-1 text-start leading-tight">
                      <span className="truncate font-medium text-sm">{session?.user?.name ?? 'Account'}</span>
                      <span className="truncate text-muted-foreground text-xs">{session?.user?.email ?? ''}</span>
                    </div>
                    <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56" side="top">
                <DropdownMenuLabel>{session?.user?.name ?? 'Account'}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                  {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {resolvedTheme === 'dark' ? t('account.lightMode') : t('account.darkMode')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
                  <Languages className="size-4" />
                  {t('account.language')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await authClient.signOut();
                    navigate({ to: '/sign-in' });
                  }}
                >
                  <LogOut className="size-4" /> {t('account.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
