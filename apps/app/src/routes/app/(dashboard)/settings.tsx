import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AccountTab } from '@/components/settings/account-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

// Global account settings only — everything site-specific (members, billing,
// integrations, notifications, git) now lives per-site under each site's Settings.
const TABS = [
  { value: 'account', labelKey: 'settings.tab.account' },
  { value: 'appearance', labelKey: 'settings.tab.appearance' },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey }>;

type TabValue = (typeof TABS)[number]['value'];

const isTabValue = (value: unknown): value is TabValue => TABS.some((tab) => tab.value === value);

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
    <div className="flex max-w-3xl flex-col gap-8">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('settings.subtitle')}</p>
      </div>

      <Tabs onValueChange={(value) => navigate({ search: { tab: (value ?? 'account') as TabValue }, replace: true })} value={tab}>
        <TabsList className="h-auto w-full flex-wrap justify-start" variant="line">
          {TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {t(item.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
