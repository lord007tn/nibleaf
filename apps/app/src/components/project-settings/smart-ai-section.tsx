import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import type { WorkspaceAiProvider } from '@nibleaf/validators';
import { Link } from '@tanstack/react-router';
import { Bot, Check, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useCreateProjectSearchReindex } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { useSaveWorkspaceAiConnection, useSelectWorkspaceAi, useWorkspaceAi, useWorkspaceAiModels } from '@/hooks/api/workspace-ai';
import { SectionHeader } from './shared';

function AiError({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  const key =
    error instanceof ApiResponseError && error.code === 'integration:credentials_invalid'
      ? 'settings.smartAi.invalidKey'
      : error instanceof ApiResponseError && error.status === 409
        ? 'settings.smartAi.conflict'
        : 'settings.smartAi.error';
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm" role="alert">
      {t(key)}
    </p>
  );
}

export function SmartAiSection({ project }: { project: Project }) {
  const t = useT();
  const query = useWorkspaceAi(project.id);
  const select = useSelectWorkspaceAi(project.id);
  const reindex = useCreateProjectSearchReindex(project.id);
  const data = query.data;
  if (query.isPending)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  if (query.isError || !data) return <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
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
    <div className="min-w-0 space-y-6">
      <SectionHeader icon={<Bot className="size-4" />} title={t('settings.smartAi')} description={t('settings.smartAi.description')} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
        <div>
          <Badge variant="outline">{t(enabled ? 'settings.smartAi.enabled' : 'settings.smartAi.disabled')}</Badge>
          <p className="mt-2 text-muted-foreground text-sm">{t('settings.smartAi.scope')}</p>
        </div>
        <Button
          disabled={select.isPending || data.selectedProvider === 'disabled'}
          onClick={() => select.mutate({ providerId: 'disabled', answersEnabled: false }, { onSuccess: () => toast.success(t('common.saved')) })}
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
      <AiError error={select.error} />
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
          <Button disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" type="button" variant="ghost">
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
            disabled={!data.index.published || !data.infrastructureConfigured || !providerConfigured || reindex.isPending || indexActive}
            onClick={() => reindex.mutate(undefined, { onSuccess: () => void query.refetch() })}
            type="button"
            variant="outline"
          >
            {reindex.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t('settings.smartAi.reindex')}
          </Button>
          <Button nativeButton={false} render={<Link params={{ projectId: project.id }} to="/sites/$projectId" />} type="button" variant="outline">
            {t('settings.smartAi.reviewReader')}
          </Button>
        </div>
        <AiError error={reindex.error} />
      </section>
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
      <p className="flex items-start gap-2 text-muted-foreground text-xs">
        <ShieldCheck className="size-4 shrink-0" />
        {t('settings.smartAi.security')}
      </p>
    </div>
  );
}

function ProviderCard({
  provider,
  projectId,
  selected,
  canSave,
  canEnable,
  busy,
  onSelect,
}: {
  provider: WorkspaceAiProvider;
  projectId: string;
  selected: boolean;
  canSave: boolean;
  canEnable: boolean;
  busy: boolean;
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
          onClick={() => models.mutate({ providerId: provider.id, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })}
          type="button"
          variant="outline"
        >
          {models.isPending && <LoaderCircle className="size-4 animate-spin" />}
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
        <AiError error={models.error ?? save.error} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              pending || !canSave || !answerModel || (!provider.configured && !apiKey.trim()) || (provider.configured && Boolean(apiKey) && !replace)
            }
            type="submit"
          >
            {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t('common.save')}
          </Button>
          <Button disabled={pending || !provider.verified || !canEnable || selected} onClick={onSelect} type="button" variant="outline">
            {t('settings.smartAi.useProvider')}
          </Button>
        </div>
      </form>
    </section>
  );
}
