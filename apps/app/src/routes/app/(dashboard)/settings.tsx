import { cn } from '@nibleaf/design-system/lib/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AccountTab } from '@/components/settings/account-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

// Global account settings only — everything site-specific (members, billing,
// integrations, notifications, git) now lives per-site under each site's Settings.
const SECTIONS = [
  { value: 'account', labelKey: 'settings.tab.account', icon: '◔' },
  { value: 'appearance', labelKey: 'settings.tab.appearance', icon: '◐' },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey; icon: string }>;

type TabValue = (typeof SECTIONS)[number]['value'];

const isTabValue = (value: unknown): value is TabValue => SECTIONS.some((s) => s.value === value);

export const Route = createFileRoute('/app/(dashboard)/settings')({
  component: WorkspaceSettingsPage,
  validateSearch: (search: Record<string, unknown>): { tab: TabValue } => ({
    tab: isTabValue(search.tab) ? search.tab : 'account',
  }),
});

function WorkspaceSettingsPage() {
  const t = useT();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('settings.subtitle')}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:gap-8">
        <label className="sm:hidden">
          <span className="sr-only">{t('settings.title')}</span>
          <select
            aria-label={t('settings.title')}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            onChange={(event) => navigate({ search: { tab: event.target.value as TabValue }, replace: true })}
            value={tab}
          >
            {SECTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.labelKey)}
              </option>
            ))}
          </select>
        </label>

        {/* Left settings sidebar */}
        <nav className="hidden w-48 shrink-0 flex-col gap-0.5 sm:flex">
          {SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => navigate({ search: { tab: item.value }, replace: true })}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                tab === item.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="inline-flex w-4 justify-center text-[13px]">{item.icon}</span>
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 w-full max-w-2xl flex-1">{tab === 'appearance' ? <AppearanceTab /> : <AccountTab />}</div>
      </div>
    </div>
  );
}
