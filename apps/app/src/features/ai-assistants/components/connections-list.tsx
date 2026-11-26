import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
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
import { formattedDate, McpActivityLine, RefreshFailedNotice, relativeMinutes, TechnicalDetails } from './credential-parts';
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
  if (loading(keys) && loading(apps)) return <DataListSkeleton loadingLabel={t('settings.aiAssistants.connectionsLoading')} rows={2} />;

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
      <DataListSkeleton key={message} loadingLabel={t('settings.aiAssistants.connectionsLoading')} rows={1} />
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

  // Every child is its own band of the section's panel, divided by its hairlines.
  const notices = sourceNotices.filter(Boolean);
  return (
    <>
      {notices.length > 0 ? <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">{notices}</div> : null}
      {manageAll && people.length > 1 ? (
        <div className="px-4 py-3 sm:px-5">
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
        </div>
      ) : null}
      {live.length === 0 ? (
        <DataListEmpty className="py-6 text-center text-muted-foreground text-sm">
          {enabled ? t('settings.aiAssistants.empty') : t('settings.aiAssistants.emptyOff')}
        </DataListEmpty>
      ) : (
        <DataList aria-label={t('settings.aiAssistants.connectionsTitle')}>{live.map(renderRow)}</DataList>
      )}
      {inactive.length > 0 ? (
        <details className="px-4 py-3 sm:px-5" data-slot="inactive-connections">
          <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground text-sm hover:text-foreground">
            {t('settings.aiAssistants.inactive')}
            <Badge variant="secondary">{inactive.length}</Badge>
          </summary>
          <DataList className="-mx-4 mt-3 border-border border-t sm:-mx-5">{inactive.map(renderRow)}</DataList>
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
    </>
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
  const canRotate = row.kind === 'key' && row.key.ownedByViewer !== false && row.status !== 'revoked';
  const canRemove = row.kind === 'app' || row.status !== 'revoked';
  const rotating = row.kind === 'key' && rotateBusy === row.key.id;
  return (
    <DataListItem
      badges={
        <>
          <Badge variant="secondary">{row.kind === 'app' ? t('settings.aiAssistants.signedIn') : t('settings.aiAssistants.personalKey')}</Badge>
          <Badge variant="outline">{t(`settings.apiKeys.${item.preset}`)}</Badge>
          {row.kind === 'key' && row.status === 'expiringSoon' && row.key.expiresAt ? (
            <StatusBadge tone="warning">{t('settings.aiAssistants.expiresSoon', { when: relativeFuture(row.key.expiresAt, locale) })}</StatusBadge>
          ) : null}
          {row.kind === 'key' && row.status === 'expired' ? <StatusBadge tone="danger">{t('settings.apiKeys.expired')}</StatusBadge> : null}
          {row.kind === 'key' && row.status === 'revoked' ? <StatusBadge tone="danger">{t('settings.apiKeys.revoked')}</StatusBadge> : null}
          {row.kind === 'key' && row.status === 'rotationRequired' ? (
            <StatusBadge tone="warning">{row.key.legacy ? t('settings.apiKeys.legacy') : t('settings.apiKeys.rotationRequired')}</StatusBadge>
          ) : null}
        </>
      }
      description={item.preset === 'custom' ? t('settings.apiKeys.customDescription') : t(`settings.apiKeys.${item.preset}Description`)}
      leading={
        row.kind === 'app' ? <Plug aria-hidden className="size-4 text-primary" /> : <KeyRound aria-hidden className="size-4 text-muted-foreground" />
      }
      meta={
        <>
          <span>
            {t('settings.apiKeys.lastUsed')}{' '}
            <span className="font-medium text-foreground">
              {item.lastUsedAt ? relativeMinutes(item.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}
            </span>
          </span>
          {row.kind === 'key' ? (
            <span>
              {t('settings.apiKeys.expires')}{' '}
              <span className="text-foreground">{row.key.expiresAt ? formattedDate(row.key.expiresAt, locale) : t('settings.apiKeys.noExpiry')}</span>
            </span>
          ) : (
            <span>
              {t('settings.connectedApps.connectedAt')} <span className="text-foreground">{formattedDate(row.app.createdAt, locale)}</span>
            </span>
          )}
          {manageAll && owner ? (
            <span>
              {row.kind === 'key' ? t('settings.apiKeys.createdBy') : t('settings.connectedApps.connectedBy')}:{' '}
              <bdi className="text-foreground">{owner.name.trim() || owner.email}</bdi>
            </span>
          ) : null}
        </>
      }
      title={<bdi>{item.name}</bdi>}
      trailing={
        canRotate || canRemove ? (
          <RowActions label={t('settings.aiAssistants.actionsFor', { name: item.name })}>
            {canRotate && row.kind === 'key' ? (
              <RowActionsItem
                disabled={rotateBusy !== null}
                disabledReason={enabled ? undefined : t('settings.aiAssistants.off.reason')}
                icon={<RefreshCw aria-hidden className={rotating ? 'motion-safe:animate-spin' : undefined} />}
                onSelect={() => onRotate(row.key)}
              >
                {t('settings.apiKeys.rotate')}
              </RowActionsItem>
            ) : null}
            {canRemove ? (
              <RowActionsItem destructive icon={row.kind === 'app' ? <Unplug aria-hidden /> : <Trash2 aria-hidden />} onSelect={onRemove}>
                {row.kind === 'app' ? t('settings.connectedApps.disconnect') : t('settings.apiKeys.revoke')}
              </RowActionsItem>
            ) : null}
          </RowActions>
        ) : null
      }
    >
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
    </DataListItem>
  );
}
