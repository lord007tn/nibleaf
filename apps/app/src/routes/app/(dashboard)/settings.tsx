import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type LucideIcon, Palette, UserRound } from 'lucide-react';
import { AccountTab } from '@/components/settings/account-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';

// Global account settings only — everything site-specific (members, billing,
// integrations, notifications, git) now lives per-site under each site's Settings.
const SECTIONS = [
  { value: 'account', labelKey: 'settings.tab.account', icon: UserRound },
  { value: 'appearance', labelKey: 'settings.tab.appearance', icon: Palette },
] as const satisfies ReadonlyArray<{ value: TabValue; labelKey: MessageKey; icon: LucideIcon }>;

type TabValue = 'account' | 'appearance';

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
  const sectionItems = SECTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('settings.subtitle')}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="sm:hidden">
          <Label className="sr-only" htmlFor="settings-section">
            {t('settings.title')}
          </Label>
          <Select
            items={sectionItems}
            onValueChange={(value) => {
              if (value) navigate({ search: { tab: value }, replace: true });
            }}
            value={tab}
          >
            <SelectTrigger className="w-full" id="settings-section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((item) => {
                const Icon = item.icon;
                return (
                  <SelectItem key={item.value} value={item.value}>
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {t(item.labelKey)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Left settings sidebar */}
        <nav className="hidden w-48 shrink-0 flex-col gap-0.5 sm:flex">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => navigate({ search: { tab: item.value }, replace: true })}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                  tab === item.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 w-full flex-1">{tab === 'appearance' ? <AppearanceTab /> : <AccountTab />}</div>
      </div>
    </div>
  );
}
