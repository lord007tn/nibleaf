import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { SettingsSection } from './section';

interface NotifItem {
  id: string;
  label: string;
  description: string;
}

const GROUPS: Array<{ title: string; items: NotifItem[] }> = [
  {
    title: 'Workspace',
    items: [
      { id: 'workspace_weekly', label: 'Weekly summary', description: 'A digest of activity across your workspace.' },
      { id: 'workspace_plan', label: 'Plan & billing', description: 'Renewals, receipts, and plan changes.' },
    ],
  },
  {
    title: 'Projects',
    items: [
      { id: 'project_new', label: 'New projects', description: 'When a project is created in the workspace.' },
      { id: 'project_deploy', label: 'Deployment completed', description: 'When a site finishes publishing.' },
      { id: 'project_deploy_failed', label: 'Deployment failed', description: 'When a publish run errors out.' },
    ],
  },
  {
    title: 'Members',
    items: [
      { id: 'member_invited', label: 'Member invited', description: 'When someone is invited to the workspace.' },
      { id: 'member_joined', label: 'Member joined', description: 'When an invite is accepted.' },
    ],
  },
  {
    title: 'Security',
    items: [
      { id: 'security_login', label: 'Login from new device', description: 'When a new sign-in is detected.' },
      { id: 'security_password', label: 'Password changed', description: 'When your password is updated.' },
    ],
  },
];

export function NotificationsTab() {
  const { data } = useWorkspaceSettings();
  const update = useUpdateWorkspaceSettings();
  const { data: session } = useSession();
  const stored = (data?.notifications ?? {}) as Record<string, boolean>;

  const isOn = (id: string) => stored[id] ?? true;

  const toggle = (id: string) => {
    const next = { ...stored, [id]: !isOn(id) };
    update.mutate(
      { notifications: next },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update notifications'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Choose which emails Plume sends to <span className="font-medium text-foreground">{session?.user?.email ?? 'you'}</span>.
      </p>
      {GROUPS.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          <div className="-mt-2 flex flex-col divide-y divide-border">
            {group.items.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="font-medium text-sm">{item.label}</div>
                  <p className="mt-0.5 text-muted-foreground text-sm">{item.description}</p>
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
