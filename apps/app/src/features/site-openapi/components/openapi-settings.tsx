import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { getLocale } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { AlertTriangle, Braces, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DirtyStateReporter, FIELD_INPUT, FIELD_MONO, Field, Segmented, SettingsFormSkeleton } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import type { OpenApiConfiguration } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useRemoveSiteOpenApi, useSaveSiteOpenApi, useSiteOpenApi, useSyncSiteOpenApi } from '../api/hooks';
import {
  confirmedOpenApiValues,
  type OpenApiSourceType,
  type OpenApiValues,
  openApiSaveBlocker,
  openApiUpsertBody,
  openApiValues,
  switchSource,
} from '../model/openapi';

const MAX_FILE_BYTES = 5_000_000;

/** Site settings → OpenAPI: the site's API reference, from an upload, a URL or a repository file. */
export function OpenApiSettings({ projectId }: { projectId: string }) {
  const query = useSiteOpenApi(projectId);
  if (query.isPending) return <SettingsFormSkeleton />;
  if (query.isError && !query.data) return <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  return <OpenApiForm current={query.data ?? null} projectId={projectId} />;
}

function OpenApiForm({ projectId, current }: { projectId: string; current: OpenApiConfiguration | null }) {
  const t = useT();
  const confirm = useConfirm();
  const { save } = useSaveSiteOpenApi(projectId);
  const sync = useSyncSiteOpenApi(projectId);
  const remove = useRemoveSiteOpenApi(projectId);
  const defaultTitle = t('settings.openapi');
  const source = useMemo(() => openApiValues(current, defaultTitle), [current, defaultTitle]);
  // Not server data: which panel shows, and the chosen file's name.
  const [editing, setEditing] = useState(false);
  const [filename, setFilename] = useState('');

  const { form, ...draft } = useServerDraftForm<OpenApiValues>({
    identity: [projectId, 'openapi'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        const stored = await save(openApiUpsertBody(value));
        // The server's own values when its refetch came back, including "no reference" if it was
        // removed meanwhile; else what was sent, as the server stores it.
        const confirmed = stored !== undefined ? openApiValues(stored, defaultTitle) : confirmedOpenApiValues(outcome.baseline, value);
        const settled = outcome.succeeded(confirmed);
        // A save for a form since gone (another site, or the section left) says nothing.
        if (!outcome.isCurrent()) return 'failed';
        toast.success(t('settings.openapi.saved'));
        if (value.source.type === 'upload') setFilename('');
        // Edits typed while the save was in flight, or a conflict, stay open rather than hidden.
        if (settled) setEditing(false);
        return 'saved';
      } catch {
        outcome.failed();
        if (outcome.isCurrent()) toast.error(t('settings.openapi.saveError'));
        return 'failed';
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const saveBlocker = openApiSaveBlocker(values, current);
  const set = <K extends keyof OpenApiValues>(key: K, value: OpenApiValues[K]) => form.setFieldValue(key, value as never);

  const changeSource = (next: OpenApiSourceType) => {
    set('source', switchSource(current, next));
    setFilename('');
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('settings.openapi.fileTooLarge'));
      return;
    }
    setFilename(file.name);
    set('source', { type: 'upload', value: await file.text() });
  };

  // Disabled while saving: the save decides what the draft becomes, so nothing is discarded under it.
  const cancel = () => {
    if (draft.isSaving) return;
    draft.discard();
    setFilename('');
    setEditing(false);
  };

  const refresh = async () => {
    try {
      await sync.mutateAsync();
      toast.success(t('settings.openapi.synced'));
    } catch {
      toast.error(t('settings.openapi.syncError'));
    }
  };

  const deleteReference = async () => {
    const ok = await confirm({ title: t('settings.openapi.remove'), description: t('settings.openapi.deleteConfirm'), destructive: true });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success(t('settings.openapi.deleted'));
      // The refetch has settled: the baseline is now "no reference", so this starts a new one cleanly.
      draft.discard();
      setFilename('');
      setEditing(false);
    } catch {
      toast.error(t('settings.openapi.deleteError'));
    }
  };

  return (
    <div>
      <DirtyStateReporter dirty={draft.isDirty} />
      <PageHeader className="mb-8" description={t('settings.openapi.description')} title={t('settings.openapi.title')} />

      {current && !editing ? (
        <Alert className="mb-6">
          <Braces />
          <AlertTitle className="flex items-center gap-2">
            {t('settings.openapi.configured')} <Badge variant="secondary">{t(`settings.openapi.source.${current.source.type}`)}</Badge>
          </AlertTitle>
          <AlertDescription>
            <p>
              {t('settings.openapi.publishHint')} · <span dir="ltr">/{current.path}</span> ·{' '}
              {new Date(current.updatedAt).toLocaleString(localeTag(getLocale()))}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)} size="sm">
                {t('settings.openapi.edit')}
              </Button>
              {current.source.type !== 'upload' ? (
                <Button variant="outline" loading={sync.isPending} onClick={() => void refresh()} size="sm">
                  <RefreshCw /> {t('settings.openapi.sync')}
                </Button>
              ) : null}
              <Button variant="outline" loading={remove.isPending} onClick={() => void deleteReference()} size="sm">
                <Trash2 /> {t('settings.openapi.remove')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {!current && !editing ? (
        <EmptyState
          action={<Button onClick={() => setEditing(true)}>{t('settings.openapi.add')}</Button>}
          className="rounded-xl border border-border border-dashed"
          description={t('settings.openapi.emptyDescription')}
          headingLevel={2}
          icon={<Braces />}
          title={t('settings.openapi.emptyTitle')}
        />
      ) : null}

      {editing ? (
        <>
          {draft.conflicts.length > 0 ? (
            <Callout
              action={
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      for (const key of draft.conflicts) draft.resolveConflict(key, 'theirs');
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('forms.useTheirs')}
                  </Button>
                  <Button
                    onClick={() => {
                      for (const key of draft.conflicts) draft.resolveConflict(key, 'mine');
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t('forms.keepMine')}
                  </Button>
                </div>
              }
              className="mb-6"
              tone="warning"
            >
              {t('forms.changedElsewhere')}
            </Callout>
          ) : null}
          <Field label={t('settings.openapi.name')} hint={t('settings.openapi.nameHint')} htmlFor="openapi-title">
            <Input
              id="openapi-title"
              className={FIELD_INPUT}
              value={values.title}
              onChange={(event) => set('title', event.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label={t('settings.openapi.path')} hint={t('settings.openapi.pathHint')} htmlFor="openapi-path">
            <Input
              className={FIELD_MONO}
              dir="ltr"
              id="openapi-path"
              maxLength={80}
              onChange={(event) => set('path', event.target.value)}
              value={values.path}
            />
          </Field>
          <Field label={t('settings.openapi.source')} hint={t('settings.openapi.sourceHint')}>
            <Segmented
              value={values.source.type}
              onChange={changeSource}
              options={[
                { value: 'upload', label: t('settings.openapi.source.upload') },
                { value: 'url', label: t('settings.openapi.source.url') },
                { value: 'repository', label: t('settings.openapi.source.repository') },
              ]}
            />
          </Field>

          {values.source.type === 'upload' ? (
            <div className="mb-6 rounded-lg border border-dashed p-4">
              <label className="flex cursor-pointer items-center gap-2 font-medium text-sm" htmlFor="openapi-file">
                <FileUp className="size-4" /> {filename || t('settings.openapi.chooseFile')}
              </label>
              <Input
                id="openapi-file"
                className="mt-3"
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              <p className="mt-2 text-xs text-muted-foreground">{t('settings.openapi.uploadHint')}</p>
              <Textarea
                className="mt-3 min-h-32 font-mono text-xs"
                dir="ltr"
                placeholder={t('settings.openapi.pastePlaceholder')}
                value={values.source.value}
                onChange={(event) => {
                  set('source', { type: 'upload', value: event.target.value });
                  setFilename('');
                }}
              />
            </div>
          ) : (
            <Field
              label={values.source.type === 'url' ? t('settings.openapi.url') : t('settings.openapi.repositoryPath')}
              hint={values.source.type === 'url' ? t('settings.openapi.urlHint') : t('settings.openapi.repositoryHint')}
            >
              <Input
                className={FIELD_MONO}
                dir="ltr"
                value={values.source.value}
                onChange={(event) => set('source', { type: values.source.type, value: event.target.value })}
                placeholder={values.source.type === 'url' ? 'https://api.example.com/openapi.yaml' : 'docs/openapi.yaml'}
              />
            </Field>
          )}

          <Alert className="mb-6">
            <AlertTriangle />
            <AlertTitle>{t('settings.openapi.securityTitle')}</AlertTitle>
            <AlertDescription>{t('settings.openapi.securityHint')}</AlertDescription>
          </Alert>

          {saveBlocker ? (
            <p className="mb-3 text-end text-muted-foreground text-sm" id="openapi-save-reason">
              {t(saveBlocker)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              {current ? (
                <Button variant="destructive" loading={remove.isPending} onClick={() => void deleteReference()}>
                  <Trash2 /> {t('settings.openapi.remove')}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button disabled={draft.isSaving} variant="outline" onClick={cancel}>
                {t('common.cancel')}
              </Button>
              {current && current.source.type !== 'upload' ? (
                <Button variant="outline" loading={sync.isPending} onClick={() => void refresh()}>
                  <RefreshCw /> {t('settings.openapi.sync')}
                </Button>
              ) : null}
              <Button
                aria-describedby={saveBlocker ? 'openapi-save-reason' : undefined}
                disabled={Boolean(saveBlocker)}
                // Blocked, it stays in the tab order, so its reason (linked above) is read with it.
                focusableWhenDisabled
                loading={draft.isSaving}
                loadingText={t('common.saving')}
                onClick={() => void draft.submit()}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
