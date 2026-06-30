import { Info } from 'lucide-react';
import { Badge } from '@midad/design-system/components/ui/badge';
import { Button } from '@midad/design-system/components/ui/button';
import { useWorkspaceSettings } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

export function BillingTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const { data } = useWorkspaceSettings(projectId);
  const plan = data?.plan ?? 'Free';

  return (
    <div className="flex flex-col gap-6">
      {/* Honest framing: self-hosted Midad is free + unlimited; metered/hosted billing
          isn't wired up, so don't fake usage limits or working payment actions. */}
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Info className="size-5" />
        </span>
        <div className="leading-snug">
          <div className="font-medium text-sm">{t('settings.billing.comingSoon.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('settings.billing.comingSoon.description')}</p>
        </div>
      </div>

      <SettingsSection title={t('settings.billing.plan.title')} action={<Badge variant="secondary">{t('settings.billing.plan.current')}</Badge>}>
        <div className="flex items-start justify-between gap-4">
          <div className="leading-snug">
            <div className="font-semibold text-lg">{t('settings.billing.plan.name', { plan })}</div>
            <p className="mt-1 text-muted-foreground text-sm">{t('settings.billing.plan.selfHostFree')}</p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 border-border border-t pt-5">
          <Button disabled>{t('settings.billing.upgradePlan')}</Button>
          <Button variant="outline" disabled>
            {t('settings.billing.cancelSubscription')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}


