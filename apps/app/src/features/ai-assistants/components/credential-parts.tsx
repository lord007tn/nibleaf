import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale } from '@nibleaf/i18n/react';
import type { ReactNode } from 'react';
import { localeTag } from '@/lib/format';
import { describeMcpActivity, type McpActivityLike } from '../model/activity';

export const formattedDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago": the largest unit
 *  that fits, so a key used this morning doesn't read "222 minutes ago". */
export const relativeMinutes = (value: string, locale: string) => {
  const format = new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' });
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 60) return format.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return format.format(-days, 'day');
  return format.format(-Math.floor(days / 30), 'month');
};

/** The latest activity as one sentence plus when it happened. */
export function McpActivityLine({ activity, subject }: { activity: McpActivityLike; subject: 'key' | 'app' }) {
  const { locale, t } = useLocale();
  const summary = describeMcpActivity(activity, subject);
  return (
    <p className="mt-1 text-muted-foreground text-xs" data-tone={summary.tone}>
      {t('settings.apiKeys.lastActivity')}:{' '}
      <span className={summary.tone === 'attention' ? 'text-warning' : 'text-foreground'}>
        {summary.tool ? t(summary.key, { tool: summary.tool }) : t(summary.key)}
      </span>
      {' · '}
      <bdi>{relativeMinutes(activity.at, locale)}</bdi>
    </p>
  );
}

/** Collapsed-by-default disclosure with the raw permissions, the key's last
 *  four and the raw audit event, for people who need them. */
export function TechnicalDetails({ activity, children, scopes }: { activity: McpActivityLike | null; children?: ReactNode; scopes: string[] }) {
  const { locale, t } = useLocale();
  return (
    <details className="group mt-2 text-xs">
      <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">{t('settings.apiKeys.technicalDetails')}</summary>
      <dl className="mt-2 flex flex-col gap-2 text-muted-foreground">
        {children}
        <div>
          <dt>{t('settings.apiKeys.permissions')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {scopes.map((scope) => (
              <Badge className="font-mono" dir="ltr" key={scope} variant="outline">
                {scope}
              </Badge>
            ))}
          </dd>
        </div>
        {activity ? (
          <div>
            <dt>{t('settings.apiKeys.lastActivity')}</dt>
            <dd className="mt-1 text-foreground">
              <code dir="ltr">{activity.operation}</code>
              {' · '}
              {activity.outcome === 'failed'
                ? t('settings.apiKeys.outcomeFailed')
                : activity.outcome === 'replayed'
                  ? t('settings.apiKeys.outcomeReplayed')
                  : t('settings.apiKeys.outcomeSucceeded')}
              {activity.errorCode ? (
                <>
                  {' · '}
                  <code dir="ltr">{activity.errorCode}</code>
                </>
              ) : null}
              {' · '}
              <bdi>{formattedDate(activity.at, locale)}</bdi>
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

/** A background refresh failed but the last loaded rows are still on screen:
 *  keep them, say they may be out of date and offer a retry. */
export function RefreshFailedNotice({ message, onRetry, retrying }: { message?: string; onRetry: () => void; retrying: boolean }) {
  const { t } = useLocale();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm"
      role="status"
    >
      <span className="min-w-0 text-muted-foreground">{message ?? t('settings.credentials.refreshFailed')}</span>
      <Button loading={retrying} onClick={onRetry} size="sm" type="button" variant="outline">
        {t('error.tryAgain')}
      </Button>
    </div>
  );
}
