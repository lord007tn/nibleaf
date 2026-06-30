import { Skeleton } from '@midad/design-system/components/ui/skeleton';
import { Activity, FileText, Globe2, Languages, Rocket, Users } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useAnalytics, useProjectMembers } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { SettingsSection } from './section';

interface UsageItem {
  icon: typeof FileText;
  labelKey: MessageKey;
  value: number | string;
}

const formatNumber = (value: number) => new Intl.NumberFormat().format(value);

export function UsageTab({ project }: { project: Project }) {
  const t = useT();
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics(project.id, '30d');
  const { data: members } = useProjectMembers(project.id);

  const items: UsageItem[] = [
    { icon: FileText, labelKey: 'settings.usage.pages', value: project._count?.pages ?? 0 },
    { icon: Rocket, labelKey: 'settings.usage.deployments', value: project._count?.deployments ?? 0 },
    { icon: Globe2, labelKey: 'settings.usage.customDomains', value: project._count?.domains ?? 0 },
    { icon: Languages, labelKey: 'settings.usage.languages', value: project.languages?.length ?? 0 },
    { icon: Users, labelKey: 'settings.usage.members', value: (members?.members.length ?? 0) + (members?.invitations.length ?? 0) },
    { icon: Activity, labelKey: 'settings.usage.pageviews30d', value: analyticsLoading ? '...' : formatNumber(analytics?.totalViews ?? 0) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('settings.usage.title')} description={t('settings.usage.description')}>
        <div className="grid grid-cols-2 gap-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div className="rounded-lg border border-border bg-background p-3.5" key={item.labelKey}>
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Icon className="size-4" />
                  <span>{t(item.labelKey)}</span>
                </div>
                <div className="mt-2 font-semibold text-2xl">{item.value}</div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.usage.traffic.title')} description={t('settings.usage.traffic.description')}>
        {analyticsLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {(analytics?.topPages ?? []).slice(0, 5).map((page) => (
              <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0" key={page.path}>
                <span className="truncate font-mono text-sm">{page.path || '/'}</span>
                <span className="text-muted-foreground text-sm">{t('settings.usage.views', { count: formatNumber(page.views) })}</span>
              </div>
            ))}
            {(analytics?.topPages ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t('settings.usage.traffic.empty')}</p> : null}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
