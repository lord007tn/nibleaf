import { useNavigate } from '@tanstack/react-router';
import { ChevronsUpDown, Languages, LogOut, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarFooter, SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar';
import { authClient } from '@/lib/auth-client';
import { useLocale } from '@/lib/i18n';

/** Shared sidebar footer: the signed-in account button + menu (theme, language,
 *  sign out). Used by both the global app sidebar and the per-site sidebar. */
export function SidebarAccountFooter() {
  const { data: session } = authClient.useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const navigate = useNavigate();

  const initials = (session?.user?.name ?? 'U')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  className="flex h-12 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-start text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[popup-open]:bg-sidebar-accent [&_svg]:size-4 [&_svg]:shrink-0"
                  type="button"
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
  );
}
