import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { Plug, Unplug } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { type ConnectedApp, type McpActivity, useConnectedApps, useRevokeConnectedApp } from '@/hooks/api';
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

export const formattedDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export const relativeMinutes = (value: string, locale: string) =>
  new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' }).format(
    -Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000)),
    'minute',
  );

// ─── Latest activity in plain words ─────────────────────────────────────────

const SUCCEEDED: Record<string, MessageKey> = {
  publish_changes: 'settings.mcpActivity.published',
  update_page: 'settings.mcpActivity.updatedPage',
  move_page: 'settings.mcpActivity.updatedPage',
  set_page_visibility: 'settings.mcpActivity.updatedPage',
  create_page_draft: 'settings.mcpActivity.createdDraft',
  translate_page: 'settings.mcpActivity.translatedPage',
  preview_publish: 'settings.mcpActivity.previewedPublish',
  search_pages: 'settings.mcpActivity.searchedPages',
  list_pages: 'settings.mcpActivity.readPages',
  get_page: 'settings.mcpActivity.readPages',
  pages: 'settings.mcpActivity.readPages',
  page: 'settings.mcpActivity.readPages',
  get_analytics_overview: 'settings.mcpActivity.readAnalytics',
  get_top_pages: 'settings.mcpActivity.readAnalytics',
  get_top_searches: 'settings.mcpActivity.readAnalytics',
  get_failed_searches: 'settings.mcpActivity.readAnalytics',
  get_page_feedback: 'settings.mcpActivity.readAnalytics',
  get_referrers: 'settings.mcpActivity.readAnalytics',
  get_capabilities: 'settings.mcpActivity.checkedConnection',
  capabilities: 'settings.mcpActivity.checkedConnection',
};

// The scope each write tool needs, which names what a blocked attempt tried to do.
const PUBLISH_TOOLS = new Set(['preview_publish', 'publish_changes']);
const PAGE_WRITE_TOOLS = new Set(['create_page_draft', 'update_page', 'move_page', 'translate_page', 'set_page_visibility']);

const BLOCKED: Record<'key' | 'app', Record<'publish' | 'pages' | 'other', MessageKey>> = {
  key: {
    publish: 'settings.mcpActivity.keyCantPublish',
    pages: 'settings.mcpActivity.keyCantEditPages',
    other: 'settings.mcpActivity.keyNotAllowed',
  },
  app: {
    publish: 'settings.mcpActivity.appCantPublish',
    pages: 'settings.mcpActivity.appCantEditPages',
    other: 'settings.mcpActivity.appNotAllowed',
  },
};

const REFUSED: Record<string, MessageKey> = {
  'mcp:revision_conflict': 'settings.mcpActivity.revisionConflict',
  'mcp:publish_in_progress': 'settings.mcpActivity.publishInProgress',
  'mcp:preview_stale': 'settings.mcpActivity.previewOutdated',
  'mcp:preview_expired': 'settings.mcpActivity.previewOutdated',
  'http:rate_limited': 'settings.mcpActivity.rateLimited',
  'auth:insufficient_role': 'settings.mcpActivity.roleBlocked',
};

export interface ActivitySummary {
  key: MessageKey;
  tool?: string;
  /** `attention` for blocked, refused or unfinished attempts: amber, never red. */
  tone: 'neutral' | 'attention';
}

/** One plain sentence for the newest audit event of a key (`subject: 'key'`)
 *  or a connected app. The raw tool name and code stay in Technical details. */
export function describeMcpActivity(activity: McpActivity, subject: 'key' | 'app'): ActivitySummary {
  const { operation, outcome, errorCode } = activity;
  if (outcome === 'replayed') return { key: 'settings.mcpActivity.replayed', tone: 'neutral' };
  if (outcome !== 'failed') {
    const key = SUCCEEDED[operation];
    return key ? { key, tone: 'neutral' } : { key: 'settings.mcpActivity.used', tool: operation.replace(/[_-]+/g, ' ').trim(), tone: 'neutral' };
  }
  if (errorCode === 'mcp:scope_required' || errorCode === 'auth:insufficient_scope') {
    const verb = PUBLISH_TOOLS.has(operation) ? 'publish' : PAGE_WRITE_TOOLS.has(operation) ? 'pages' : 'other';
    return { key: BLOCKED[subject][verb], tone: 'attention' };
  }
  return { key: (errorCode && REFUSED[errorCode]) || 'settings.mcpActivity.didntFinish', tone: 'attention' };
}

/** The latest activity as one sentence plus when it happened. */
export function McpActivityLine({ activity, subject }: { activity: McpActivity; subject: 'key' | 'app' }) {
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
export function TechnicalDetails({ activity, children, scopes }: { activity: McpActivity | null; children?: ReactNode; scopes: string[] }) {
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

/** First-load placeholder shaped like key / connected-app rows: name and
 *  permission badge, one sentence, the last-used/expiry line, the Technical
 *  details summary and the row's buttons. */
export function CredentialRowsSkeleton({ actions = 1, label, rows = 2 }: { actions?: number; label: string; rows?: number }) {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden className="flex flex-col divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
          <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={row}>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-3/5" />
              <div className="grid gap-1 sm:grid-cols-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex gap-2 self-start sm:self-center">
              {Array.from({ length: actions }, (_, action) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder buttons never reorder
                <Skeleton className="h-9 w-24" key={action} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** AI apps connected to the project by signing in (OAuth). Admins see and can
 *  disconnect everyone's; members see their own, like personal keys. */
export function ConnectedApps({ projectId, role = '' }: { projectId: string; role?: string }) {
  const { locale, t } = useLocale();
  const { data, isError, isPending } = useConnectedApps(projectId);
  const revoke = useRevokeConnectedApp(projectId);
  const [candidate, setCandidate] = useState<ConnectedApp | null>(null);
  const apps = data ?? [];
  const admin = canAdminister(role);

  const confirm = () => {
    if (!candidate) return;
    // Failures are toasted in plain words by the mutation (meta.errorMessage)
    // and the app comes back to the list; the dialog stays open to retry.
    revoke.mutate(candidate.id, {
      onSuccess: () => {
        setCandidate(null);
        toast.success(t('settings.connectedApps.disconnectedToast'));
      },
    });
  };

  return (
    <SettingsSection
      description={admin ? t('settings.connectedApps.description') : t('settings.connectedApps.descriptionMember')}
      title={t('settings.connectedApps.title')}
    >
      <div>
        {isError ? (
          <p className="py-3 text-center text-destructive text-sm" role="alert">
            {t('settings.connectedApps.loadError')}
          </p>
        ) : isPending ? (
          <CredentialRowsSkeleton label={t('settings.connectedApps.loading')} />
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
                  <p className="mt-1 text-muted-foreground text-sm">{t(`settings.apiKeys.${app.preset}Description`)}</p>
                  <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.lastUsed')}</dt>
                      <dd className="font-medium text-foreground">
                        {app.lastUsedAt ? relativeMinutes(app.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t('settings.connectedApps.connectedAt')}</dt>
                      <dd className="text-foreground">{formattedDate(app.createdAt, locale)}</dd>
                    </div>
                    {admin ? (
                      <div className="flex gap-1.5">
                        <dt>{t('settings.connectedApps.connectedBy')}:</dt>
                        <dd>
                          <bdi className="text-foreground">{app.connectedBy.name.trim() || app.connectedBy.email}</bdi>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {app.lastActivity ? <McpActivityLine activity={app.lastActivity} subject="app" /> : null}
                  <TechnicalDetails activity={app.lastActivity} scopes={app.scopes}>
                    {app.uri ? (
                      <div>
                        <dt>{t('settings.connectedApps.website')}</dt>
                        <dd className="mt-1 break-all text-foreground" dir="ltr">
                          {app.uri}
                        </dd>
                      </div>
                    ) : null}
                  </TechnicalDetails>
                </div>
                <Button className="h-9 self-start sm:self-center" onClick={() => setCandidate(app)} type="button" variant="destructive">
                  <Unplug aria-hidden />
                  {t('settings.connectedApps.disconnect')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog onOpenChange={(open) => (open || revoke.isPending ? undefined : setCandidate(null))} open={Boolean(candidate)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.connectedApps.confirmTitle', { name: candidate?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.connectedApps.confirmDescription', { name: candidate?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('settings.apiKeys.cancel')}</AlertDialogCancel>
            <AlertDialogAction loading={revoke.isPending} onClick={confirm}>
              <Unplug aria-hidden />
              {t('settings.connectedApps.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
