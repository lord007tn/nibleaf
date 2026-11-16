import { Button } from '@nibleaf/design-system/components/ui/button';
import { CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { WorkspaceAiProvider } from '@nibleaf/validators';
import { Check } from 'lucide-react';
import { type FormEvent, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SecretInput } from '@/components/secret-input';
import { useAiKeyConnection } from '../api/hooks';
import { providerKeyErrorMessage } from '../api/provider-key';
import type { AiKeyProvider } from '../model/ai';
import {
  checkRequest,
  modelOptions,
  type ProviderKeySaveBlock,
  type ProviderKeyStep,
  providerForForm,
  providerFormKey,
  providerKeyFormState,
  saveRequest,
} from '../model/provider-key-form';
import { useProviderKeyCheck, useProviderKeySave } from './use-provider-key-commands';

const STEP_LABEL: Record<ProviderKeyStep, MessageKey> = {
  key: 'settings.smartAi.step.key',
  check: 'settings.smartAi.step.check',
  model: 'settings.smartAi.step.model',
  save: 'settings.smartAi.step.save',
};

const SAVE_BLOCK: Record<ProviderKeySaveBlock, MessageKey> = {
  encryption: 'settings.smartAi.why.encryption',
  pasteKey: 'settings.smartAi.why.pasteKey',
  chooseModel: 'settings.smartAi.why.chooseModel',
  replace: 'settings.smartAi.why.replace',
};

/*
 * A site's own OpenAI or OpenRouter key, inside its source card on the AI
 * answers page: paste the key, check it (which loads its models), choose a
 * model, save. Choosing the source is the card's radio, not this form.
 * PR 4 of operations/ux/ai-and-integrations.md replaces it with one dialog.
 * What the form shows and sends is decided in `model/provider-key-form.ts`;
 * Check and Save run in `use-provider-key-commands.ts`, which keeps the key
 * out of every cache. A failure is toasted once, in plain words, and never
 * with what the server said.
 *
 * Save belongs to this panel, not to the form inside it, which a new saved
 * revision replaces: "Saved" and closing still follow once a Save is done.
 * Outcomes are worded in the language shown when they arrive.
 */
export function ProviderKeyForm({ projectId, providerId, onSaved }: { projectId: string; providerId: AiKeyProvider; onSaved?: () => void }) {
  const query = useAiKeyConnection(projectId, providerId);
  const t = useT();
  const latest = useRef({ t, onSaved });
  useLayoutEffect(() => {
    latest.current = { t, onSaved };
  });
  const save = useProviderKeySave({ projectId, providerId });
  const report = useCallback((error: unknown) => toast.error(providerKeyErrorMessage(latest.current.t, error)), []);
  const saved = useCallback(() => {
    toast.success(latest.current.t('common.saved'));
    latest.current.onSaved?.();
  }, []);
  if (!query.data) return <Skeleton aria-hidden className="h-40 w-full" />;
  const provider = providerForForm(providerId, query.data.connection);
  // Keyed by site too: a key typed (or checked) for one site never carries over to another.
  return (
    <KeyForm
      canSave={query.data.canSave}
      key={`${projectId}:${providerFormKey(provider)}`}
      projectId={projectId}
      provider={provider}
      report={report}
      save={save}
      saved={saved}
    />
  );
}

function KeyForm({
  provider,
  projectId,
  canSave,
  save,
  saved,
  report,
}: {
  provider: WorkspaceAiProvider;
  projectId: string;
  canSave: boolean;
  save: ReturnType<typeof useProviderKeySave>;
  /** A Save succeeded: say so and close (the panel's, which outlives this form). */
  saved: () => void;
  /** A Check or Save failed: say so, in plain words. */
  report: (error: unknown) => void;
}) {
  const t = useT();
  const id = useId();
  const [apiKey, setApiKey] = useState('');
  const [answerModel, setAnswerModel] = useState(provider.answerModel ?? '');
  const [replace, setReplace] = useState(false);
  const keyCheck = useProviderKeyCheck({ projectId, providerId: provider.id, busy: save.isSaving });
  const options = modelOptions(keyCheck.models ?? undefined, provider);
  const form = providerKeyFormState({
    provider,
    canSave,
    apiKey,
    answerModel,
    replace,
    checked: keyCheck.models !== null,
    busy: save.saving || keyCheck.checking,
    modelCount: options.length,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (keyCheck.isChecking()) return;
    const pressedAt = keyCheck.edits();
    save.save(
      saveRequest({ provider, apiKey, answerModel, replace }),
      () => {
        // A key typed after the press is not this save's to clear (nor is a form that has since been replaced).
        if (keyCheck.edits() === pressedAt) {
          setApiKey('');
          keyCheck.retire();
        }
        saved();
      },
      report,
    );
  };
  return (
    <div className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4" data-testid="ai-key-form">
      <ol aria-label={t('settings.smartAi.step.title')} className="space-y-1.5 text-xs" data-testid="smart-ai-steps">
        {form.steps.map(({ step, done }, index) => (
          <li className="flex items-start gap-2" data-done={done || undefined} key={step}>
            <span
              aria-hidden
              className={`grid size-4.5 shrink-0 place-items-center rounded-full border text-xs tabular-nums ${done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}
            >
              {done ? <Check className="size-3" /> : index + 1}
            </span>
            <span className={done ? 'text-muted-foreground' : undefined}>
              {t(STEP_LABEL[step])}
              {done ? <span className="sr-only"> ({t('settings.smartAi.step.done')})</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-key`}>{t('settings.smartAi.apiKey')}</Label>
          <SecretInput
            disabled={!form.keyEnabled}
            id={`${id}-key`}
            name="ai-provider-api-key"
            onChange={(event) => {
              // A new key makes the checked model list (or a check still running), and a model chosen from it, stale.
              setApiKey(event.target.value);
              keyCheck.retire();
              setAnswerModel(provider.answerModel ?? '');
            }}
            value={apiKey}
          />
          <p className="text-muted-foreground text-xs" id={`${id}-key-hint`}>
            {t(provider.configured ? 'settings.smartAi.keepKey' : 'settings.smartAi.keyHint')}
          </p>
        </div>
        {form.showReplaceConsent ? (
          // The key hint above already says a new key needs this consent, so it describes the box rather than repeating under it.
          <CheckboxField
            aria-describedby={`${id}-key-hint`}
            checked={replace}
            label={t('settings.smartAi.replaceCredential')}
            onCheckedChange={setReplace}
          />
        ) : null}
        <Button
          disabled={!form.canCheck}
          loading={keyCheck.checking}
          onClick={() => keyCheck.check(checkRequest(provider, apiKey), report)}
          type="button"
          variant="outline"
        >
          {t('settings.smartAi.verifyModels')}
        </Button>
        <div className="space-y-2">
          <Label htmlFor={`${id}-model`}>{t('settings.smartAi.answerModel')}</Label>
          <Select
            items={options.map((model) => ({ value: model.id, label: model.id }))}
            onValueChange={(value) => setAnswerModel(value ?? '')}
            value={answerModel}
          >
            <SelectTrigger className="w-full min-w-0" disabled={!form.modelEnabled} id={`${id}-model`}>
              <SelectValue placeholder={t('settings.smartAi.chooseModel')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <bdi className="truncate">{model.id}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {keyCheck.models ? (
          <p className="text-muted-foreground text-xs" role="status">
            {t(options.length > 0 ? 'settings.smartAi.modelsVerified' : 'settings.smartAi.noModels')}
          </p>
        ) : null}
        <Button aria-describedby={form.shownSaveBlock ? `${id}-save-why` : undefined} disabled={!form.canSubmit} loading={save.saving} type="submit">
          {t('common.save')}
        </Button>
        {form.shownSaveBlock ? (
          <p className="text-muted-foreground text-xs" id={`${id}-save-why`}>
            {t(SAVE_BLOCK[form.shownSaveBlock])}
          </p>
        ) : null}
      </form>
    </div>
  );
}
