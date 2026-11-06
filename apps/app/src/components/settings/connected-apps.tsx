import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { Plug, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type ConnectedApp, useConnectedApps, useRevokeConnectedApp } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './api-key-alert-dialog';
import { SettingsSection } from './section';

const formattedDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

const relativeMinutes = (value: string, locale: string) =>
  new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' }).format(
    -Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000)),
    'minute',
  );

/** AI apps connected to the project by signing in (OAuth). Admins see and can
 *  disconnect everyone's; members see their own, like personal keys. */
export function ConnectedApps({ projectId, role = '' }: { projectId: string; role?: string }) {
  const { locale, t } = useLocale();
  const { data, isError, isLoading } = useConnectedApps(projectId);
  const revoke = useRevokeConnectedApp(projectId, t('settings.connectedApps.disconnectError'));
  const [candidate, setCandidate] = useState<ConnectedApp | null>(null);
  const apps = data ?? [];
  const admin = canAdminister(role);

  const confirm = () => {
    if (!candidate) return;
    revoke.mutate(candidate.id, {
      onSuccess: () => {
        setCandidate(null);
        toast.success(t('settings.connectedApps.disconnectedToast'));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.connectedApps.disconnectError')),
    });
  };

  return (
    <SettingsSection
      description={admin ? t('settings.connectedApps.description') : t('settings.connectedApps.descriptionMember')}
      title={t('settings.connectedApps.title')}
    >
      {isLoading ? null : isError ? (
        <p className="py-3 text-center text-destructive text-sm" role="alert">
          {t('settings.connectedApps.loadError')}
        </p>
      ) : apps.length === 0 ? (
        <p className="py-3 text-center text-muted-foreground text-sm">{t('settings.connectedApps.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {apps.map((app) => (
            <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={app.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Plug aria-hidden className="size-4 shrink-0 text-primary" />
                  <bdi className="min-w-0 truncate font-medium text-sm">{app.name}</bdi>
                  <Badge variant="outline">{t(`settings.apiKeys.${app.preset}`)}</Badge>
                </div>
                {admin ? (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t('settings.connectedApps.connectedBy')}:{' '}
                    <bdi className="text-foreground">{app.connectedBy.name.trim() || app.connectedBy.email}</bdi>
                  </p>
                ) : null}
                <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt>{t('settings.connectedApps.connectedAt')}</dt>
                    <dd className="text-foreground">{formattedDate(app.createdAt, locale)}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt>{t('settings.apiKeys.lastUsed')}</dt>
                    <dd className="text-foreground">{app.lastUsedAt ? relativeMinutes(app.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}</dd>
                  </div>
                </dl>
                {app.lastActivity ? (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t('settings.apiKeys.lastActivity')}:{' '}
                    <code className="text-foreground" dir="ltr">
                      {app.lastActivity.operation}
                    </code>
                    {' · '}
                    <span className={app.lastActivity.outcome === 'failed' ? 'text-destructive' : 'text-foreground'}>
                      {app.lastActivity.outcome === 'failed'
                        ? t('settings.apiKeys.outcomeFailed')
                        : app.lastActivity.outcome === 'replayed'
                          ? t('settings.apiKeys.outcomeReplayed')
                          : t('settings.apiKeys.outcomeSucceeded')}
                    </span>
                  </p>
                ) : null}
              </div>
              <Button
                className="h-9 self-start sm:self-center"
                disabled={revoke.isPending}
                onClick={() => setCandidate(app)}
                type="button"
                variant="destructive"
              >
                <Unplug aria-hidden />
                {t('settings.connectedApps.disconnect')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog onOpenChange={(open) => (open ? undefined : setCandidate(null))} open={Boolean(candidate)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.connectedApps.confirmTitle', { name: candidate?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.connectedApps.confirmDescription', { name: candidate?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('settings.apiKeys.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={revoke.isPending} onClick={confirm}>
              <Unplug aria-hidden />
              {t('settings.connectedApps.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
