import { Button } from '@nibleaf/design-system/components/ui/button';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { WorkspaceAiProvider } from '@nibleaf/validators';
import { Check } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { SecretInput } from '@/components/secret-input';
import { useAiKeyConnection, useAiKeyModels, useSaveAiKey } from '../api/hooks';

/*
 * A site's own OpenAI or OpenRouter key, inside its source card on the AI
 * answers page: paste the key, check it (which loads its models), choose a
 * model, save. Choosing the source is the card's radio, not this form.
 * PR 4 of operations/ux/ai-and-integrations.md replaces it with one dialog.
 * Failed requests are toasted once, in plain words, by the mutations.
 */
export function ProviderKeyForm({
  projectId,
  providerId,
  onSaved,
}: {
  projectId: string;
  providerId: 'openai' | 'openrouter';
  onSaved?: () => void;
}) {
  const query = useAiKeyConnection(projectId, providerId);
  if (!query.data) return <Skeleton aria-hidden className="h-40 w-full" />;
  const { connection, canSave } = query.data;
  const provider: WorkspaceAiProvider = connection ?? {
    id: providerId,
    configured: false,
    revision: 0,
    verified: false,
    verifiedAt: null,
    answerModel: null,
  };
  return <KeyForm canSave={canSave} key={`${provider.id}:${provider.revision}`} onSaved={onSaved} projectId={projectId} provider={provider} />;
}

function KeyForm({
  provider,
  projectId,
  canSave,
  onSaved,
}: {
  provider: WorkspaceAiProvider;
  projectId: string;
  canSave: boolean;
  onSaved?: () => void;
}) {
  const t = useT();
  const id = useId();
  const [apiKey, setApiKey] = useState('');
  const [answerModel, setAnswerModel] = useState(provider.answerModel ?? '');
  const [replace, setReplace] = useState(false);
  const models = useAiKeyModels(projectId);
  const save = useSaveAiKey(projectId);
  const options = models.data?.models ?? (provider.answerModel ? [{ id: provider.answerModel }] : []);
  const pending = save.isPending || models.isPending;
  const keyEntered = Boolean(apiKey.trim());
  const saved = provider.configured && !keyEntered && answerModel === (provider.answerModel ?? '');
  // The setup in order, each step ticked once it is done, so an empty model list
  // or a disabled Save is never a mystery.
  const steps: ReadonlyArray<{ key: string; label: MessageKey; done: boolean }> = [
    { key: 'key', label: 'settings.smartAi.step.key', done: provider.configured || keyEntered },
    { key: 'check', label: 'settings.smartAi.step.check', done: models.isSuccess || provider.verified },
    { key: 'model', label: 'settings.smartAi.step.model', done: Boolean(answerModel) },
    { key: 'save', label: 'settings.smartAi.step.save', done: saved },
  ];
  // Why Save can't be pressed yet, in plain words.
  const saveBlocked: MessageKey | null = !canSave
    ? 'settings.smartAi.why.encryption'
    : !provider.configured && !keyEntered
      ? 'settings.smartAi.why.pasteKey'
      : !answerModel
        ? 'settings.smartAi.why.chooseModel'
        : provider.configured && keyEntered && !replace
          ? 'settings.smartAi.why.replace'
          : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        providerId: provider.id,
        answerModel,
        expectedRevision: provider.revision,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(replace ? { replaceCredential: true } : {}),
      },
      {
        onSuccess: () => {
          setApiKey('');
          models.reset();
          toast.success(t('common.saved'));
          onSaved?.();
        },
      },
    );
  };
  return (
    <div className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4" data-testid="ai-key-form">
      <ol aria-label={t('settings.smartAi.step.title')} className="space-y-1.5 text-xs" data-testid="smart-ai-steps">
        {steps.map((step, index) => (
          <li className="flex items-start gap-2" data-done={step.done || undefined} key={step.key}>
            <span
              aria-hidden
              className={`grid size-4.5 shrink-0 place-items-center rounded-full border text-xs tabular-nums ${step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}
            >
              {step.done ? <Check className="size-3" /> : index + 1}
            </span>
            <span className={step.done ? 'text-muted-foreground' : undefined}>
              {t(step.label)}
              {step.done ? <span className="sr-only"> ({t('settings.smartAi.step.done')})</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-key`}>{t('settings.smartAi.apiKey')}</Label>
          <SecretInput
            disabled={pending || !canSave}
            id={`${id}-key`}
            name="ai-provider-api-key"
            onChange={(event) => {
              setApiKey(event.target.value);
              models.reset();
              setAnswerModel(provider.answerModel ?? '');
            }}
            value={apiKey}
          />
          <p className="text-muted-foreground text-xs">{t(provider.configured ? 'settings.smartAi.keepKey' : 'settings.smartAi.keyHint')}</p>
        </div>
        {provider.configured && apiKey ? (
          <label className="flex items-start gap-2 text-sm">
            <input checked={replace} className="mt-1" onChange={(event) => setReplace(event.target.checked)} type="checkbox" />
            {t('settings.smartAi.replaceCredential')}
          </label>
        ) : null}
        <Button
          disabled={pending || (!apiKey.trim() && !provider.configured)}
          loading={models.isPending}
          onClick={() => models.mutate({ providerId: provider.id, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })}
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
            <SelectTrigger className="w-full min-w-0" disabled={pending || options.length === 0} id={`${id}-model`}>
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
        {models.isSuccess ? (
          <p className="text-muted-foreground text-xs" role="status">
            {t(options.length > 0 ? 'settings.smartAi.modelsVerified' : 'settings.smartAi.noModels')}
          </p>
        ) : null}
        <Button
          aria-describedby={saveBlocked && !saved ? `${id}-save-why` : undefined}
          disabled={pending || saveBlocked !== null}
          loading={save.isPending}
          type="submit"
        >
          {t('common.save')}
        </Button>
        {saveBlocked && !saved ? (
          <p className="text-muted-foreground text-xs" id={`${id}-save-why`}>
            {t(saveBlocked)}
          </p>
        ) : null}
      </form>
    </div>
  );
}
