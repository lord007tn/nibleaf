import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { toast } from 'sonner';
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { SettingsSection } from './section';

interface NotifItem {
  id: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}

const GROUPS: Array<{ titleKey: MessageKey; items: NotifItem[] }> = [
  {
    titleKey: 'settings.notifications.group.workspace',
    items: [
      {
        id: 'workspace_weekly',
        labelKey: 'settings.notifications.workspaceWeekly.label',
        descriptionKey: 'settings.notifications.workspaceWeekly.description',
      },
      {
        id: 'workspace_plan',
        labelKey: 'settings.notifications.workspacePlan.label',
        descriptionKey: 'settings.notifications.workspacePlan.description',
      },
    ],
  },
  {
    titleKey: 'settings.notifications.group.projects',
    items: [
      {
        id: 'project_new',
        labelKey: 'settings.notifications.projectNew.label',
        descriptionKey: 'settings.notifications.projectNew.description',
      },
      {
        id: 'project_deploy',
        labelKey: 'settings.notifications.projectDeploy.label',
        descriptionKey: 'settings.notifications.projectDeploy.description',
      },
      {
        id: 'project_deploy_failed',
        labelKey: 'settings.notifications.projectDeployFailed.label',
        descriptionKey: 'settings.notifications.projectDeployFailed.description',
      },
    ],
  },
  {
    titleKey: 'settings.notifications.group.members',
    items: [
      {
        id: 'member_invited',
        labelKey: 'settings.notifications.memberInvited.label',
        descriptionKey: 'settings.notifications.memberInvited.description',
      },
      {
        id: 'member_joined',
        labelKey: 'settings.notifications.memberJoined.label',
        descriptionKey: 'settings.notifications.memberJoined.description',
      },
    ],
  },
  {
    titleKey: 'settings.notifications.group.security',
    items: [
      {
        id: 'security_login',
        labelKey: 'settings.notifications.securityLogin.label',
        descriptionKey: 'settings.notifications.securityLogin.description',
      },
      {
        id: 'security_password',
        labelKey: 'settings.notifications.securityPassword.label',
        descriptionKey: 'settings.notifications.securityPassword.description',
      },
    ],
  },
];

export function NotificationsTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const { data } = useWorkspaceSettings(projectId);
  const update = useUpdateWorkspaceSettings(projectId);
  const { data: session } = useSession();
  const stored = (data?.notifications ?? {}) as Record<string, boolean>;

  const isOn = (id: string) => stored[id] ?? true;

  const toggle = (id: string) => {
    const next = { ...stored, [id]: !isOn(id) };
    update.mutate(
      { notifications: next },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.notifications.toast.updateError')),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        {t('settings.notifications.introBefore')}{' '}
        <span className="font-medium text-foreground">{session?.user?.email ?? t('settings.notifications.youFallback')}</span>
        {t('settings.notifications.introAfter')}
      </p>
      {GROUPS.map((group) => (
        <SettingsSection key={group.titleKey} title={t(group.titleKey)}>
          <div className="-mt-2 flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="font-medium text-sm">{t(item.labelKey)}</div>
                  <p className="mt-0.5 text-muted-foreground text-sm">{t(item.descriptionKey)}</p>
                </div>
                <Switch checked={isOn(item.id)} disabled={update.isPending} onCheckedChange={() => toggle(item.id)} />
              </div>
            ))}
          </div>
        </SettingsSection>
      ))}
    </div>
  );
}
