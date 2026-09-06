import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { getLocale } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { AlertTriangle, Braces, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDeleteOpenApi, useOpenApiConfiguration, useSyncOpenApi, useUpsertOpenApi } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { FIELD_INPUT, FIELD_MONO, Field, SectionHeader, Segmented } from './shared';

type SourceType = 'upload' | 'url' | 'repository';

export function OpenApiSection({ projectId }: { projectId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const { data: current, isPending } = useOpenApiConfiguration(projectId);
  const save = useUpsertOpenApi(projectId);
  const sync = useSyncOpenApi(projectId);
  const remove = useDeleteOpenApi(projectId);
  const [title, setTitle] = useState(() => t('settings.openapi'));
  const [path, setPath] = useState('api-reference');
  const [sourceType, setSourceType] = useState<SourceType>('upload');
  const [sourceValue, setSourceValue] = useState('');
  const [filename, setFilename] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!current) return;
    setTitle(current.title);
    setPath(current.path);
    setSourceType(current.source.type);
    setSourceValue(current.source.type === 'url' ? current.source.url : current.source.type === 'repository' ? current.source.path : '');
  }, [current]);

  const changeSource = (next: SourceType) => {
    setSourceType(next);
    let existingValue = '';
    if (current?.source.type === next) {
      if (current.source.type === 'url') existingValue = current.source.url;
      if (current.source.type === 'repository') existingValue = current.source.path;
    }
    setSourceValue(existingValue);
    setFilename('');
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error(t('settings.openapi.fileTooLarge'));
      return;
    }
    setFilename(file.name);
    setSourceValue(await file.text());
  };

  const submit = async () => {
    const source = sourceValue.trim()
      ? sourceType === 'upload'
        ? ({ type: 'upload', content: sourceValue } as const)
        : sourceType === 'url'
          ? ({ type: 'url', url: sourceValue.trim() } as const)
          : ({ type: 'repository', path: sourceValue.trim() } as const)
      : undefined;
    try {
      await save.mutateAsync({ title: title.trim(), path: path.trim(), source });
      toast.success(t('settings.openapi.saved'));
      setEditing(false);
      if (sourceType === 'upload') {
        setSourceValue('');
        setFilename('');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.openapi.saveError'));
    }
  };

  const refresh = async () => {
    try {
      await sync.mutateAsync();
      toast.success(t('settings.openapi.synced'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.openapi.syncError'));
    }
  };

  const deleteReference = async () => {
    const ok = await confirm({ title: t('settings.openapi.remove'), description: t('settings.openapi.deleteConfirm'), destructive: true });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast.success(t('settings.openapi.deleted'));
      setSourceType('upload');
      setSourceValue('');
      setFilename('');
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.openapi.deleteError'));
    }
  };

  return (
    <div>
      <SectionHeader icon={<Braces className="size-4" />} title={t('settings.openapi.title')} description={t('settings.openapi.description')} />

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
                <Button variant="outline" disabled={sync.isPending} onClick={() => void refresh()} size="sm">
                  <RefreshCw className={sync.isPending ? 'animate-spin' : ''} /> {t('settings.openapi.sync')}
                </Button>
              ) : null}
              <Button variant="outline" disabled={remove.isPending} onClick={() => void deleteReference()} size="sm">
                <Trash2 /> {t('settings.openapi.remove')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {!current && !editing ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <Braces className="mx-auto size-6 text-muted-foreground" />
          <h3 className="mt-3 font-semibold">{t('settings.openapi.emptyTitle')}</h3>
          <p className="mx-auto mt-1 max-w-lg text-muted-foreground text-sm">{t('settings.openapi.emptyDescription')}</p>
          <Button className="mt-4" onClick={() => setEditing(true)}>
            {t('settings.openapi.add')}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <>
          <Field label={t('settings.openapi.name')} hint={t('settings.openapi.nameHint')} htmlFor="openapi-title">
            <Input id="openapi-title" className={FIELD_INPUT} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
          </Field>
          <Field label={t('settings.openapi.path')} hint={t('settings.openapi.pathHint')} htmlFor="openapi-path">
            <Input className={FIELD_MONO} dir="ltr" id="openapi-path" maxLength={80} onChange={(event) => setPath(event.target.value)} value={path} />
          </Field>
          <Field label={t('settings.openapi.source')} hint={t('settings.openapi.sourceHint')}>
            <Segmented
              value={sourceType}
              onChange={changeSource}
              options={[
                { value: 'upload', label: t('settings.openapi.source.upload') },
                { value: 'url', label: t('settings.openapi.source.url') },
                { value: 'repository', label: t('settings.openapi.source.repository') },
              ]}
            />
          </Field>

          {sourceType === 'upload' ? (
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
                value={sourceValue}
                onChange={(event) => {
                  setSourceValue(event.target.value);
                  setFilename('');
                }}
              />
            </div>
          ) : (
            <Field
              label={sourceType === 'url' ? t('settings.openapi.url') : t('settings.openapi.repositoryPath')}
              hint={sourceType === 'url' ? t('settings.openapi.urlHint') : t('settings.openapi.repositoryHint')}
            >
              <Input
                className={FIELD_MONO}
                dir="ltr"
                value={sourceValue}
                onChange={(event) => setSourceValue(event.target.value)}
                placeholder={sourceType === 'url' ? 'https://api.example.com/openapi.yaml' : 'docs/openapi.yaml'}
              />
            </Field>
          )}

          <Alert className="mb-6">
            <AlertTriangle />
            <AlertTitle>{t('settings.openapi.securityTitle')}</AlertTitle>
            <AlertDescription>{t('settings.openapi.securityHint')}</AlertDescription>
          </Alert>

          <div className="flex flex-wrap justify-between gap-3">
            <div>
              {current ? (
                <Button variant="destructive" disabled={remove.isPending} onClick={() => void deleteReference()}>
                  <Trash2 /> {t('settings.openapi.remove')}
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
              {current && current.source.type !== 'upload' ? (
                <Button variant="outline" disabled={sync.isPending} onClick={() => void refresh()}>
                  <RefreshCw className={sync.isPending ? 'animate-spin' : ''} /> {t('settings.openapi.sync')}
                </Button>
              ) : null}
              <Button
                disabled={
                  isPending ||
                  save.isPending ||
                  !title.trim() ||
                  !path.trim() ||
                  (!current && !sourceValue.trim()) ||
                  (current && sourceType !== current.source.type && !sourceValue.trim())
                }
                onClick={() => void submit()}
              >
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
