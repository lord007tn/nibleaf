import { useNavigate } from '@tanstack/react-router';
import { Languages, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { authClient } from '@/lib/auth-client';
import { useLocale } from '@/lib/i18n';

/** Compact avatar account menu (theme, language, account settings, sign out) for
 *  the site shell — single-site users never see the global sidebar, so account
 *  controls live here too. */
export function AccountMenu() {
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={t('nav.account')}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground text-xs"
            type="button"
          >
            {initials}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{session?.user?.name ?? 'Account'}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: '/app/settings', search: { tab: 'account' } })}>
          <Settings className="size-4" /> {t('nav.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {resolvedTheme === 'dark' ? t('account.lightMode') : t('account.darkMode')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
          <Languages className="size-4" /> {t('account.language')}
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
  );
}
