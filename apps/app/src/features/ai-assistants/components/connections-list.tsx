import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { MCP_SCOPES, type McpScope, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { KeyRound, Plug, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { type ApiKey, type ConnectedApp, useRevokeApiKey, useRevokeConnectedApp, useRotateApiKey } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { type ConnectionRow, connectionRows } from '../model/connections';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';
import { CredentialRowsSkeleton, formattedDate, McpActivityLine, RefreshFailedNotice, relativeMinutes, TechnicalDetails } from './credential-parts';
import type { IssuedKey } from './key-dialog';

type Row = ConnectionRow<ApiKey, ConnectedApp>;
const EVERYONE = 'everyone';
const issuable = new Set<string>(MCP_SCOPES);
const isRetainedScope = (scope: string): scope is Exclude<McpScope, 'mcp:connect'> => scope !== 'mcp:connect' && issuable.has(scope);

/** "in 3 days": the largest unit that fits, in the reader's language, with no plural rules to translate. */
const relativeFuture = (value: string, locale: string) => {
  const days = Math.max(1, Math.ceil((Date.parse(value) - Date.now()) / 86_400_000));
  return new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' }).format(days, 'day');
};

/** One of the list's two sources (personal keys, signed-in apps), as its query reports it. */
export interface ConnectionSource<T> {
  data: T[] | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

/**
 * Everything that can use this website on someone's behalf, in one list:
 * apps that signed in and personal keys. Admins see everyone's and can filter
 * by person; others see their own. Inactive keys stay reachable (collapsed),
 * so they can still be rotated or removed. Each source stands on its own: if
 * one fails to load, the other's rows and actions stay, with a notice and a
 * retry for the one that failed.
 */
export function ConnectionsList({
  projectId,
  role,
  manageAll,
  enabled,
  keys,
  apps,
  onRotated,
}: {
  projectId: string;
  role: string;
  manageAll: boolean;
  /** MCP is on: rotation needs it; removing never does. */
  enabled: boolean;
  keys: ConnectionSource<ApiKey>;
  apps: ConnectionSource<ConnectedApp>;
  onRotated: (key: IssuedKey) => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const rotate = useRotateApiKey(projectId);
  const revokeKey = useRevokeApiKey(projectId);
  const disconnect = useRevokeConnectedApp(projectId);
  const [person, setPerson] = useState(EVERYONE);
  const [candidate, setCandidate] = useState<Row | null>(null);
  const allowedScopes = mcpScopesForRole(role);

  const unavailable = (source: ConnectionSource<unknown>) => !source.data && source.isError;
  if (unavailable(keys) && unavailable(apps))
    return (
      <QueryErrorState
        description={t('settings.aiAssistants.connectionsLoadError')}
        onRetry={() => {
          void keys.refetch();
          void apps.refetch();
        }}
        retrying={keys.isFetching || apps.isFetching}
      />
    );
  const loading = (source: ConnectionSource<unknown>) => !source.data && !source.isError;
  if (loading(keys) && loading(apps)) return <CredentialRowsSkeleton actions={2} label={t('settings.aiAssistants.connectionsLoading')} />;

  const { live, inactive, people } = connectionRows(keys.data ?? [], apps.data ?? [], {
    now: Date.now(),
    personId: person === EVERYONE ? null : person,
  });
  const sourceNotices = (
    [
      [keys, 'settings.aiAssistants.keysLoadError'],
      [apps, 'settings.aiAssistants.appsLoadError'],
    ] as const
  ).map(([source, message]) =>
    source.isError ? (
      <RefreshFailedNotice
        key={message}
        message={source.data ? undefined : t(message)}
        onRetry={() => void source.refetch()}
        retrying={source.isFetching}
      />
    ) : loading(source) ? (
      <CredentialRowsSkeleton key={message} label={t('settings.aiAssistants.connectionsLoading')} rows={1} />
    ) : null,
  );
  const personOptions = [
    { value: EVERYONE, label: t('settings.aiAssistants.everyone') },
    ...people.map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  const rotateKey = async (key: ApiKey) => {
    const approved = await confirm({
      title: t('settings.apiKeys.rotateConfirm.title'),
      description: t(
        !key.expiresAt
          ? 'settings.apiKeys.rotateConfirm.legacyDescription'
          : Date.parse(key.expiresAt) > Date.now()
            ? 'settings.apiKeys.rotateConfirm.description'
            : 'settings.apiKeys.rotateConfirm.expiredDescription',
      ),
      confirmLabel: t('settings.apiKeys.rotate'),
      destructive: true,
    });
    if (!approved) return;
    const retainedScopes = key.scopes.filter(isRetainedScope).filter((scope) => allowedScopes.includes(scope));
    rotate.mutate(
      // The new secret goes straight to the page's state, never into the mutation cache.
      { id: key.id, body: { scopes: ['mcp:connect', ...retainedScopes], expiresInDays: 90 }, deliver: onRotated },
      { onSuccess: () => toast.success(t('settings.apiKeys.rotatedToast')) },
    );
  };

  // Failures are toasted in plain words by the mutations; the dialog stays open to retry.
  const confirmRemove = () => {
    if (!candidate) return;
    const done = () => setCandidate(null);
    if (candidate.kind === 'key')
      revokeKey.mutate(candidate.key.id, {
        onSuccess: () => {
          done();
          toast.success(t('settings.apiKeys.revokedToast'));
        },
      });
    else
      disconnect.mutate(candidate.app.id, {
        onSuccess: () => {
          done();
          toast.success(t('settings.connectedApps.disconnectedToast'));
        },
      });
  };
  const removing = revokeKey.isPending || disconnect.isPending;

  const renderRow = (row: Row) => (
    <ConnectionItem
      enabled={enabled}
      key={row.id}
      manageAll={manageAll}
      onRemove={() => setCandidate(row)}
      onRotate={(key) => void rotateKey(key)}
      rotateBusy={rotate.isPending ? (rotate.variables?.id ?? null) : null}
      row={row}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sourceNotices}
      {manageAll && people.length > 1 ? (
        <Select items={personOptions} onValueChange={(value) => setPerson(typeof value === 'string' ? value : EVERYONE)} value={person}>
          <SelectTrigger aria-label={t('settings.aiAssistants.filterLabel')} className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {personOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {live.length === 0 ? (
        <p className="py-3 text-center text-muted-foreground text-sm">
          {enabled ? t('settings.aiAssistants.empty') : t('settings.aiAssistants.emptyOff')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">{live.map(renderRow)}</ul>
      )}
      {inactive.length > 0 ? (
        <details className="rounded-lg border border-border px-3 py-2" data-slot="inactive-connections">
          <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm hover:text-foreground">
            {t('settings.aiAssistants.inactive')}
            <Badge variant="secondary">{inactive.length}</Badge>
          </summary>
          <ul className="mt-3 flex flex-col divide-y divide-border">{inactive.map(renderRow)}</ul>
        </details>
      ) : null}

      <AlertDialog onOpenChange={(open) => (open || removing ? undefined : setCandidate(null))} open={Boolean(candidate)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {candidate?.kind === 'app'
                ? t('settings.connectedApps.confirmTitle', { name: candidate.app.name })
                : t('settings.apiKeys.revokeConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {candidate?.kind === 'app'
                ? t('settings.connectedApps.confirmDescription', { name: candidate.app.name })
                : t('settings.apiKeys.revokeConfirm.description', { name: candidate?.kind === 'key' ? candidate.key.name : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t('settings.apiKeys.cancel')}</AlertDialogCancel>
            <AlertDialogAction loading={removing} onClick={confirmRemove}>
              {candidate?.kind === 'app' ? <Unplug aria-hidden /> : <Trash2 aria-hidden />}
              {candidate?.kind === 'app' ? t('settings.connectedApps.disconnect') : t('settings.apiKeys.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectionItem({
  row,
  manageAll,
  enabled,
  rotateBusy,
  onRotate,
  onRemove,
}: {
  row: Row;
  manageAll: boolean;
  enabled: boolean;
  rotateBusy: string | null;
  onRotate: (key: ApiKey) => void;
  onRemove: () => void;
}) {
  const { locale, t } = useLocale();
  const item = row.kind === 'key' ? row.key : row.app;
  const owner = row.kind === 'key' ? row.key.createdBy : row.app.connectedBy;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {row.kind === 'app' ? (
            <Plug aria-hidden className="size-4 shrink-0 text-primary" />
          ) : (
            <KeyRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )}
          <bdi className="min-w-0 truncate font-medium text-sm">{item.name}</bdi>
          <Badge variant="secondary">{row.kind === 'app' ? t('settings.aiAssistants.signedIn') : t('settings.aiAssistants.personalKey')}</Badge>
          <Badge variant="outline">{t(`settings.apiKeys.${item.preset}`)}</Badge>
          {row.kind === 'key' && row.status === 'expiringSoon' && row.key.expiresAt ? (
            <Badge className="border-warning/40 text-warning" variant="outline">
              {t('settings.aiAssistants.expiresSoon', { when: relativeFuture(row.key.expiresAt, locale) })}
            </Badge>
          ) : null}
          {row.kind === 'key' && row.status === 'expired' ? <Badge variant="destructive">{t('settings.apiKeys.expired')}</Badge> : null}
          {row.kind === 'key' && row.status === 'revoked' ? <Badge variant="destructive">{t('settings.apiKeys.revoked')}</Badge> : null}
          {row.kind === 'key' && row.status === 'rotationRequired' ? (
            <Badge variant="outline">{row.key.legacy ? t('settings.apiKeys.legacy') : t('settings.apiKeys.rotationRequired')}</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-muted-foreground text-sm">
          {item.preset === 'custom' ? t('settings.apiKeys.customDescription') : t(`settings.apiKeys.${item.preset}Description`)}
        </p>
        <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
          <div className="flex gap-1.5">
            <dt>{t('settings.apiKeys.lastUsed')}</dt>
            <dd className="font-medium text-foreground">
              {item.lastUsedAt ? relativeMinutes(item.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}
            </dd>
          </div>
          {row.kind === 'key' ? (
            <div className="flex gap-1.5">
              <dt>{t('settings.apiKeys.expires')}</dt>
              <dd className="text-foreground">{row.key.expiresAt ? formattedDate(row.key.expiresAt, locale) : t('settings.apiKeys.noExpiry')}</dd>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <dt>{t('settings.connectedApps.connectedAt')}</dt>
              <dd className="text-foreground">{formattedDate(row.app.createdAt, locale)}</dd>
            </div>
          )}
          {manageAll && owner ? (
            <div className="flex gap-1.5">
              <dt>{row.kind === 'key' ? t('settings.apiKeys.createdBy') : t('settings.connectedApps.connectedBy')}:</dt>
              <dd>
                <bdi className="text-foreground">{owner.name.trim() || owner.email}</bdi>
              </dd>
            </div>
          ) : null}
        </dl>
        {item.lastActivity ? <McpActivityLine activity={item.lastActivity} subject={row.kind} /> : null}
        <TechnicalDetails activity={item.lastActivity} scopes={item.scopes}>
          {row.kind === 'key' ? (
            <>
              <div>
                <dt>{t('settings.apiKeys.keyEnding')}</dt>
                <dd className="mt-1 text-foreground">
                  <code dir="ltr">{row.key.lastFour}</code>
                </dd>
              </div>
              <div>
                <dt>{t('settings.apiKeys.createdAt')}</dt>
                <dd className="mt-1 text-foreground">{formattedDate(row.key.createdAt, locale)}</dd>
              </div>
            </>
          ) : row.app.uri ? (
            <div>
              <dt>{t('settings.connectedApps.website')}</dt>
              <dd className="mt-1 break-all text-foreground" dir="ltr">
                {row.app.uri}
              </dd>
            </div>
          ) : null}
        </TechnicalDetails>
      </div>
      <div className="flex gap-2 self-start sm:self-center">
        {row.kind === 'key' && row.key.ownedByViewer !== false && row.status !== 'revoked' ? (
          <Button
            className="h-9"
            disabled={rotateBusy !== null && rotateBusy !== row.key.id}
            disabledReason={enabled ? undefined : t('settings.aiAssistants.off.reason')}
            loading={rotateBusy === row.key.id}
            onClick={() => onRotate(row.key)}
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden />
            {t('settings.apiKeys.rotate')}
          </Button>
        ) : null}
        {row.kind === 'app' || row.status !== 'revoked' ? (
          <Button className="h-9" onClick={onRemove} type="button" variant="destructive">
            {row.kind === 'app' ? <Unplug aria-hidden /> : <Trash2 aria-hidden />}
            {row.kind === 'app' ? t('settings.connectedApps.disconnect') : t('settings.apiKeys.revoke')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
