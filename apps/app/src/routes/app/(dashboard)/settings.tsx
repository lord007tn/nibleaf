import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Bell, type LucideIcon, Palette, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { ConfigDirtyProvider, useSettingsDirtyGuard } from '@/components/project-settings/shared';
import { DeleteAccountSection, PersonalNotificationsSection, SessionsSection, SignInMethodsSection } from '@/components/settings/account-security';
import { AccountTab } from '@/components/settings/account-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { navFromIds } from '@/lib/section-nav';

// Tab ids alone: `validateSearch` is in the router's eager chunk, which published
// docs pages load, so it must not read SECTIONS and pull in its icons.
const TAB_VALUES = ['account', 'appearance', 'notifications'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const isTabValue = (value: unknown): value is TabValue => (TAB_VALUES as readonly unknown[]).includes(value);

// Personal account settings only (§5.4.4): profile, sign-in, devices, appearance,
// personal email notifications and account deletion. Organization and website
// settings live in their own shells.
// Keyed by TAB_VALUES, so a tab added to one list and not the other fails typecheck.
const SECTIONS = navFromIds<TabValue, { labelKey: MessageKey; icon: LucideIcon }>(TAB_VALUES, {
  account: { labelKey: 'settings.tab.account', icon: UserRound },
  appearance: { labelKey: 'settings.tab.appearance', icon: Palette },
  notifications: { labelKey: 'account.notifications.title', icon: Bell },
});

export const Route = createFileRoute('/app/(dashboard)/settings')({
  component: WorkspaceSettingsPage,
  validateSearch: (search: Record<string, unknown>): { tab: TabValue } => ({
    tab: isTabValue(search.tab) ? search.tab : 'account',
  }),
});

function WorkspaceSettingsPage() {
  const reportDirty = useSettingsDirtyGuard();
  const t = useT();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const sectionItems = SECTIONS.map((item) => ({ value: item.id, label: t(item.labelKey) }));

  return (
    <ConfigDirtyProvider report={reportDirty}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
        <PageHeader description={t('account.subtitle')} title={t('account.title')} />

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
                    <SelectItem key={item.id} value={item.id}>
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      {t(item.labelKey)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Left settings sidebar */}
          <nav aria-label={t('settings.title')} className="hidden w-48 shrink-0 flex-col gap-0.5 sm:flex">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  aria-current={tab === item.id ? 'page' : undefined}
                  key={item.id}
                  type="button"
                  onClick={() => navigate({ search: { tab: item.id }, replace: true })}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                    tab === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {t(item.labelKey)}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 w-full flex-1">
            {tab === 'appearance' ? (
              <AppearanceTab />
            ) : tab === 'notifications' ? (
              <PersonalNotificationsSection />
            ) : (
              <div className="flex flex-col gap-6">
                <AccountTab />
                <SignInMethodsSection />
                <SessionsSection />
                <DeleteAccountSection />
              </div>
            )}
          </div>
        </div>
      </div>
    </ConfigDirtyProvider>
  );
}
