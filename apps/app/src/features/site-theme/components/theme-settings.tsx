import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { resolveTheme, THEME_COLOR_KEYS, THEME_PRESET_IDS, type ThemeColorKey } from '@nibleaf/shared/themes';
import { useStore } from '@tanstack/react-form';
import { LayoutTemplate, RotateCcw, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { accentTextAdjustments } from '@/components/project-settings/accent-text-adjustments';
import { Field, SectionHeader, Segmented } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { deepEqual } from '@/lib/forms/server-draft';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveTheme } from '../api/hooks';
import {
  type ColorMode,
  chooseAppearance,
  type HistoryEntry,
  presetTheme,
  previewConfig,
  problemTokens,
  recordHistory,
  type SaveMark,
  sentThemeValues,
  settleHistory,
  shownAppearance,
  type ThemeValues,
  themeProblems,
  tokenKey,
  undoStep,
  usableHistory,
  withColor,
  withPart,
} from '../model/theme';
import { themePreviewText } from '../theme-preview-messages';
import { ThemeExchange } from './theme-exchange';
import { ThemeOptionSelect, ThemePresetThumbnail, ThemePreview } from './theme-preview';
import { acquireWrite, type Operation, releaseWrite, useWriteFor, writeFor } from './theme-writes';

const NOTHING_LEFT: ReadonlySet<string> = new Set();

/**
 * Site configuration → Themes, in the editor's Configuration tab. One
 * explicit-save draft holds the authored theme and the default appearance;
 * the page's save bar saves or discards it. The preview language, preview mode
 * and which mode's colours are being edited are view state, never saved.
 */
export function ThemeSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <ThemeForm project={project} />
    </SaveRegionProvider>
  );
}

function ThemeForm({ project }: { project: Project }) {
  const t = useT();
  const saveTheme = useSaveTheme(project.id);
  const config = project.config;
  const storedTheme = config?.theme;
  const storedAppearance = config?.styling?.theme;
  const source = useMemo<ThemeValues>(
    () => ({ theme: storedTheme ?? undefined, appearance: storedAppearance ?? undefined }),
    [storedTheme, storedAppearance],
  );
  const identity = [project.id, 'theme'] as const;
  const identityKey = JSON.stringify(identity);

  // Whether the last confirmed save left nothing to save or resolve (`succeeded`'s answer).
  const settled = useRef(true);
  // The baseline the next save is judged against: it sends only what differs from it.
  const baselineNow = useRef(source);
  // The save in flight, so an edit made during it is recorded as such for Undo.
  const activeSave = useRef<number | undefined>(undefined);
  const saveIds = useRef(0);
  const [mark, setMark] = useState<SaveMark>();
  // The site's write turn a Save took (see `submit`), for its request to take
  // over: a site switch ends `submit()` while the request runs on (#816), so the
  // request gives the turn back once it and its readback settle (#824).
  const handover = useRef<{ owned: Operation; taken: boolean } | undefined>(undefined);

  const { form, ...draft } = useServerDraftForm<ThemeValues>({
    identity,
    source,
    toSent: (value) => sentThemeValues(value, baselineNow.current),
    onSubmit: async (value, save) => {
      // The owner's authored colours must pass, as the API checks them (PUB-006).
      if (themeProblems(previewConfig(config, value)).length > 0) {
        save.failed();
        return 'invalid';
      }
      saveIds.current += 1;
      const id = saveIds.current;
      const sent = sentThemeValues(value, save.baseline);
      const turn = handover.current;
      handover.current = undefined;
      if (turn) turn.taken = true;
      activeSave.current = id;
      setMark({ id, submitted: value, reached: [sent] });
      try {
        const confirmed = await saveTheme(value, save.baseline);
        // Before the answer becomes the baseline, so edits made during this save move onto it.
        if (save.isCurrent()) setMark((current) => (current?.id === id ? { ...current, reached: [sent, confirmed] } : current));
        settled.current = save.succeeded(confirmed);
        if (save.isCurrent()) toast.success(t('settings.theme.savedDraft'));
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a site this form has since left, or a form since unmounted, says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      } finally {
        if (activeSave.current === id) activeSave.current = undefined;
        if (turn) releaseWrite(turn.owned);
      }
    },
  });
  baselineNow.current = draft.baseline;

  // Undo history, and when a contrast problem shows (its colour was left, or a
  // save was tried). Both belong to one site: another starts without them.
  // Only a settled save, Discard or that change clears the shown problems.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [left, setLeft] = useState<ReadonlySet<string>>(NOTHING_LEFT);
  const [submitted, setSubmitted] = useState(false);
  const [stateFor, setStateFor] = useState(identityKey);
  if (stateFor !== identityKey) {
    setStateFor(identityKey);
    setHistory([]);
    setLeft(NOTHING_LEFT);
    setSubmitted(false);
    setMark(undefined);
  }
  const edits = useRef(0);

  // Save and Apply both write the theme: one at a time per site, through the
  // site's write turn (see `theme-writes`). Taking it is synchronous, so
  // neither can start between the other's check and its request; each gives
  // back only its own. The form shows this site's write as saving (also one
  // left running by an earlier mount of this site), and another site's never.
  const identityNow = useRef(identityKey);
  identityNow.current = identityKey;
  const writing = useWriteFor(identityKey) !== undefined;
  const busy = useCallback(() => writeFor(identityNow.current) !== undefined, []);
  const acquire = useCallback((kind: Operation['kind']) => acquireWrite(identityNow.current, kind), []);

  const [previewMode, setPreviewMode] = useState<ColorMode>(() => (source.appearance === 'dark' ? 'dark' : 'light'));
  const [previewArabic, setPreviewArabic] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('light');

  const values = useStore(form.store, (state) => state.values) as ThemeValues;
  const shownConfig = previewConfig(config, values);
  // What ships (accent shaded to read as text) drives the preview; the colour
  // inputs and the save check keep the owner's authored colours (PUB-006).
  const resolved = resolveTheme(shownConfig);
  const authored = resolveTheme(shownConfig, { authoredAccent: true });
  // The radius control edits the theme; Styling's radius still drives the reader preview.
  const themeRadius = resolveTheme({ theme: values.theme }).layout.radius;
  const stylingRadius = config?.styling?.radius;
  const radiusSourceId = useId();
  const problems = themeProblems(shownConfig);
  const accentAdjustments = accentTextAdjustments(authored, resolved);
  const shownProblems = problems.filter((issue) => submitted || problemTokens(issue).some((key) => left.has(tokenKey(issue.mode, key))));
  const invalidToken = (key: ThemeColorKey) => shownProblems.some((issue) => issue.mode === colorMode && problemTokens(issue).includes(key));
  const contrastId = useId();

  const setValues = useCallback(
    (next: ThemeValues) => {
      const current = form.state.values as ThemeValues;
      for (const key of ['theme', 'appearance'] as const) {
        if (!deepEqual(current[key], next[key])) (form.setFieldValue as (field: string, value: unknown) => void)(key, next[key]);
      }
    },
    [form],
  );
  /** One edit: the draft before it goes on the Undo history, with the baseline (and save) it was made against. */
  const change = (edit: (current: ThemeValues) => ThemeValues) => {
    const current = form.state.values as ThemeValues;
    const next = edit(current);
    if (deepEqual(next, current)) return;
    edits.current += 1;
    setHistory((items) => recordHistory(items, { values: current, baseline: baselineNow.current, save: activeSave.current }));
    setValues(next);
  };
  const undo = () => {
    const step = undoStep(history, baselineNow.current, mark);
    if (!step) return;
    edits.current += 1;
    setValues(step.values);
    setHistory(step.history);
  };
  const canUndo = usableHistory(history, draft.baseline, mark).length > 0;

  /**
   * Edits the person agreed to discard for an import, and `read`: what a read
   * made after the write returned for this form (none yet when that read
   * failed). See `discardIfRead`.
   */
  const discardOnRead = useRef<{ since: number; identity: string; read?: ThemeValues } | undefined>(undefined);

  const retire = useCallback(() => {
    setHistory([]);
    setLeft(NOTHING_LEFT);
    setSubmitted(false);
  }, []);

  const { submit: submitDraft, discard: discardDraft, isSaving, resolveConflict, settlement: draftSettlement } = draft;
  /**
   * What the page's save bar reads to decide "Saved": the draft's own
   * settlement (theme and appearance, the form's only authored state), and not
   * settled while any write for this site holds its turn (an import, or a save
   * an earlier mount of this site left running), which shows as submitting.
   * Stable, live, and on the draft's identity generation.
   */
  const settlement = useCallback(() => {
    const { settled, generation } = draftSettlement();
    return { settled: settled && !busy(), generation };
  }, [busy, draftSettlement]);
  // Save, Enter and Ctrl+S all come through here. The page's save bar disables
  // Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    // An import being applied is a write too: the save waits its turn.
    const owned = acquire('save');
    if (!owned) return 'failed' as const;
    const turn = { owned, taken: false };
    handover.current = turn;
    try {
      settled.current = true;
      setSubmitted(true);
      const outcome = await submitDraft();
      if (outcome === 'invalid') {
        // Mark the failing colours now, in a mode that has one, so the bar can focus it.
        const failing = themeProblems(previewConfig(config, form.state.values as ThemeValues));
        flushSync(() => {
          setSubmitted(true);
          setColorMode((mode) => (failing.some((issue) => issue.mode === mode) ? mode : (failing[0]?.mode ?? mode)));
        });
      }
      // A settled save leaves nothing to undo or show. An unsettled one (edits
      // made during it, or a value changed elsewhere) keeps the draft, its
      // conflict, its shown problems and the Undo made during it.
      if (outcome === 'saved' && settled.current) retire();
      return outcome === 'busy' ? 'failed' : outcome;
    } finally {
      if (handover.current === turn) handover.current = undefined;
      // A save that sent its request gives the turn back when that settles; any other exit gives it back now.
      if (!turn.taken) releaseWrite(owned);
    }
  }, [acquire, config, form, retire, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving || busy()) return;
    discardDraft();
    retire();
  }, [busy, discardDraft, isSaving, retire]);
  const formProps = useSaveRegionForm('site-theme', {
    isDirty: draft.isDirty,
    isSubmitting: isSaving || writing,
    submit,
    discard,
    settlement,
  });

  /**
   * An import was written over edits the person agreed to discard. They go
   * once a read made after the write has answered and the form's baseline holds
   * what it returned (the form adopts a read on its next render), equal values
   * included; and only if nothing was edited since and the site is the same.
   * Until then the draft stays as it is.
   */
  const discardIfRead = useCallback(() => {
    const waiting = discardOnRead.current;
    if (!waiting?.read) return;
    if (waiting.identity !== identityNow.current || edits.current !== waiting.since) {
      discardOnRead.current = undefined;
      return;
    }
    if (!deepEqual(baselineNow.current, waiting.read)) return;
    discardOnRead.current = undefined;
    discardDraft();
    retire();
  }, [discardDraft, retire]);
  const discardAfterApply = useCallback(
    (since: number, read: ThemeValues | undefined) => {
      discardOnRead.current = { since, identity: identityNow.current, read };
      discardIfRead();
    },
    [discardIfRead],
  );
  /** A later read (Refresh) answered with these values: it completes a discard still waiting for one. */
  const readBack = useCallback(
    (read: ThemeValues) => {
      const waiting = discardOnRead.current;
      if (!waiting) return;
      discardOnRead.current = { ...waiting, read };
      discardIfRead();
    },
    [discardIfRead],
  );

  // The baseline moved (a read, a save's echo or answer): retire the Undo it
  // overtakes, and finish a discard waiting for the form to hold its read.
  // A save's answer (its mark) reconciles the entries made during it, as the baseline it reached does.
  useEffect(() => {
    setHistory((items) => settleHistory(items, draft.baseline, mark));
    discardIfRead();
  }, [discardIfRead, draft.baseline, mark]);
  const leave = (key: string) => setLeft((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));

  return (
    <form noValidate {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<LayoutTemplate className="size-4" />} title={t('settings.theme.title')} />
      <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <strong>{t('settings.theme.draftTitle')}</strong>
        <p className="mt-1 text-muted-foreground">{t('settings.theme.draftHint')}</p>
      </div>

      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  // Their theme replaces the draft's whole: no Undo back across it.
                  for (const key of draft.conflicts) resolveConflict(key, 'theirs');
                  setHistory([]);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button
                onClick={() => {
                  // Keeps the whole authored theme (and appearance) the draft holds.
                  for (const key of draft.conflicts) resolveConflict(key, 'mine');
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <Field hint={t('settings.theme.galleryHint')} label={t('settings.theme.gallery')}>
        <div className="grid gap-3 lg:grid-cols-3">
          {THEME_PRESET_IDS.map((presetId) => {
            const active = resolved.id === presetId;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'cursor-pointer rounded-xl border p-3 text-start outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50',
                  active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/45',
                )}
                key={presetId}
                onClick={() => change((current) => ({ ...current, theme: presetTheme(presetId) }))}
                type="button"
              >
                <ThemePresetThumbnail presetId={presetId} />
                <strong>{t(`settings.theme.preset.${presetId}.name`)}</strong>
                <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">{t(`settings.theme.preset.${presetId}.description`)}</span>
                <span className="mt-2 block text-primary text-xs">{t(`settings.theme.preset.${presetId}.rationale`)}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field hint={t('settings.theme.appearanceHint')} label={t('settings.theme.appearance')}>
        <Segmented
          className="max-w-[340px]"
          onChange={(next) => change((current) => ({ ...current, appearance: chooseAppearance(next, baselineNow.current) }))}
          options={[
            { value: 'light', label: t('settings.styling.theme.light') },
            { value: 'dark', label: t('settings.styling.theme.dark') },
            { value: 'system', label: t('settings.styling.theme.system') },
          ]}
          value={shownAppearance(values)}
        />
      </Field>

      <Field hint={t('settings.theme.layoutHint')} label={t('settings.theme.layout')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['shell', 'settings.theme.shell', ['reference', 'editorial', 'console']],
              ['density', 'settings.theme.density', ['compact', 'comfortable', 'relaxed']],
              ['contentWidth', 'settings.theme.contentWidth', ['focused', 'balanced', 'wide']],
              ['header', 'settings.theme.header', ['inline', 'stacked', 'floating']],
              ['sidebar', 'settings.theme.sidebar', ['bordered', 'soft', 'rail']],
              ['navigation', 'settings.theme.navigation', ['tree', 'sectioned', 'compact']],
            ] as const
          ).map(([key, label, options]) => (
            <ThemeOptionSelect
              key={key}
              label={t(label)}
              onChange={(next) => change((current) => ({ ...current, theme: withPart(current.theme, config, 'layout', key, next) }))}
              options={options}
              value={resolved.layout[key]}
            />
          ))}
          <fieldset aria-describedby={stylingRadius ? radiusSourceId : undefined} aria-label={t('settings.styling.radius.label')} className="min-w-0">
            <ThemeOptionSelect
              label={t('settings.styling.radius.label')}
              onChange={(next) => change((current) => ({ ...current, theme: withPart(current.theme, config, 'layout', 'radius', next) }))}
              options={['sharp', 'rounded', 'pill']}
              value={themeRadius}
            />
            {stylingRadius ? (
              <p className="mt-2 text-muted-foreground text-xs leading-snug" data-radius-override id={radiusSourceId}>
                <span className="block font-medium">
                  {t('settings.styling.title')}: {t(`settings.styling.radius.${stylingRadius}`)}
                </span>
                {t('settings.styling.radius.override')}
              </p>
            ) : null}
          </fieldset>
        </div>
      </Field>

      <Field hint={t('settings.theme.componentsHint')} label={t('settings.theme.components')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ['codeBlocks', 'settings.theme.code', ['system', 'dim', 'vivid']],
              ['callouts', 'settings.theme.callouts', ['soft', 'outline', 'solid']],
              ['cards', 'settings.theme.cards', ['bordered', 'lifted', 'flat']],
              ['tabs', 'settings.theme.tabs', ['underline', 'pills', 'boxed']],
              ['tables', 'settings.theme.tables', ['lines', 'rows', 'cards']],
            ] as const
          ).map(([key, label, options]) => (
            <ThemeOptionSelect
              key={key}
              label={t(label)}
              onChange={(next) => change((current) => ({ ...current, theme: withPart(current.theme, config, 'components', key, next) }))}
              options={options}
              value={resolved.components[key]}
            />
          ))}
        </div>
      </Field>

      <Field hint={t('settings.theme.colorsHint')} label={t('settings.theme.colors')}>
        <Segmented
          className="mb-4 max-w-[220px]"
          onChange={setColorMode}
          options={[
            { value: 'light', label: t('settings.styling.theme.light') },
            { value: 'dark', label: t('settings.styling.theme.dark') },
          ]}
          value={colorMode}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_COLOR_KEYS.map((key) => {
            const invalid = invalidToken(key);
            return (
              <label className="grid gap-1.5 text-xs" key={key}>
                <span className="font-medium">{t(`settings.theme.color.${key}`)}</span>
                <span
                  className={cn(
                    'flex items-center gap-2 rounded-md border bg-background p-1.5',
                    invalid ? 'border-destructive' : 'border-input-edge',
                  )}
                >
                  <input
                    aria-describedby={invalid ? contrastId : undefined}
                    aria-invalid={invalid || undefined}
                    aria-label={t(`settings.theme.color.${key}`)}
                    className="size-7 cursor-pointer border-0 bg-transparent p-0"
                    onBlur={() => leave(tokenKey(colorMode, key))}
                    onChange={(event) =>
                      change((current) => ({ ...current, theme: withColor(current.theme, config, colorMode, key, event.target.value) }))
                    }
                    type="color"
                    value={authored.colors[colorMode][key]}
                  />
                  <code className="text-xs" dir="ltr">
                    {authored.colors[colorMode][key]}
                  </code>
                </span>
              </label>
            );
          })}
        </div>
        {problems.length > 0 ? (
          <div className="mt-3 rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-destructive text-xs" id={contrastId} role="alert">
            <strong>{t('settings.theme.contrastTitle')}</strong>
            <ul className="mt-1 list-disc ps-5">
              {problems.map((issue) => (
                <li key={`${issue.mode}-${issue.pair}`}>
                  <span dir="ltr">{`${issue.mode}: ${issue.pair} ${issue.ratio.toFixed(2)}:1 < ${issue.required}:1`}</span>
                </li>
              ))}
            </ul>
            {shownProblems.length > 0 ? <p className="mt-2 font-medium">{t('settings.theme.contrastBlocked')}</p> : null}
          </div>
        ) : (
          <p className="mt-3 text-success text-xs">{t('settings.theme.contrastPass')}</p>
        )}
        {accentAdjustments.length > 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs" data-accent-adjustments="">
            <strong>{t('settings.theme.accentAdjustedTitle')}</strong>
            <p className="mt-1 text-muted-foreground">{t('settings.theme.accentAdjustedBody')}</p>
            <ul className="mt-2 grid gap-1.5">
              {accentAdjustments.map((adjustment) => (
                <li className="flex flex-wrap items-center gap-2" dir="ltr" key={adjustment.mode}>
                  <span className="min-w-9 text-muted-foreground" dir="auto">
                    {t(adjustment.mode === 'light' ? 'settings.styling.theme.light' : 'settings.styling.theme.dark')}
                  </span>
                  <span aria-hidden className="size-3.5 rounded-sm border border-border" style={{ background: adjustment.from }} />
                  <code>{`${adjustment.from} ${adjustment.fromRatio.toFixed(2)}:1`}</code>
                  <span aria-hidden>→</span>
                  <span aria-hidden className="size-3.5 rounded-sm border border-border" style={{ background: adjustment.to }} />
                  <code>{`${adjustment.to} ${adjustment.toRatio.toFixed(2)}:1`}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Field>

      <Field hint={t('settings.theme.previewHint')} label={t('settings.theme.preview')}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented
            className="max-w-[220px]"
            onChange={setPreviewMode}
            options={[
              { value: 'light', label: t('settings.styling.theme.light') },
              { value: 'dark', label: t('settings.styling.theme.dark') },
            ]}
            value={previewMode}
          />
          <Button
            dir={previewArabic ? 'ltr' : 'rtl'}
            lang={previewArabic ? 'en' : 'ar'}
            onClick={() => setPreviewArabic((value) => !value)}
            type="button"
            variant="outline"
          >
            {previewArabic
              ? themePreviewText('settings.theme.preview.switchEnglish', 'en')
              : themePreviewText('settings.theme.preview.switchArabic', 'ar')}
          </Button>
        </div>
        <ThemePreview arabic={previewArabic} config={shownConfig} mode={previewMode} />
      </Field>

      <div className="mb-8 flex flex-wrap items-center gap-2 border-border border-y py-4">
        <Button disabled={!canUndo} onClick={undo} type="button" variant="outline">
          <Undo2 className="size-4" /> {t('settings.theme.undo')}
        </Button>
        <Button onClick={() => change((current) => ({ ...current, theme: presetTheme(resolved.id) }))} type="button" variant="outline">
          <RotateCcw className="size-4" /> {t('settings.theme.reset')}
        </Button>
      </div>

      <ThemeExchange
        acquire={acquire}
        discardAfterApply={discardAfterApply}
        editMark={() => edits.current}
        isDirty={draft.isDirty}
        writing={isSaving || writing}
        key={project.id}
        projectId={project.id}
        readBack={readBack}
        release={releaseWrite}
        slug={project.slug}
      />
    </form>
  );
}
