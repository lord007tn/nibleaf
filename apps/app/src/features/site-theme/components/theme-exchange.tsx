import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { MAX_THEME_TEMPLATE_BYTES } from '@nibleaf/shared/themes';
import { Download, FileJson, Upload } from 'lucide-react';
import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field, Segmented } from '@/components/project-settings/shared';
import type { ProjectThemeImportResult } from '@/hooks/api';
import { useThemeExchange } from '../api/hooks';
import { readTemplateText } from '../model/theme';
import { useMounted } from './use-mounted';

type ImportMode = 'merge' | 'replace';

/** A server answer, with the template it was for. Shown only while the text and mode it was asked with are unchanged. */
type Shown = { template: unknown; result: ProjectThemeImportResult };

const downloadText = (fileName: string, contents: string) => {
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
};

/**
 * Theme templates: export what the server stores, and import a template in two
 * steps. "Preview import" asks the server what the template would change and
 * writes nothing. "Apply to draft" then writes it at once, as main did: unlike
 * picking a preset it is not part of this form's draft, and Save is not needed.
 *
 * Writers take turns: Apply waits while a save is in flight (`isSaving`), and
 * the form refuses to save while an apply is (`onApplyingChange`). With unsaved
 * edits, Apply asks first; they are discarded only once the server confirms,
 * and only if nothing was edited meanwhile. Otherwise they stay, against the
 * applied theme, with the form's Use theirs / Keep mine.
 *
 * Render one per site (`key` it by the site): a late answer for another site
 * then has nowhere to land.
 */
export function ThemeExchange({
  projectId,
  slug,
  isDirty,
  isSaving,
  editMark,
  discardIfUntouched,
  onApplyingChange,
}: {
  projectId: string;
  slug: string;
  isDirty: boolean;
  isSaving: boolean;
  /** Counts the person's edits to the draft, so a discard asked for earlier never takes a newer one. */
  editMark: () => number;
  discardIfUntouched: (mark: number) => void;
  onApplyingChange: (applying: boolean) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const exchange = useThemeExchange(projectId);
  const mounted = useMounted();
  const noChangesId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [text, setText] = useState('');
  const [shown, setShown] = useState<Shown>();
  const [pending, setPending] = useState<{ kind: 'preview' | 'apply'; id: number }>();
  const [exporting, setExporting] = useState(false);
  // Bumped by every input change and every request: an answer applies only if
  // nothing was bumped after it was asked. Text has its own counter so a slow
  // file read never overwrites what was typed, chosen or applied since.
  const requests = useRef(0);
  const texts = useRef(0);
  const nextRequest = () => {
    requests.current += 1;
    const id = requests.current;
    return { id, current: () => mounted.current && requests.current === id };
  };
  const nextText = () => {
    texts.current += 1;
    const id = texts.current;
    return () => mounted.current && texts.current === id;
  };

  const applying = useRef(false);
  const setApplying = (next: boolean) => {
    applying.current = next;
    onApplyingChange(next);
  };
  const onApplyingChangeRef = useRef(onApplyingChange);
  onApplyingChangeRef.current = onApplyingChange;
  // Leaving mid-apply (another site) must not leave the form locked.
  useEffect(
    () => () => {
      if (applying.current) onApplyingChangeRef.current(false);
    },
    [],
  );

  const settle = (id: number) => {
    if (mounted.current) setPending((current) => (current?.id === id ? undefined : current));
  };

  const editText = (next: string) => {
    nextText();
    nextRequest();
    setText(next);
    setShown(undefined);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const isCurrentText = nextText();
    nextRequest();
    setText('');
    setShown(undefined);
    if (file.size > MAX_THEME_TEMPLATE_BYTES) {
      toast.error(t('settings.theme.import.tooLarge'));
      return;
    }
    const contents = await file.text();
    if (!isCurrentText()) return;
    setText(contents);
    const read = readTemplateText(contents);
    if ('error' in read) toast.error(t(read.error === 'tooLarge' ? 'settings.theme.import.tooLarge' : 'settings.theme.import.invalidJson'));
  };

  const preview = async () => {
    const read = readTemplateText(text);
    if ('error' in read) {
      toast.error(t(read.error === 'tooLarge' ? 'settings.theme.import.tooLarge' : 'settings.theme.import.invalidJson'));
      return;
    }
    const request = nextRequest();
    setShown(undefined);
    setPending({ kind: 'preview', id: request.id });
    try {
      const result = await exchange.preview(read.template, mode);
      if (request.current()) setShown({ template: read.template, result });
    } catch {
      if (request.current()) toast.error(t('settings.theme.import.previewError'));
    } finally {
      settle(request.id);
    }
  };

  const apply = async () => {
    if (!shown || pending || isSaving) return;
    const asked = shown;
    const mark = isDirty ? editMark() : undefined;
    if (mark !== undefined) {
      const discard = await confirm({
        title: t('settings.chrome.scope.discardTitle'),
        description: t('settings.unsaved.description'),
        cancelLabel: t('settings.unsaved.keep'),
        confirmLabel: t('settings.chrome.scope.discardConfirm'),
        destructive: true,
      });
      if (!discard || !mounted.current) return;
    }
    nextText();
    const request = nextRequest();
    setPending({ kind: 'apply', id: request.id });
    setApplying(true);
    try {
      const result = await exchange.apply(asked.template, asked.result.mode);
      if (!mounted.current) return;
      // The server holds the template now. The edits the person agreed to
      // discard go; any made since stay, against the applied theme.
      if (mark !== undefined) discardIfUntouched(mark);
      if (request.current()) setShown({ template: asked.template, result });
      toast.success(t('settings.theme.import.applied'));
    } catch {
      // Nothing was written: the draft, the text and the preview all stay.
      if (mounted.current) toast.error(t('settings.theme.import.applyError'));
    } finally {
      if (mounted.current) setApplying(false);
      settle(request.id);
    }
  };

  const exportTheme = async () => {
    setExporting(true);
    try {
      const { json } = await exchange.exportTemplate();
      if (!mounted.current) return;
      downloadText(`${slug || 'nibleaf'}-theme.json`, json);
      toast.success(t('settings.theme.exported'));
    } catch {
      if (mounted.current) toast.error(t('settings.theme.exportError'));
    } finally {
      if (mounted.current) setExporting(false);
    }
  };

  const result = shown?.result;
  const busy = pending !== undefined;

  return (
    <Field hint={t('settings.theme.exchangeHint')} label={t('settings.theme.exchange')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <FileJson className="size-5 text-primary" />
          <h3 className="mt-3 font-semibold">{t('settings.theme.exportTitle')}</h3>
          <p className="mt-1 text-muted-foreground text-xs">{t('settings.theme.exportHint')}</p>
          <Button className="mt-4" loading={exporting} onClick={exportTheme} type="button">
            <Download className="size-4" /> {t('settings.theme.export')}
          </Button>
        </div>
        <div className="rounded-xl border border-border p-4">
          <Upload className="size-5 text-primary" />
          <h3 className="mt-3 font-semibold">{t('settings.theme.importTitle')}</h3>
          <p className="mt-1 text-muted-foreground text-xs">{t('settings.theme.importHint')}</p>
          <input accept="application/json,.json" className="sr-only" onChange={handleFile} ref={fileInput} type="file" />
          <Button className="mt-3" onClick={() => fileInput.current?.click()} type="button" variant="outline">
            {t('settings.theme.chooseFile')}
          </Button>
        </div>
      </div>
      <Textarea
        aria-label={t('settings.theme.importJson')}
        className="mt-4 min-h-32 font-mono text-xs md:text-xs"
        dir="ltr"
        onChange={(event) => editText(event.target.value)}
        placeholder={t('settings.theme.importPlaceholder')}
        value={text}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Segmented
          className="max-w-[260px]"
          onChange={(next) => {
            nextRequest();
            setMode(next);
            setShown(undefined);
          }}
          options={[
            { value: 'merge', label: t('settings.theme.merge') },
            { value: 'replace', label: t('settings.theme.replace') },
          ]}
          value={mode}
        />
        <Button disabled={!text.trim()} loading={busy} onClick={preview} type="button" variant="outline">
          {t('settings.theme.previewImport')}
        </Button>
      </div>
      {result ? (
        <div className="mt-4 rounded-xl border border-border bg-muted/25 p-4" data-import-result={result.applied ? 'applied' : 'preview'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{t('settings.theme.importChanges', { count: result.changes.length })}</strong>
            {result.migratedFrom === 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-1 text-primary text-xs" dir="ltr">
                v0 → v1
              </span>
            ) : null}
          </div>
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-background">
            {result.changes.length === 0 ? (
              <p className="p-3 text-muted-foreground text-xs" id={noChangesId}>
                {t('settings.theme.noChanges')}
              </p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {result.changes.slice(0, 100).map((item) => (
                  <li className="grid gap-1 p-3" key={item.path}>
                    <code className="font-semibold text-primary" dir="ltr">
                      {item.path}
                    </code>
                    <span className="break-all text-muted-foreground" dir="ltr">
                      {JSON.stringify(item.before) ?? '—'} → {JSON.stringify(item.after) ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* An applied result is a record of what was written: nothing left to apply. */}
          {result.applied ? null : (
            <Button
              aria-describedby={result.changes.length === 0 ? noChangesId : undefined}
              className="mt-3"
              disabled={result.changes.length === 0}
              loading={busy || isSaving}
              onClick={apply}
              type="button"
            >
              {t('settings.theme.applyImport')}
            </Button>
          )}
        </div>
      ) : null}
    </Field>
  );
}
