import { Badge } from '@midad/design-system/components/ui/badge';
import { Button } from '@midad/design-system/components/ui/button';
import { Download, FileArchive, LockKeyhole } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

const EXPORTS = [
  { key: 'pdf', icon: FileArchive },
  { key: 'html', icon: Download },
] as const;

export function ExportsTab() {
  const t = useT();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground">
          <LockKeyhole className="size-5" />
        </span>
        <div className="leading-snug">
          <div className="font-medium text-sm">{t('settings.exports.enterprise.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('settings.exports.enterprise.description')}</p>
        </div>
      </div>

      <SettingsSection title={t('settings.exports.title')} description={t('settings.exports.description')}>
        <div className="flex flex-col divide-y divide-border">
          {EXPORTS.map((item) => {
            const Icon = item.icon;
            return (
              <div className="flex items-center gap-4 py-3 first:pt-0 last:pb-0" key={item.key}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="font-medium text-sm">{t(`settings.exports.${item.key}.title`)}</div>
                  <p className="mt-0.5 text-muted-foreground text-sm">{t(`settings.exports.${item.key}.description`)}</p>
                </div>
                <Badge variant="secondary">{t('settings.exports.enterprise.badge')}</Badge>
              </div>
            );
          })}
        </div>
        <div className="mt-5 border-border border-t pt-5">
          <Button disabled variant="outline">
            {t('settings.exports.request')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
