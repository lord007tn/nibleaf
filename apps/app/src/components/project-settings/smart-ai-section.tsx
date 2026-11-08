import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton, SkeletonCard } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import type { WorkspaceAiProvider } from '@nibleaf/validators';
import { Link } from '@tanstack/react-router';
import { Bot, Check, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useCreateProjectSearchReindex } from '@/hooks/api';
import { useSaveWorkspaceAiConnection, useSelectWorkspaceAi, useWorkspaceAi, useWorkspaceAiModels } from '@/hooks/api/workspace-ai';
import { SectionHeader } from './shared';

/*
 * Failed requests are toasted once, in plain words, by the hooks
 * (meta.errorMessage); this section only reports what succeeded.
 */

type WorkspaceAi = NonNullable<ReturnType<typeof useWorkspaceAi>['data']>;

export function SmartAiSection({ project }: { project: Project }) {
  const t = useT();
  const query = useWorkspaceAi(project.id);
  return (
    <div className="min-w-0 space-y-6">
      <SectionHeader icon={<Bot className="size-4" />} title={t('settings.smartAi')} description={t('settings.smartAi.description')} />
      {query.isPending ? (
        <SmartAiSkeleton />
      ) : query.isError || !query.data ? (
        <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <SmartAiSettings data={query.data} project={project} refetch={query.refetch} />
      )}
    </div>
  );
}

/** Shaped like the loaded section: the status card, both provider cards and the index card. */
function SmartAiSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true" className="space-y-6">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-32 rounded-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {['openai', 'openrouter'].map((id) => (
          <div aria-hidden className="min-w-0 space-y-4 rounded-xl border bg-card p-5" key={id}>
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="h-9 w-48" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-40" />
            </div>
          </div>
        ))}
      </div>
      <SkeletonCard />
    </div>
  );
}

function SmartAiSettings({ data, project, refetch }: { data: WorkspaceAi; project: Project; refetch: () => Promise<unknown> }) {
  const t = useT();
  const select = useSelectWorkspaceAi(project.id);
  const confirm = useConfirm();
  const reindex = useCreateProjectSearchReindex(project.id);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };
  // The choice being saved, so only its own button shows that it is working.
  const selecting = select.isPending ? select.variables?.providerId : undefined;
  const ready = data.index.status === 'READY' && data.index.chunks > 0;
  const providerConfigured =
    data.selectedProvider === 'instance'
      ? data.instanceConfigured
      : data.providers.some((provider) => provider.id === data.selectedProvider && provider.verified);
  // Only report answers as enabled when the runtime can actually serve them.
  const answersUsable = data.selectedProvider === 'instance' ? data.instanceConfigured && data.instanceAnswersEnabled : providerConfigured;
  const enabled = data.selectedProvider !== 'disabled' && data.answersEnabled && answersUsable;
  // A run whose enqueue failed stays PENDING; the server re-enqueues it on retry.
  const indexActive = data.index.status === 'RUNNING' || (data.index.status === 'PENDING' && data.index.errorCode !== 'queue_unavailable');

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <Badge variant="outline">{t(enabled ? 'settings.smartAi.enabled' : 'settings.smartAi.disabled')}</Badge>
          <p className="mt-2 text-muted-foreground text-sm">{t('settings.smartAi.scope')}</p>
        </div>
        <Button
          disabled={select.isPending || data.selectedProvider === 'disabled'}
          loading={selecting === 'disabled'}
          onClick={async () => {
            const approved = await confirm({
              title: t('settings.smartAi.disable'),
              description: t('settings.smartAi.disableConfirm.description'),
              confirmLabel: t('settings.smartAi.disable'),
              destructive: true,
            });
            if (!approved) return;
            select.mutate({ providerId: 'disabled', answersEnabled: false }, { onSuccess: () => toast.success(t('common.saved')) });
          }}
          type="button"
          variant="outline"
        >
          {t('settings.smartAi.disable')}
        </Button>
      </div>
      {!data.encryptionConfigured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm" role="status">
          {t('settings.smartAi.encryptionMissing')}
        </p>
      )}
      {!data.infrastructureConfigured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm" role="status">
          {t('settings.smartAi.infrastructureMissing')}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {data.providers.map((provider) => (
          <ProviderCard
            key={`${provider.id}:${provider.revision}`}
            provider={provider}
            projectId={project.id}
            selected={data.selectedProvider === provider.id && enabled}
            canSave={data.encryptionConfigured}
            canEnable={data.infrastructureConfigured}
            busy={select.isPending}
            selecting={selecting === provider.id}
            onSelect={() =>
              select.mutate(
                { providerId: provider.id, answersEnabled: true, expectedRevision: provider.revision },
                { onSuccess: () => toast.success(t('common.saved')) },
              )
            }
          />
        ))}
      </div>
      {data.instanceConfigured && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-5">
          <div>
            <h3 className="font-semibold">{t('settings.smartAi.instance')}</h3>
            <p className="mt-1 text-muted-foreground text-sm">{t('settings.smartAi.instanceHint')}</p>
          </div>
          <Button
            disabled={!data.instanceAnswersEnabled || !data.infrastructureConfigured || select.isPending}
            loading={selecting === 'instance'}
            onClick={() => select.mutate({ providerId: 'instance', answersEnabled: true }, { onSuccess: () => toast.success(t('common.saved')) })}
            type="button"
            variant="outline"
          >
            {t(data.selectedProvider === 'instance' && enabled ? 'settings.smartAi.selected' : 'settings.smartAi.useProvider')}
          </Button>
        </div>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{t('settings.smartAi.indexTitle')}</h3>
          <Button loading={refreshing} onClick={() => void refresh()} size="sm" type="button" variant="ghost">
            <RefreshCw className="size-4" />
            {t('common.refresh')}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm" role="status">
          {t(!data.index.published ? 'settings.smartAi.indexUnpublished' : ready ? 'settings.smartAi.indexReady' : 'settings.smartAi.indexNotReady')}
        </p>
        <p className="break-all text-muted-foreground text-xs">
          {t('settings.smartAi.embeddingModel')}: <bdi>{data.embeddingModel}</bdi>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!data.index.published || !data.infrastructureConfigured || !providerConfigured || indexActive}
            loading={reindex.isPending}
            onClick={() => reindex.mutate()}
            type="button"
            variant="outline"
          >
            {t('settings.smartAi.reindex')}
          </Button>
          <Button nativeButton={false} render={<Link params={{ projectId: project.id }} to="/sites/$projectId" />} type="button" variant="outline">
            {t('settings.smartAi.reviewReader')}
          </Button>
        </div>
      </section>
      {/* Shown only once it can be used; today it needs a registration this server doesn't have. */}
      {data.openaiOAuth.available ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">{t('settings.smartAi.oauthTitle')}</h3>
          <p className="mt-2 text-muted-foreground text-sm">{t('settings.smartAi.oauthDescription')}</p>
          <a
            className="mt-3 inline-flex text-primary text-sm underline-offset-4 hover:underline"
            href={data.openaiOAuth.documentation}
            rel="noreferrer"
            target="_blank"
          >
            {t('settings.smartAi.oauthDocs')}
          </a>
        </section>
      ) : null}
      <p className="flex items-start gap-2 text-muted-foreground text-xs">
        <ShieldCheck className="size-4 shrink-0" />
        {t('settings.smartAi.security')}
      </p>
    </>
  );
}

function ProviderCard({
  provider,
  projectId,
  selected,
  canSave,
  canEnable,
  busy,
  selecting,
  onSelect,
}: {
  provider: WorkspaceAiProvider;
  projectId: string;
  selected: boolean;
  canSave: boolean;
  canEnable: boolean;
  /** Some Smart AI choice is being saved. */
  busy: boolean;
  /** This provider is the one being enabled. */
  selecting: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const id = useId();
  const [apiKey, setApiKey] = useState('');
  const [answerModel, setAnswerModel] = useState(provider.answerModel ?? '');
  const [replace, setReplace] = useState(false);
  const models = useWorkspaceAiModels(projectId);
  const save = useSaveWorkspaceAiConnection(projectId);
  const options = models.data?.models ?? (provider.answerModel ? [{ id: provider.answerModel }] : []);
  const pending = save.isPending || models.isPending || busy;
  const keyEntered = Boolean(apiKey.trim());
  const saved = provider.configured && !keyEntered && answerModel === (provider.answerModel ?? '');
  // The setup in order, each step ticked once it is done, so an empty model list
  // or a disabled Save is never a mystery.
  const steps = [
    { key: 'key', label: 'settings.smartAi.step.key', done: provider.configured || keyEntered },
    { key: 'check', label: 'settings.smartAi.step.check', done: models.isSuccess || provider.verified },
    { key: 'model', label: 'settings.smartAi.step.model', done: Boolean(answerModel) },
    { key: 'save', label: 'settings.smartAi.step.save', done: saved },
    { key: 'enable', label: 'settings.smartAi.step.enable', done: selected },
  ] as const;
  // Why Save or "Use this provider" can't be pressed yet, in plain words.
  const saveBlocked = !canSave
    ? 'settings.smartAi.why.encryption'
    : !provider.configured && !keyEntered
      ? 'settings.smartAi.why.pasteKey'
      : !answerModel
        ? 'settings.smartAi.why.chooseModel'
        : provider.configured && keyEntered && !replace
          ? 'settings.smartAi.why.replace'
          : null;
  const enableBlocked = selected ? null : !provider.verified ? 'settings.smartAi.why.saveFirst' : !canEnable ? 'settings.smartAi.why.server' : null;
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
        },
      },
    );
  };
  return (
    <section className="min-w-0 rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-muted-foreground" />
          {provider.id === 'openai' ? 'OpenAI' : 'OpenRouter'}
        </h3>
        <Badge variant="outline">
          {selected && <Check className="size-3" />}
          {t(selected ? 'settings.smartAi.selected' : provider.verified ? 'settings.smartAi.verified' : 'settings.smartAi.notConnected')}
        </Badge>
      </div>
      <ol aria-label={t('settings.smartAi.step.title')} className="mb-4 space-y-1.5 text-xs" data-testid="smart-ai-steps">
        {steps.map((step, index) => (
          <li className="flex items-start gap-2" data-done={step.done || undefined} key={step.key}>
            <span
              aria-hidden
              className={`grid size-4.5 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums ${step.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}
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
          <Input
            autoComplete="new-password"
            disabled={pending || !canSave}
            id={`${id}-key`}
            onChange={(event) => {
              setApiKey(event.target.value);
              models.reset();
              setAnswerModel(provider.answerModel ?? '');
            }}
            spellCheck={false}
            type="password"
            value={apiKey}
            dir="ltr"
          />
          <p className="text-muted-foreground text-xs">{t(provider.configured ? 'settings.smartAi.keepKey' : 'settings.smartAi.keyHint')}</p>
        </div>
        {provider.configured && apiKey && (
          <label className="flex items-start gap-2 text-sm">
            <input checked={replace} className="mt-1" onChange={(event) => setReplace(event.target.checked)} type="checkbox" />
            {t('settings.smartAi.replaceCredential')}
          </label>
        )}
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
        {models.isSuccess && (
          <p className="text-muted-foreground text-xs" role="status">
            {t(options.length > 0 ? 'settings.smartAi.modelsVerified' : 'settings.smartAi.noModels')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            aria-describedby={saveBlocked ? `${id}-save-why` : undefined}
            disabled={pending || saveBlocked !== null}
            loading={save.isPending}
            type="submit"
          >
            {t('common.save')}
          </Button>
          <Button
            aria-describedby={enableBlocked ? `${id}-enable-why` : undefined}
            disabled={pending || enableBlocked !== null || selected}
            loading={selecting}
            onClick={onSelect}
            type="button"
            variant="outline"
          >
            {t('settings.smartAi.useProvider')}
          </Button>
        </div>
        {saveBlocked && !saved ? (
          <p className="text-muted-foreground text-xs" id={`${id}-save-why`}>
            {t(saveBlocked)}
          </p>
        ) : null}
        {enableBlocked ? (
          <p className="text-muted-foreground text-xs" id={`${id}-enable-why`}>
            {t(enableBlocked)}
          </p>
        ) : null}
      </form>
    </section>
  );
}
