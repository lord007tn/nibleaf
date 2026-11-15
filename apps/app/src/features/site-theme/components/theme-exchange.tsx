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
import { readTemplateText, type ThemeValues, themeValues } from '../model/theme';
import { useMounted } from './use-mounted';

type ImportMode = 'merge' | 'replace';

/** The one theme write in flight (a save or an import), for the site it started on. */
export type Operation = { kind: 'save' | 'apply'; identity: string };

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
 * Writers take turns through the form's operation (`acquire`/`release`): an
 * apply starts only if no save holds it, and a save started meanwhile (Ctrl+S
 * while the confirmation is open) wins; Apply can be chosen again after it.
 * With unsaved edits, Apply asks first; they are discarded only once the form
 * has read the import back, and only if nothing was edited meanwhile.
 * Otherwise they stay, against the applied theme, with Use theirs / Keep mine.
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
  acquire,
  release,
  discardAfterApply,
  readBack,
  onApplyingChange,
}: {
  projectId: string;
  slug: string;
  isDirty: boolean;
  isSaving: boolean;
  /** Counts the person's edits to the draft, so a discard asked for earlier never takes a newer one. */
  editMark: () => number;
  /** Takes the form's write operation, or `null` while another write holds it. */
  acquire: (kind: Operation['kind']) => Operation | null;
  release: (owned: Operation) => void;
  /** After an import was written over edits agreed to be discarded: `read` is what the read after the write returned, if it succeeded. */
  discardAfterApply: (mark: number, read: ThemeValues | undefined) => void;
  /** A later read (Refresh) returned these values. */
  readBack: (read: ThemeValues) => void;
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
  // The request whose answer the buttons wait on.
  const [pending, setPending] = useState<number>();
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
    if (mounted.current) setPending((current) => (current === id ? undefined : current));
  };

  const editText = (next: string) => {
    nextText();
    nextRequest();
    setText(next);
    setShown(undefined);
  };

  /**
   * A chosen file replaces the text only once it was read: one too large or
   * unreadable leaves the text, mode and preview as they were. A read that
   * answers after newer text (typed, or another file) says nothing.
   */
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const isCurrentText = nextText();
    if (file.size > MAX_THEME_TEMPLATE_BYTES) {
      toast.error(t('settings.theme.import.tooLarge'));
      return;
    }
    let contents: string;
    try {
      contents = await file.text();
    } catch {
      if (isCurrentText()) toast.error(t('settings.theme.import.previewError'));
      return;
    }
    if (!isCurrentText()) return;
    nextRequest();
    setText(contents);
    setShown(undefined);
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
    setPending(request.id);
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
    if (!shown || pending !== undefined || isSaving) return;
    const asked = shown;
    // The inputs the shown preview belongs to: any change retires it, and this apply with it.
    const askedWith = requests.current;
    const stillAsked = () => mounted.current && requests.current === askedWith;
    const mark = isDirty ? editMark() : undefined;
    if (mark !== undefined) {
      const discard = await confirm({
        title: t('settings.chrome.scope.discardTitle'),
        description: t('settings.unsaved.description'),
        cancelLabel: t('settings.unsaved.keep'),
        confirmLabel: t('settings.chrome.scope.discardConfirm'),
        destructive: true,
      });
      if (!(discard && stillAsked())) return;
    }
    // Taken before the request goes out: a save started while the dialog was open keeps it.
    const owned = acquire('apply');
    if (!owned) return;
    nextText();
    const request = nextRequest();
    setPending(request.id);
    setApplying(true);
    let written: Awaited<ReturnType<typeof exchange.apply>> | undefined;
    try {
      written = await exchange.apply(asked.template, asked.result.mode);
    } catch {
      // Nothing was written: the draft, the text and the preview all stay.
      if (mounted.current) toast.error(t('settings.theme.import.applyError'));
    } finally {
      release(owned);
      if (mounted.current) setApplying(false);
      settle(request.id);
    }
    if (!(written && mounted.current)) return;
    // The server holds the template now. The edits the person agreed to discard
    // go once the form shows it; any made since stay, against the applied theme.
    const read = written.readback && themeValues(written.readback.config);
    if (mark !== undefined) discardAfterApply(mark, read);
    if (request.current()) setShown({ template: asked.template, result: written.result });
    if (read) toast.success(t('settings.theme.import.applied'));
    else notReadBack();
  };

  /** Written, but the site could not be read back: the form still shows what it had, until Refresh reads it. */
  const notReadBack = () =>
    toast.warning(t('settings.theme.import.applied'), {
      description: t('settings.git.workflow.loadErrorHint'),
      action: {
        label: t('common.refresh'),
        onClick: () => {
          exchange.refresh().then(
            (project) => {
              if (mounted.current) readBack(themeValues(project.config));
            },
            () => {
              if (mounted.current) notReadBack();
            },
          );
        },
      },
    });

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
