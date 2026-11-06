import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, MCP_PRESET_SCOPES, MCP_SCOPES, type McpKeyPreset, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister, roleAtLeast } from '@nibleaf/shared/rbac';
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
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
import { assistantSetup, ConnectionError, testAssistantConnection } from './assistant-setup';
import { SettingsSection } from './section';

type IssuableMcpScope = (typeof MCP_SCOPES)[number];
type ExpiryDays = 7 | 30 | 90 | 180 | 365;

const DEFAULT_SCOPES = [...MCP_PRESET_SCOPES.support_writer];
const EXPIRY_OPTIONS = [7, 30, 90, 180, 365] as const satisfies readonly ExpiryDays[];
const expiryOptionSchema = z.enum(['7', '30', '90', '180', '365']);
const expiryDaysByValue = { '7': 7, '30': 30, '90': 90, '180': 180, '365': 365 } as const;
const issuableScopes = new Set<string>(MCP_SCOPES);
const isIssuableScope = (scope: string): scope is IssuableMcpScope => issuableScopes.has(scope);
const isRetainedScope = (scope: string): scope is Exclude<IssuableMcpScope, 'mcp:connect'> => scope !== 'mcp:connect' && isIssuableScope(scope);

const formattedDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ApiKeysTab({ projectId, role = '' }: { projectId: string; role?: string }) {
  const { locale, t } = useLocale();
  const { number } = useFormatters();
  const [waiting, setWaiting] = useState<{ id: string; since: number } | null>(null);
  const { data: response, error, isError, isLoading } = useApiKeys(projectId, waiting);
  const create = useCreateApiKey(projectId);
  const rotate = useRotateApiKey(projectId);
  const revoke = useRevokeApiKey(projectId);
  const [name, setName] = useState(t('settings.apiKeys.defaultName'));
  const keys = response?.data ?? [];
  const enabled = response?.meta.mcpEnabled === true;
  const endpoint = response?.meta.mcpEndpoint ?? '';
  const allowedScopes = mcpScopesForRole(role);
  const [preset, setPreset] = useState<McpKeyPreset | 'custom'>('support_writer');
  const [client, setClient] = useState('claudeCode');
  const [connection, setConnection] = useState('');
  const [testing, setTesting] = useState(false);
  const connected = waiting && keys.some((key) => key.id === waiting.id && key.lastUsedAt && Date.parse(key.lastUsedAt) > waiting.since);

  const [scopes, setScopes] = useState<IssuableMcpScope[]>(DEFAULT_SCOPES);
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeCandidate, setRevokeCandidate] = useState<ApiKey | null>(null);
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const expiryOptions = EXPIRY_OPTIONS.map((days) => ({ value: String(days), label: t('settings.apiKeys.expiryDays', { days: number(days) }) }));

  const toggleScope = (scope: IssuableMcpScope) => {
    if (scope === 'mcp:connect') return;
    setPreset('custom');
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  const submit = () => {
    if (!name.trim() || !enabled) return;
    create.mutate(
      { name: name.trim(), ...(preset === 'custom' ? { scopes } : { preset }), expiresInDays: expiryDays },
      {
        onSuccess: (created) => {
          setName(t('settings.apiKeys.defaultName'));
          setConnection('');
          setWaiting({ id: created.id, since: Date.now() });
          setSecret(created.secret);
          toast.success(t('settings.apiKeys.created.toast'));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.createError')),
      },
    );
  };

  const rotateKey = (key: ApiKey) => {
    const retainedScopes = key.scopes.filter(isRetainedScope).filter((scope) => allowedScopes.includes(scope));
    rotate.mutate(
      { id: key.id, body: { scopes: ['mcp:connect', ...retainedScopes], expiresInDays: expiryDays } },
      {
        onSuccess: (created) => {
          setSecret(created.secret);
          setConnection('');
          setWaiting({ id: created.id, since: Date.now() });
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
        if (waiting?.id === revokeCandidate.id) {
          setSecret(null);
          setWaiting(null);
        }
        setRevokeCandidate(null);
        toast.success(t('settings.apiKeys.revokedToast'));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.revokeError')),
    });
  };

  const setup = secret && endpoint ? assistantSetup(endpoint, secret) : null;
  const snippets: Record<string, string> = setup
    ? { claudeCode: setup.claudeCode, desktop: setup.desktop, cursor: setup.cursor, vscode: setup.vscode }
    : {};
  const copy = (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => toast.success(t('settings.apiKeys.copied')),
      () => toast.error(t('settings.apiKeys.createError')),
    );
  const testConnection = async () => {
    if (!secret) return;
    setTesting(true);
    try {
      const count = await testAssistantConnection(secret);
      setConnection(`\u2713 ${t('settings.apiKeys.testSuccess', { count: number(count) })}`);
    } catch (error) {
      const reason = error instanceof ConnectionError ? error.message : 'networkError';
      setConnection(
        `\u2717 ${reason === 'invalidKey' ? t('settings.apiKeys.invalidKey') : reason === 'disabled' ? t('settings.apiKeys.disabled') : reason === 'networkError' ? t('settings.apiKeys.networkError') : t('settings.apiKeys.connectionError')}`,
      );
    } finally {
      setWaiting(waiting ? { ...waiting, since: Date.now() } : null);
      setTesting(false);
    }
  };
  return (
    <div className="min-w-0 flex flex-col gap-6">
      <SettingsSection description={t('settings.apiKeys.description')} title={t('settings.apiKeys.title')}>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
          <code dir="ltr" className="min-w-0 break-all text-foreground">
            {endpoint}
          </code>
        </div>

        {response && !enabled ? (
          <p role="status" className="mt-3 rounded-lg border p-3 text-sm">
            {t('settings.apiKeys.disabled')}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-3">
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 font-medium">{t('settings.apiKeys.preset')}</legend>
            {MCP_KEY_PRESETS.map((value) => (
              <label key={value} className="rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="mcp-preset"
                  checked={preset === value}
                  disabled={!roleAtLeast(role, MCP_PRESET_MIN_ROLE[value])}
                  onChange={() => {
                    setPreset(value);
                    setScopes([...MCP_PRESET_SCOPES[value]]);
                  }}
                />
                <span className="ms-2 font-medium">{t(`settings.apiKeys.${value}`)}</span>
                <p className="mt-2 text-muted-foreground">{t(`settings.apiKeys.${value}Description`)}</p>
                {!roleAtLeast(role, MCP_PRESET_MIN_ROLE[value]) ? <p>{t('settings.apiKeys.adminOnly')}</p> : null}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              aria-label={t('settings.apiKeys.namePlaceholder')}
              className="flex-1"
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
              <SelectTrigger aria-label={t('settings.apiKeys.expiry')} className="w-full sm:w-40">
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
            <Button disabled={!enabled || !allowedScopes.length || !name.trim() || create.isPending} onClick={submit} type="button">
              <KeyRound aria-hidden />
              {t('settings.apiKeys.create')}
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">{t('settings.apiKeys.advanced')}</summary>
            <fieldset className="mt-3 flex flex-wrap gap-3">
              <legend className="sr-only">{t('settings.apiKeys.description')}</legend>
              {allowedScopes.map((scope) => (
                <label className="flex items-center gap-2 font-mono text-xs" key={scope}>
                  <input type="checkbox" checked={scopes.includes(scope)} disabled={scope === 'mcp:connect'} onChange={() => toggleScope(scope)} />
                  {scope}
                </label>
              ))}
            </fieldset>
          </details>
        </div>
      </SettingsSection>

      {secret ? (
        <SettingsSection description={t('settings.apiKeys.created.description')} title={t('settings.apiKeys.created.title')}>
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 text-sm" dir="ltr">
              {secret}
            </code>
            <Button aria-label={t('settings.apiKeys.copy')} onClick={() => void copy(secret)} size="icon" type="button" variant="outline">
              <Copy aria-hidden />
            </Button>
          </div>
          <p className="mt-3 text-sm">{t('settings.apiKeys.secretWarning')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSecret(null);
              setWaiting(null);
            }}
          >
            {t('settings.apiKeys.dismissSecret')}
          </Button>
          {setup ? (
            <div className="mt-4 space-y-3">
              <fieldset className="flex flex-wrap gap-2" aria-label={t('settings.apiKeys.setup')}>
                {['claudeCode', 'desktop', 'cursor', 'vscode', 'chatgpt'].map((value) => (
                  <Button
                    type="button"
                    key={value}
                    aria-pressed={client === value}
                    variant={client === value ? 'default' : 'outline'}
                    onClick={() => setClient(value)}
                  >
                    {{ claudeCode: 'Claude Code', desktop: 'Claude Desktop', cursor: 'Cursor', vscode: 'VS Code', chatgpt: 'ChatGPT' }[value]}
                  </Button>
                ))}
              </fieldset>
              {client === 'chatgpt' ? (
                <p>
                  {t('settings.apiKeys.chatgptUnavailable')}{' '}
                  <a className="underline" href="https://developers.openai.com/plugins/build/auth" target="_blank" rel="noreferrer">
                    {t('settings.apiKeys.docs')}
                  </a>
                </p>
              ) : (
                <>
                  {client === 'desktop' ? (
                    <p className="text-sm">
                      {t('settings.apiKeys.desktopPath')} <code dir="ltr">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                      <br />
                      <code dir="ltr">%APPDATA%/Claude/claude_desktop_config.json</code>
                    </p>
                  ) : null}
                  {client === 'cursor' ? <p>{t('settings.apiKeys.cursorEnv')}</p> : null}
                  {client === 'vscode' ? <p>{t('settings.apiKeys.vscodePrompt')}</p> : null}
                  <pre dir="ltr" className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                    <code>{snippets[client]}</code>
                  </pre>
                  <Button type="button" variant="outline" onClick={() => void copy(snippets[client] ?? '')}>
                    {t('settings.apiKeys.copy')}
                  </Button>
                  {client === 'cursor' || client === 'vscode' ? (
                    <a
                      className="ms-2 inline-flex h-9 items-center rounded-md border border-primary/30 bg-primary/5 px-3 font-medium text-primary text-sm hover:bg-primary/10"
                      href={client === 'cursor' ? setup.cursorLink : setup.vscodeLink}
                    >
                      {t(client === 'cursor' ? 'settings.apiKeys.installCursor' : 'settings.apiKeys.installVscode')}
                    </a>
                  ) : null}
                </>
              )}
              <div>
                <Button type="button" disabled={testing || !enabled} onClick={() => void testConnection()}>
                  {t('settings.apiKeys.test')}
                </Button>
                <p role="status">{connection}</p>
              </div>
              {waiting ? <p role="status">{connected ? t('settings.apiKeys.assistantConnected') : t('settings.apiKeys.waiting')}</p> : null}
            </div>
          ) : null}
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
                    <Badge variant="outline">{t(`settings.apiKeys.${key.preset}`)}</Badge>
                    {canAdminister(role) && key.createdBy ? <span>{key.createdBy.name}</span> : null}
                    {key.state === 'active' ? <Badge variant="secondary">{t('settings.integrations.status.active')}</Badge> : null}
                    {key.state === 'revoked' ? <Badge variant="destructive">{t('settings.apiKeys.revoked')}</Badge> : null}
                    {key.state === 'expired' ? <Badge variant="destructive">{t('settings.apiKeys.expired')}</Badge> : null}
                    {key.state === 'rotation_required' && key.legacy ? <Badge variant="secondary">{t('settings.apiKeys.legacy')}</Badge> : null}
                    {key.state === 'rotation_required' ? <Badge variant="outline">{t('settings.apiKeys.rotationRequired')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">{t('settings.apiKeys.lastFour', { lastFour: key.lastFour })}</p>
                  <p className="mt-1 text-xs">
                    {t('settings.apiKeys.createdAt')}: {formattedDate(key.createdAt, locale)}
                  </p>
                  {key.lastActivity ? (
                    <p className="mt-1 text-xs" dir="auto">
                      {key.lastActivity.operation} ? {key.lastActivity.outcome} ? {formattedDate(key.lastActivity.at, locale)}
                    </p>
                  ) : null}
                  <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.expires')}</dt>
                      <dd className="text-foreground">{key.expiresAt ? formattedDate(key.expiresAt, locale) : t('settings.apiKeys.noExpiry')}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.lastUsed')}</dt>
                      <dd className="text-foreground">
                        {key.lastUsedAt
                          ? new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' }).format(
                              -Math.max(0, Math.floor((Date.now() - Date.parse(key.lastUsedAt)) / 60_000)),
                              'minute',
                            )
                          : t('settings.apiKeys.neverUsed')}
                      </dd>
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
                  {key.ownedByViewer === false ? null : (
                    <Button
                      className="h-9"
                      disabled={!enabled || !allowedScopes.length || Boolean(key.revokedAt) || rotate.isPending}
                      onClick={() => rotateKey(key)}
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw aria-hidden />
                      {t('settings.apiKeys.rotate')}
                    </Button>
                  )}
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
