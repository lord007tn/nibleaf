import { Button } from '@nibleaf/design-system/components/ui/button';
import { CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { MCP_PRESET_SCOPES, type McpKeyPreset, type McpScope, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { useForm, useStore } from '@tanstack/react-form';
import { KeyRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useApiKeys, useCreateApiKey } from '@/hooks/api';
import { required } from '@/lib/form';
import { useFormatters } from '@/lib/format';
import { ConnectionError, testAssistantConnection } from '../api/test-connection';
import { KEY_CLIENT_NAMES, KEY_CLIENTS, type KeyClient } from '../model/clients';
import type { PresetChoice } from '../model/page-state';
import { assistantSetup } from '../model/setup';

type ExpiryDays = 7 | 30 | 90 | 180 | 365;
const EXPIRY_OPTIONS = [7, 30, 90, 180, 365] as const satisfies readonly ExpiryDays[];
const expiryOptionSchema = z.enum(['7', '30', '90', '180', '365']);
const expiryDaysByValue = { '7': 7, '30': 30, '90': 90, '180': 180, '365': 365 } as const;

/** How long the dialog watches for the AI app's first request before it stops polling. */
const WAIT_FOR_APP_MS = 10 * 60_000;

/** A key whose secret is on screen: just created, or just rotated from a row. */
export type IssuedKey = { id: string; secret: string };

/**
 * The personal-key route, for scripts and apps that can't sign in. Step one
 * picks what the key may do; step two shows the secret once, with the setup
 * for the chosen app. From the moment Create is pressed until the secret has
 * been saved, nothing closes the dialog (no Esc, no outside click, no close
 * button): the server may already have made the key, and its secret is shown
 * once. On a phone the dialog fits the screen, its body scrolls and the footer
 * stays in view, so the way out is always visible.
 */
export function KeyDialog({
  projectId,
  role,
  endpoint,
  presets,
  initialClient,
  open,
  issued,
  onIssued,
  onClose,
}: {
  projectId: string;
  role: string;
  endpoint: string;
  presets: PresetChoice[];
  initialClient: KeyClient;
  open: boolean;
  issued: IssuedKey | null;
  onIssued: (key: IssuedKey) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  // Owned here, not by the form, so a pending create is never unmounted away.
  const create = useCreateApiKey(projectId);
  const locked = Boolean(issued) || create.isPending;
  return (
    <Dialog
      disablePointerDismissal={locked}
      onOpenChange={(next) => {
        if (!next && !locked) onClose();
      }}
      open={open}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto sm:max-w-xl"
        closeLabel={t('settings.apiKeys.cancel')}
        data-slot="key-dialog"
        showCloseButton={!locked}
      >
        {issued ? (
          <SecretStep endpoint={endpoint} initialClient={initialClient} issued={issued} onDone={onClose} projectId={projectId} />
        ) : (
          <CreateStep create={create} onCancel={onClose} onIssued={onIssued} presets={presets} role={role} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Keeps the dialog's footer in view while its body scrolls. */
const STICKY_FOOTER = 'sticky -bottom-6 -mx-6 -mb-6 border-border border-t bg-popover px-6 py-3';

function CreateStep({
  create,
  role,
  presets,
  onIssued,
  onCancel,
}: {
  create: ReturnType<typeof useCreateApiKey>;
  role: string;
  presets: PresetChoice[];
  onIssued: (key: IssuedKey) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const { count } = useFormatters();
  const allowedScopes = mcpScopesForRole(role);
  const firstOpen =
    presets.find((choice) => choice.preset === 'support_writer' && choice.reason === null) ?? presets.find((choice) => choice.reason === null);
  const form = useForm({
    defaultValues: {
      name: t('settings.apiKeys.defaultName'),
      preset: (firstOpen?.preset ?? 'read_only') as McpKeyPreset | 'custom',
      scopes: [...MCP_PRESET_SCOPES[firstOpen?.preset ?? 'read_only']] as McpScope[],
      expiryDays: 90 as ExpiryDays,
    },
    onSubmit: ({ value }) => {
      if (!selectionPermitted) return;
      create.mutate(
        {
          body: {
            name: value.name.trim(),
            ...(value.preset === 'custom' ? { scopes: value.scopes } : { preset: value.preset }),
            expiresInDays: value.expiryDays,
          },
          // The secret goes straight to the page's state, never into the mutation cache.
          deliver: onIssued,
        },
        // A failed create keeps the draft; the mutation toasts the reason.
        { onSuccess: () => toast.success(t('settings.apiKeys.created.toast')) },
      );
    },
  });
  const { preset, scopes, expiryDays } = useStore(form.store, (state) => state.values);
  const reasonFor = (value: McpKeyPreset) => presets.find((choice) => choice.preset === value)?.reason ?? null;
  // The server refuses a level or permission above the person's role; a role
  // that changed while the dialog was open must not leave Create enabled.
  const selectionPermitted = preset === 'custom' ? scopes.every((scope) => allowedScopes.includes(scope)) : reasonFor(preset) === null;
  const expiryOptions = EXPIRY_OPTIONS.map((days) => ({ value: String(days), label: t('settings.apiKeys.expiryDays', count(days)) }));
  const toggleScope = (scope: McpScope) => {
    if (scope === 'mcp:connect') return;
    form.setFieldValue('preset', 'custom');
    form.setFieldValue('scopes', (current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('settings.aiAssistants.keyDialog.title')}</DialogTitle>
        <DialogDescription>{t('settings.aiAssistants.keyDialog.description')}</DialogDescription>
      </DialogHeader>
      <RadioGroup
        className="flex flex-col gap-3"
        disabled={create.isPending}
        label={t('settings.apiKeys.preset')}
        onValueChange={(value) => {
          const next = presets.find((choice) => choice.preset === value);
          if (!next || next.reason) return;
          form.setFieldValue('preset', next.preset);
          form.setFieldValue('scopes', [...MCP_PRESET_SCOPES[next.preset]]);
        }}
        value={preset === 'custom' ? '' : preset}
      >
        {presets.map((choice) => (
          <RadioField
            description={t(`settings.apiKeys.${choice.preset}Description`)}
            disabledReason={
              choice.reason === 'adminOnly'
                ? t('settings.apiKeys.adminOnly')
                : choice.reason === 'siteLimit'
                  ? t('settings.aiAssistants.siteLimit')
                  : undefined
            }
            key={choice.preset}
            label={t(`settings.apiKeys.${choice.preset}`)}
            value={choice.preset}
          />
        ))}
      </RadioGroup>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.apiKeys.nameLabel'), t)(value) }}>
          {(field) => (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="api-key-name">{t('settings.apiKeys.nameLabel')}</Label>
              <Input
                aria-describedby={field.state.meta.errors.length ? 'api-key-name-error' : undefined}
                aria-invalid={field.state.meta.errors.length > 0}
                disabled={create.isPending}
                id="api-key-name"
                maxLength={80}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t('settings.apiKeys.namePlaceholder')}
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} id="api-key-name-error" />
            </div>
          )}
        </form.Field>
        <div className="flex flex-col gap-1.5">
          <Label id="api-key-expiry-label">{t('settings.apiKeys.expiry')}</Label>
          <Select
            disabled={create.isPending}
            items={expiryOptions}
            onValueChange={(value) => {
              const parsed = expiryOptionSchema.safeParse(value);
              if (parsed.success) form.setFieldValue('expiryDays', expiryDaysByValue[parsed.data]);
            }}
            value={String(expiryDays)}
          >
            <SelectTrigger aria-labelledby="api-key-expiry-label" className="w-full sm:w-40">
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
        </div>
      </div>
      <details>
        <summary className="w-fit cursor-pointer text-muted-foreground text-sm hover:text-foreground">{t('settings.apiKeys.advanced')}</summary>
        <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">{t('settings.apiKeys.advanced')}</legend>
          {allowedScopes.map((scope) => (
            <CheckboxField
              checked={scopes.includes(scope)}
              disabled={create.isPending || scope === 'mcp:connect'}
              key={scope}
              label={
                <code className="text-xs" dir="ltr">
                  {scope}
                </code>
              }
              onCheckedChange={() => toggleScope(scope)}
            />
          ))}
        </fieldset>
      </details>
      <DialogFooter className={STICKY_FOOTER}>
        <Button disabled={create.isPending} onClick={onCancel} type="button" variant="outline">
          {t('settings.apiKeys.cancel')}
        </Button>
        <Button
          disabledReason={selectionPermitted ? undefined : t('settings.apiKeys.adminOnly')}
          loading={create.isPending}
          loadingText={t('settings.aiAssistants.keyDialog.creating')}
          type="submit"
        >
          <KeyRound aria-hidden />
          {t('settings.apiKeys.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SecretStep({
  projectId,
  endpoint,
  issued,
  initialClient,
  onDone,
}: {
  projectId: string;
  endpoint: string;
  issued: IssuedKey;
  initialClient: KeyClient;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const { number } = useFormatters();
  const [client, setClient] = useState<KeyClient>(initialClient);
  const [connection, setConnection] = useState('');
  const [testing, setTesting] = useState(false);
  // "Your AI app is using this key": use after `since` (server time) counts.
  // 0 for a fresh key; the end of the dashboard's own test after Test connection.
  const [waiting, setWaiting] = useState(() => ({ id: issued.id, since: 0, until: Date.now() + WAIT_FOR_APP_MS }));
  // "Now" is state, moved forward at the deadline: a bare Date.now() in render would be memoized by the React Compiler.
  const [now, setNow] = useState(() => Date.now());
  // A test belongs to the key it started for; a late result for an older key is dropped.
  const testRun = useRef(0);
  // The form that held focus is gone: move it to the secret's Copy button, the next thing to do.
  const secretRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    secretRow.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [issued.id]);
  useEffect(() => {
    testRun.current += 1;
    setConnection('');
    setTesting(false);
    setWaiting({ id: issued.id, since: 0, until: Date.now() + WAIT_FOR_APP_MS });
  }, [issued.id]);
  useEffect(() => {
    const remaining = waiting.until - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [waiting]);
  const { data } = useApiKeys(projectId, waiting);
  const connected = data?.data.some((key) => key.id === waiting.id && key.lastUsedAt && Date.parse(key.lastUsedAt) > waiting.since);
  const setup = assistantSetup(endpoint, issued.secret);
  const snippets: Record<KeyClient, string> = { claudeCode: setup.claudeCode, desktop: setup.desktop, cursor: setup.cursor, vscode: setup.vscode };

  const testConnection = async () => {
    const run = ++testRun.current;
    setTesting(true);
    let usedUntil: number | undefined;
    let outcome: string;
    try {
      const result = await testAssistantConnection(issued.secret);
      usedUntil = result.usedUntil;
      outcome = `✓ ${t('settings.apiKeys.testSuccess', { count: number(result.tools) })}`;
    } catch (error) {
      if (error instanceof ConnectionError) usedUntil = error.usedUntil;
      const reason = error instanceof ConnectionError ? error.message : 'networkError';
      outcome = `✗ ${
        reason === 'invalidKey'
          ? t('settings.apiKeys.invalidKey')
          : reason === 'disabled'
            ? t('settings.apiKeys.disabled')
            : reason === 'networkError'
              ? t('settings.apiKeys.networkError')
              : t('settings.apiKeys.connectionError')
      }`;
    }
    if (run !== testRun.current) return;
    setConnection(outcome);
    setWaiting((current) => ({
      ...current,
      since: usedUntil === undefined ? current.since : Math.max(current.since, usedUntil),
      until: Date.now() + WAIT_FOR_APP_MS,
    }));
    setTesting(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t('settings.apiKeys.created.title')}</DialogTitle>
        <DialogDescription>{t('settings.apiKeys.secretWarning')}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2" ref={secretRow}>
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap px-1 text-sm" dir="ltr">
          {issued.secret}
        </code>
        <CopyButton
          copiedLabel={t('settings.apiKeys.copied')}
          failedLabel={t('settings.apiKeys.copyFailed')}
          label={t('settings.apiKeys.copy')}
          value={issued.secret}
          variant="outline"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="font-medium text-sm" id="key-setup-label">
          {t('settings.apiKeys.setup')}
        </p>
        <SegmentedControl aria-labelledby="key-setup-label" role="group">
          {KEY_CLIENTS.map((value) => (
            <SegmentedControlItem active={client === value} key={value} onClick={() => setClient(value)}>
              <bdi>{KEY_CLIENT_NAMES[value]}</bdi>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {client === 'desktop' ? (
          <p className="text-muted-foreground text-sm">
            {t('settings.apiKeys.desktopPath')}{' '}
            <code className="break-all" dir="ltr">
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>{' '}
            <code className="break-all" dir="ltr">
              %APPDATA%/Claude/claude_desktop_config.json
            </code>
          </p>
        ) : null}
        {client === 'cursor' ? <p className="text-muted-foreground text-sm">{t('settings.apiKeys.cursorEnv')}</p> : null}
        {client === 'vscode' ? <p className="text-muted-foreground text-sm">{t('settings.apiKeys.vscodePrompt')}</p> : null}
        <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs" dir="ltr">
          <code>{snippets[client]}</code>
        </pre>
        <div className="flex flex-wrap gap-2">
          <CopyButton
            copiedLabel={t('settings.aiAssistants.copied')}
            failedLabel={t('settings.apiKeys.copyFailed')}
            label={t('settings.apiKeys.copy')}
            value={snippets[client]}
            variant="outline"
          >
            {t('settings.apiKeys.copy')}
          </CopyButton>
          {client === 'cursor' || client === 'vscode' ? (
            <Button nativeButton={false} render={<a href={client === 'cursor' ? setup.cursorLink : setup.vscodeLink} />} variant="outline">
              {t(client === 'cursor' ? 'settings.apiKeys.installCursor' : 'settings.apiKeys.installVscode')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div>
          <Button loading={testing} loadingText={t('settings.apiKeys.testing')} onClick={() => void testConnection()} type="button" variant="outline">
            {t('settings.apiKeys.test')}
          </Button>
        </div>
        <p className="text-sm" role="status">
          {connection}
        </p>
        <p className="text-muted-foreground text-sm" role="status">
          {connected
            ? t('settings.apiKeys.assistantConnected')
            : now >= waiting.until
              ? t('settings.apiKeys.waitingStopped')
              : t('settings.apiKeys.waiting')}
        </p>
      </div>
      <DialogFooter className={STICKY_FOOTER}>
        <Button onClick={onDone} type="button">
          {t('settings.aiAssistants.keyDialog.done')}
        </Button>
      </DialogFooter>
    </div>
  );
}
