import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { MCP_SCOPES } from '@nibleaf/shared/mcp';
import { Check, Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey } from '@/hooks/api';
import type { ApiKey } from '@/hooks/api/types';
import { localeTag, useFormatters } from '@/lib/format';
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

type IssuableMcpScope = (typeof MCP_SCOPES)[number];
type ExpiryDays = 30 | 90 | 180 | 365;

const DEFAULT_SCOPES = ['mcp:connect', 'projects:read', 'pages:read'] satisfies IssuableMcpScope[];
const EXPIRY_OPTIONS = [30, 90, 180, 365] as const satisfies readonly ExpiryDays[];
const expiryOptionSchema = z.enum(['30', '90', '180', '365']);
const expiryDaysByValue = { '30': 30, '90': 90, '180': 180, '365': 365 } as const;
const issuableScopes = new Set<string>(MCP_SCOPES);
const isIssuableScope = (scope: string): scope is IssuableMcpScope => issuableScopes.has(scope);
const isRetainedScope = (scope: string): scope is Exclude<IssuableMcpScope, 'mcp:connect'> => scope !== 'mcp:connect' && isIssuableScope(scope);

const formattedDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ApiKeysTab({ projectId }: { projectId: string }) {
  const { locale, t } = useLocale();
  const { number } = useFormatters();
  const { data: keys = [], error, isError, isLoading } = useApiKeys(projectId);
  const create = useCreateApiKey(projectId);
  const rotate = useRotateApiKey(projectId);
  const revoke = useRevokeApiKey(projectId);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<IssuableMcpScope[]>(DEFAULT_SCOPES);
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeCandidate, setRevokeCandidate] = useState<ApiKey | null>(null);
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const expiryOptions = EXPIRY_OPTIONS.map((days) => ({ value: String(days), label: t('settings.apiKeys.expiryDays', { days: number(days) }) }));

  const toggleScope = (scope: IssuableMcpScope) => {
    if (scope === 'mcp:connect') return;
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  const submit = () => {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), scopes, expiresInDays: expiryDays },
      {
        onSuccess: (created) => {
          setName('');
          setSecret(created.secret);
          toast.success(t('settings.apiKeys.created.toast'));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.createError')),
      },
    );
  };

  const rotateKey = (key: ApiKey) => {
    const retainedScopes = key.scopes.filter(isRetainedScope);
    rotate.mutate(
      { id: key.id, body: { scopes: ['mcp:connect', ...retainedScopes], expiresInDays: expiryDays } },
      {
        onSuccess: (created) => {
          setSecret(created.secret);
          toast.success(t('settings.apiKeys.rotatedToast'));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.rotateError')),
      },
    );
  };

  const confirmRevoke = () => {
    if (!revokeCandidate) return;
    revoke.mutate(revokeCandidate.id, {
      onSuccess: () => {
        setRevokeCandidate(null);
        toast.success(t('settings.apiKeys.revokedToast'));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.revokeError')),
    });
  };

  const copySecret = () => {
    if (!secret) return;
    navigator.clipboard.writeText(secret).then(
      () => toast.success(t('settings.apiKeys.copied')),
      () => toast.error(t('settings.apiKeys.createError')),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection description={t('settings.apiKeys.description')} title={t('settings.apiKeys.title')}>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
          <code className="min-w-0 truncate text-foreground">/api/mcp</code>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              aria-label={t('settings.apiKeys.namePlaceholder')}
              className="h-9 flex-1"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.apiKeys.namePlaceholder')}
              value={name}
            />
            <Select
              items={expiryOptions}
              onValueChange={(value) => {
                const parsed = expiryOptionSchema.safeParse(value);
                if (parsed.success) setExpiryDays(expiryDaysByValue[parsed.data]);
              }}
              value={String(expiryDays)}
            >
              <SelectTrigger aria-label={t('settings.apiKeys.expiry')} className="h-9 w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {expiryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="h-9" disabled={!name.trim() || create.isPending} onClick={submit} type="button">
              <KeyRound aria-hidden />
              {t('settings.apiKeys.create')}
            </Button>
          </div>
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">{t('settings.apiKeys.description')}</legend>
            {MCP_SCOPES.map((scope) => {
              const selected = scopes.includes(scope);
              return (
                <Button
                  aria-pressed={selected}
                  className="h-8 font-mono text-xs"
                  disabled={scope === 'mcp:connect'}
                  key={scope}
                  onClick={() => toggleScope(scope)}
                  size="sm"
                  type="button"
                  variant={selected ? 'secondary' : 'outline'}
                >
                  {selected ? <Check aria-hidden /> : null}
                  {scope}
                </Button>
              );
            })}
          </fieldset>
        </div>
      </SettingsSection>

      {secret ? (
        <SettingsSection description={t('settings.apiKeys.created.description')} title={t('settings.apiKeys.created.title')}>
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 text-sm" dir="ltr">
              {secret}
            </code>
            <Button aria-label={t('settings.apiKeys.copy')} onClick={copySecret} size="icon" type="button" variant="outline">
              <Copy aria-hidden />
            </Button>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection>
        {isLoading ? null : isError || error ? (
          <p className="py-3 text-center text-destructive text-sm" role="alert">
            {t('settings.apiKeys.loadError')}
          </p>
        ) : keys.length === 0 ? (
          <p className="py-3 text-center text-muted-foreground text-sm">{t('settings.apiKeys.empty')}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {keys.map((key) => (
              <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={key.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{key.name}</span>
                    {key.state === 'revoked' ? <Badge variant="destructive">{t('settings.apiKeys.revoked')}</Badge> : null}
                    {key.state === 'expired' ? <Badge variant="destructive">{t('settings.apiKeys.expired')}</Badge> : null}
                    {key.state === 'rotation_required' && key.legacy ? <Badge variant="secondary">{t('settings.apiKeys.legacy')}</Badge> : null}
                    {key.state === 'rotation_required' ? <Badge variant="outline">{t('settings.apiKeys.rotationRequired')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">{t('settings.apiKeys.lastFour', { lastFour: key.lastFour })}</p>
                  <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.expires')}</dt>
                      <dd className="text-foreground">{key.expiresAt ? formattedDate(key.expiresAt, locale) : t('settings.apiKeys.noExpiry')}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.lastUsed')}</dt>
                      <dd className="text-foreground">{key.lastUsedAt ? formattedDate(key.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge className="font-mono" key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 self-start sm:self-center">
                  <Button
                    className="h-9"
                    disabled={Boolean(key.revokedAt) || rotate.isPending}
                    onClick={() => rotateKey(key)}
                    type="button"
                    variant="outline"
                  >
                    <RefreshCw aria-hidden />
                    {t('settings.apiKeys.rotate')}
                  </Button>
                  <Button
                    className="h-9"
                    disabled={Boolean(key.revokedAt) || revoke.isPending}
                    onClick={() => setRevokeCandidate(key)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden />
                    {t('settings.apiKeys.revoke')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <AlertDialog onOpenChange={(open) => (open ? undefined : setRevokeCandidate(null))} open={Boolean(revokeCandidate)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.apiKeys.revokeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.apiKeys.revokeConfirm.description', { name: revokeCandidate?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('settings.apiKeys.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={revoke.isPending} onClick={confirmRevoke}>
              <Trash2 aria-hidden />
              {t('settings.apiKeys.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
