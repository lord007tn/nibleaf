import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AccountTab } from '@/components/settings/account-tab';
import { AppearanceTab } from '@/components/settings/appearance-tab';
import { BillingTab } from '@/components/settings/billing-tab';
import { GitTab } from '@/components/settings/git-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { MembersTab } from '@/components/settings/members-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { WorkspaceTab } from '@/components/settings/workspace-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

const TABS = [
  { value: 'account', labelKey: 'settings.tab.account' },
  { value: 'workspace', labelKey: 'settings.tab.workspace' },
  { value: 'members', labelKey: 'settings.tab.members' },
  { value: 'integrations', labelKey: 'settings.tab.integrations' },
  { value: 'notifications', labelKey: 'settings.tab.notifications' },
  { value: 'git', labelKey: 'settings.tab.git' },
  { value: 'billing', labelKey: 'settings.tab.billing' },
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
  const workspace = useActiveWorkspace();

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
        <TabsContent value="workspace">
          <WorkspaceTab workspace={workspace} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="git">
          <GitTab />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
