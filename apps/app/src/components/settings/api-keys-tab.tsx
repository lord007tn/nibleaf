import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale } from '@nibleaf/i18n/react';
import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, MCP_PRESET_SCOPES, MCP_SCOPES, type McpKeyPreset, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister, roleAtLeast } from '@nibleaf/shared/rbac';
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRotateApiKey } from '@/hooks/api';
import type { ApiKey } from '@/hooks/api/types';
import { useFormatters } from '@/lib/format';
import { copyToClipboard } from '@/lib/invitations';
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
import { assistantSetup, ConnectionError, oauthAssistantSetup, testAssistantConnection } from './assistant-setup';
import { ConnectedApps, CredentialRowsSkeleton, formattedDate, McpActivityLine, relativeMinutes, TechnicalDetails } from './connected-apps';
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

/** How long the page watches for the AI app's first request before it stops polling. */
const WAIT_FOR_APP_MS = 10 * 60_000;

export function ApiKeysTab({ projectId, role = '' }: { projectId: string; role?: string }) {
  const { locale, t } = useLocale();
  const { number } = useFormatters();
  // The new key's id and the server time after which use counts as "your AI
  // app connected": 0 for a fresh key (never used), then the end of the
  // dashboard's own test so the test itself doesn't count.
  // `until` bounds how long the page polls; Test connection starts a new watch.
  const [waiting, setWaiting] = useState<{ id: string; since: number; until: number } | null>(null);
  const [, setWatchEnded] = useState(0);
  useEffect(() => {
    if (!waiting) return;
    const remaining = waiting.until - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setWatchEnded((count) => count + 1), remaining);
    return () => clearTimeout(timer);
  }, [waiting]);
  const { data: response, isError, isPending } = useApiKeys(projectId, waiting);
  const create = useCreateApiKey(projectId);
  const rotate = useRotateApiKey(projectId);
  const revoke = useRevokeApiKey(projectId);
  const [name, setName] = useState(t('settings.apiKeys.defaultName'));
  const keys = response?.data ?? [];
  const enabled = response?.meta.mcpEnabled === true;
  const endpoint = response?.meta.mcpEndpoint ?? '';
  const oauthEnabled = enabled && response?.meta.mcpOAuthEnabled === true;
  const oauthSetup = endpoint ? oauthAssistantSetup(endpoint) : null;
  const allowedScopes = mcpScopesForRole(role);
  const [preset, setPreset] = useState<McpKeyPreset | 'custom'>('support_writer');
  const [client, setClient] = useState('claudeCode');
  const [connection, setConnection] = useState('');
  const [testing, setTesting] = useState(false);
  // A connection test belongs to the key it started for. Creating, rotating or
  // hiding a key starts a new run, so a late result never lands beside it.
  const testRun = useRef(0);
  const connected = waiting && keys.some((key) => key.id === waiting.id && key.lastUsedAt && Date.parse(key.lastUsedAt) > waiting.since);

  const [scopes, setScopes] = useState<IssuableMcpScope[]>(DEFAULT_SCOPES);
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeCandidate, setRevokeCandidate] = useState<ApiKey | null>(null);
  // The server refuses a preset or scope above the person's role; a role that
  // changed while the form was open must not leave Create enabled for it.
  const selectionPermitted =
    preset === 'custom' ? scopes.every((scope) => allowedScopes.includes(scope)) : roleAtLeast(role, MCP_PRESET_MIN_ROLE[preset]);
  const showKey = (id: string | null, value: string | null) => {
    testRun.current += 1;
    setTesting(false);
    setConnection('');
    setWaiting(id ? { id, since: 0, until: Date.now() + WAIT_FOR_APP_MS } : null);
    setSecret(value);
  };
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const expiryOptions = EXPIRY_OPTIONS.map((days) => ({ value: String(days), label: t('settings.apiKeys.expiryDays', { days: number(days) }) }));

  const toggleScope = (scope: IssuableMcpScope) => {
    if (scope === 'mcp:connect') return;
    setPreset('custom');
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  const submit = () => {
    if (!name.trim() || !enabled || !selectionPermitted) return;
    create.mutate(
      { name: name.trim(), ...(preset === 'custom' ? { scopes } : { preset }), expiresInDays: expiryDays },
      {
        onSuccess: (created) => {
          setName(t('settings.apiKeys.defaultName'));
          showKey(created.id, created.secret);
          toast.success(t('settings.apiKeys.created.toast'));
        },
      },
    );
  };

  const rotateKey = (key: ApiKey) => {
    const retainedScopes = key.scopes.filter(isRetainedScope).filter((scope) => allowedScopes.includes(scope));
    rotate.mutate(
      { id: key.id, body: { scopes: ['mcp:connect', ...retainedScopes], expiresInDays: expiryDays } },
      {
        onSuccess: (created) => {
          showKey(created.id, created.secret);
          toast.success(t('settings.apiKeys.rotatedToast'));
        },
      },
    );
  };

  // Create, rotate and revoke failures are toasted in plain words by the
  // mutations themselves (meta.errorMessage); revoke also rolls the row back
  // and leaves the dialog open so the person can retry.
  const confirmRevoke = () => {
    if (!revokeCandidate) return;
    revoke.mutate(revokeCandidate.id, {
      onSuccess: () => {
        if (waiting?.id === revokeCandidate.id) showKey(null, null);
        setRevokeCandidate(null);
        toast.success(t('settings.apiKeys.revokedToast'));
      },
    });
  };

  const setup = secret && endpoint ? assistantSetup(endpoint, secret) : null;
  const snippets: Record<string, string> = setup
    ? { claudeCode: setup.claudeCode, desktop: setup.desktop, cursor: setup.cursor, vscode: setup.vscode }
    : {};
  const copy = async (value: string, copied = t('settings.apiKeys.copied')) => {
    if (await copyToClipboard(value)) toast.success(copied);
    else toast.error(t('settings.apiKeys.copyFailed'));
  };
  const testConnection = async () => {
    if (!secret) return;
    const run = ++testRun.current;
    setTesting(true);
    let usedUntil: number | undefined;
    let outcome: string;
    try {
      const result = await testAssistantConnection(secret);
      usedUntil = result.usedUntil;
      outcome = `\u2713 ${t('settings.apiKeys.testSuccess', { count: number(result.tools) })}`;
    } catch (error) {
      if (error instanceof ConnectionError) usedUntil = error.usedUntil;
      const reason = error instanceof ConnectionError ? error.message : 'networkError';
      outcome = `\u2717 ${reason === 'invalidKey' ? t('settings.apiKeys.invalidKey') : reason === 'disabled' ? t('settings.apiKeys.disabled') : reason === 'networkError' ? t('settings.apiKeys.networkError') : t('settings.apiKeys.connectionError')}`;
    }
    // The key on screen changed while this test ran: its result is about another key.
    if (run !== testRun.current) return;
    setConnection(outcome);
    setWaiting((current) =>
      current
        ? { ...current, since: usedUntil === undefined ? current.since : Math.max(current.since, usedUntil), until: Date.now() + WAIT_FOR_APP_MS }
        : current,
    );
    setTesting(false);
  };
  return (
    <div className="min-w-0 flex flex-col gap-6">
      <SettingsSection description={t('settings.apiKeys.description')} title={t('settings.apiKeys.title')}>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
          {isPending ? (
            <Skeleton aria-hidden className="h-4 w-64 max-w-full" />
          ) : (
            <code dir="ltr" className="min-w-0 break-all text-foreground">
              {endpoint}
            </code>
          )}
        </div>

        {response && !enabled ? (
          <p role="status" className="mt-3 rounded-lg border p-3 text-sm">
            {t('settings.apiKeys.disabled')}
          </p>
        ) : null}
        {response && enabled ? (
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-medium">{t('settings.apiKeys.oauthTitle')}</h3>
                <p className="mt-1 text-muted-foreground">
                  {oauthEnabled ? t('settings.apiKeys.oauthDescription') : t('settings.apiKeys.oauthUnavailable')}
                </p>
              </div>
              {oauthEnabled ? (
                <Button
                  className="shrink-0"
                  onClick={() => void copy(endpoint, t('settings.apiKeys.urlCopied'))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Copy aria-hidden />
                  {t('settings.apiKeys.oauthCopyUrl')}
                </Button>
              ) : null}
            </div>
            {oauthEnabled && oauthSetup ? (
              <>
                <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5">
                  <li>{t('settings.apiKeys.oauthChatgpt')}</li>
                  <li>{t('settings.apiKeys.oauthClaude')}</li>
                  <li>{t('settings.apiKeys.oauthClaudeCode')}</li>
                  <li>{t('settings.apiKeys.oauthEditors')}</li>
                </ul>
                <pre dir="ltr" className="mt-3 max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs [contain:inline-size]">
                  <code>{oauthSetup.claudeCode}</code>
                </pre>
                <details className="mt-2">
                  <summary className="cursor-pointer">{t('settings.apiKeys.oauthEditorConfig')}</summary>
                  <pre dir="ltr" className="mt-2 max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs [contain:inline-size]">
                    <code>{oauthSetup.editors}</code>
                  </pre>
                  <pre dir="ltr" className="mt-2 max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs [contain:inline-size]">
                    <code>{oauthSetup.vscode}</code>
                  </pre>
                </details>
                <p className="mt-3 text-muted-foreground">{t('settings.apiKeys.keyAlternative')}</p>
              </>
            ) : null}
          </div>
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
            <Button
              disabled={!enabled || !allowedScopes.length || !name.trim() || !selectionPermitted}
              loading={create.isPending}
              onClick={submit}
              type="button"
            >
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
            <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap px-1 text-sm" dir="ltr">
              {secret}
            </code>
            <Button aria-label={t('settings.apiKeys.copy')} onClick={() => void copy(secret)} size="icon" type="button" variant="outline">
              <Copy aria-hidden />
            </Button>
          </div>
          <p className="mt-3 text-sm">{t('settings.apiKeys.secretWarning')}</p>
          <Button type="button" variant="outline" onClick={() => showKey(null, null)}>
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
                <p>{oauthEnabled ? t('settings.apiKeys.chatgptOAuth') : t('settings.apiKeys.oauthUnavailable')}</p>
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
                  <pre dir="ltr" className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs [contain:inline-size]">
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
                <Button
                  disabled={!enabled}
                  loading={testing}
                  loadingText={t('settings.apiKeys.testing')}
                  onClick={() => void testConnection()}
                  type="button"
                >
                  {t('settings.apiKeys.test')}
                </Button>
                <p role="status">{connection}</p>
              </div>
              {waiting ? (
                <p role="status">
                  {connected
                    ? t('settings.apiKeys.assistantConnected')
                    : Date.now() >= waiting.until
                      ? t('settings.apiKeys.waitingStopped')
                      : t('settings.apiKeys.waiting')}
                </p>
              ) : null}
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        {isError ? (
          <p className="py-3 text-center text-destructive text-sm" role="alert">
            {t('settings.apiKeys.loadError')}
          </p>
        ) : isPending ? (
          <CredentialRowsSkeleton actions={2} label={t('settings.apiKeys.loadingKeys')} />
        ) : keys.length === 0 ? (
          <p className="py-3 text-center text-muted-foreground text-sm">{t('settings.apiKeys.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {keys.map((key) => (
              <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={key.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <bdi className="min-w-0 truncate font-medium text-sm">{key.name}</bdi>
                    <Badge variant="outline">{t(`settings.apiKeys.${key.preset}`)}</Badge>
                    {key.state === 'active' ? <Badge variant="secondary">{t('settings.integrations.status.active')}</Badge> : null}
                    {key.state === 'revoked' ? <Badge variant="destructive">{t('settings.apiKeys.revoked')}</Badge> : null}
                    {key.state === 'expired' ? <Badge variant="destructive">{t('settings.apiKeys.expired')}</Badge> : null}
                    {key.state === 'rotation_required' && key.legacy ? <Badge variant="secondary">{t('settings.apiKeys.legacy')}</Badge> : null}
                    {key.state === 'rotation_required' ? <Badge variant="outline">{t('settings.apiKeys.rotationRequired')}</Badge> : null}
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {key.preset === 'custom' ? t('settings.apiKeys.customDescription') : t(`settings.apiKeys.${key.preset}Description`)}
                  </p>
                  <dl className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.lastUsed')}</dt>
                      <dd className="font-medium text-foreground">
                        {key.lastUsedAt ? relativeMinutes(key.lastUsedAt, locale) : t('settings.apiKeys.neverUsed')}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>{t('settings.apiKeys.expires')}</dt>
                      <dd className="text-foreground">{key.expiresAt ? formattedDate(key.expiresAt, locale) : t('settings.apiKeys.noExpiry')}</dd>
                    </div>
                    {canAdminister(role) && key.createdBy ? (
                      <div className="flex gap-1.5">
                        <dt>{t('settings.apiKeys.createdBy')}:</dt>
                        <dd>
                          <bdi className="text-foreground">{key.createdBy.name.trim() || key.createdBy.email}</bdi>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {key.lastActivity ? <McpActivityLine activity={key.lastActivity} subject="key" /> : null}
                  <TechnicalDetails activity={key.lastActivity} scopes={key.scopes}>
                    <div>
                      <dt>{t('settings.apiKeys.keyEnding')}</dt>
                      <dd className="mt-1 text-foreground">
                        <code dir="ltr">{key.lastFour}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>{t('settings.apiKeys.createdAt')}</dt>
                      <dd className="mt-1 text-foreground">{formattedDate(key.createdAt, locale)}</dd>
                    </div>
                  </TechnicalDetails>
                </div>
                <div className="flex gap-2 self-start sm:self-center">
                  {key.ownedByViewer === false ? null : (
                    <Button
                      className="h-9"
                      disabled={!enabled || !allowedScopes.length || Boolean(key.revokedAt) || (rotate.isPending && rotate.variables?.id !== key.id)}
                      loading={rotate.isPending && rotate.variables?.id === key.id}
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
                    disabled={Boolean(key.revokedAt)}
                    onClick={() => setRevokeCandidate(key)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden />
                    {t('settings.apiKeys.revoke')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <ConnectedApps projectId={projectId} role={role} />

      <AlertDialog onOpenChange={(open) => (open || revoke.isPending ? undefined : setRevokeCandidate(null))} open={Boolean(revokeCandidate)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.apiKeys.revokeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.apiKeys.revokeConfirm.description', { name: revokeCandidate?.name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t('settings.apiKeys.cancel')}</AlertDialogCancel>
            <AlertDialogAction loading={revoke.isPending} onClick={confirmRevoke}>
              <Trash2 aria-hidden />
              {t('settings.apiKeys.revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
