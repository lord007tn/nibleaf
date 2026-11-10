import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSwitcher } from '@/hooks/api';

/**
 * Account settings shell (§5.4.4): personal, so no org chrome — a plain
 * "Account" header and a way back to the last organization.
 */
export function AccountLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const switcher = useSwitcher();
  const landing = switcher.data?.landing;
  const name = landing ? switcher.data?.organizations.find((org) => org.id === landing.id)?.name : undefined;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-12 min-w-0 items-center gap-3 border-border border-b bg-background/80 px-3 backdrop-blur sm:px-4">
        <NibleafMark aria-hidden className="size-6 shrink-0" />
        <span className="font-semibold">{t('account.header')}</span>
        <div className="ms-auto min-w-0">
          {switcher.isPending ? (
            <Skeleton aria-hidden className="h-4 w-32" />
          ) : landing && name ? (
            <Button
              className="max-w-full"
              nativeButton={false}
              render={<Link params={{ orgSlug: landing.slug }} to="/app/o/$orgSlug/websites" />}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:-scale-x-100" />
              {/* FSI…PDI isolates the org name inside the sentence, like <bdi>. */}
              <span className="truncate">{t('account.backTo', { org: `⁨${name}⁩` })}</span>
            </Button>
          ) : (
            <Button nativeButton={false} render={<Link to="/app/welcome" />} size="sm" variant="ghost">
              <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:-scale-x-100" />
              {t('account.backToWelcome')}
            </Button>
          )}
        </div>
      </header>
      <main className="w-full px-4 py-6 outline-none sm:px-6 sm:py-8" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
