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

      <div className="flex gap-8">
        {/* Left settings sidebar */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5">
          {SECTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => navigate({ search: { tab: item.value }, replace: true })}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                tab === item.value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="inline-flex w-4 justify-center text-[13px]">{item.icon}</span>
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 max-w-2xl flex-1">{tab === 'appearance' ? <AppearanceTab /> : <AccountTab />}</div>
      </div>
    </div>
  );
}
