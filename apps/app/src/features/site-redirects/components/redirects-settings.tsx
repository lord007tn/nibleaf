import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListEmpty } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { IconButton } from '@nibleaf/design-system/components/ui/icon-button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { ArrowRight, Plus, Route, X } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDraftRowUndo } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveRedirects } from '../api/hooks';
import {
  addRow,
  editRow,
  leftAfterRemove,
  leftAfterRestore,
  type RedirectField,
  type RedirectProblem,
  type RedirectRow,
  type RedirectsValues,
  redirectProblems,
  redirectsValues,
  removeRow,
  restoreRow,
  sentRedirects,
} from '../model/redirects';

/**
 * Site configuration → Redirects, in the editor's Configuration tab. The
 * ordered rules are one explicit-save draft: Add, Remove and Undo only change
 * the draft, and Save (or Enter, or Ctrl+S) replaces the stored list with it.
 * A draft the graph validator refuses is never sent; the rules it accepts are
 * sent as typed.
 */
export function RedirectsSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <RedirectsForm project={project} />
    </SaveRegionProvider>
  );
}

/** Where focus goes once the rows have re-rendered. */
type FocusTarget = { row: number; control: RedirectField | 'remove' } | 'add';

const NO_ROWS_LEFT: ReadonlySet<number> = new Set();

function RedirectsForm({ project }: { project: Project }) {
  const t = useT();
  const saveRedirects = useSaveRedirects(project.id);
  const source = useMemo(() => redirectsValues(project.config), [project.config]);

  const { form, ...draft } = useServerDraftForm<RedirectsValues>({
    identity: [project.id, 'redirects'],
    source,
    // The save leaves out blank rows, so its own refetch echoes that list, not the draft.
    toSent: sentRedirects,
    onSubmit: async (value, save) => {
      if (redirectProblems(value.redirects).length > 0) {
        save.failed();
        return 'invalid';
      }
      try {
        save.succeeded(await saveRedirects(value));
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a site this form no longer shows says nothing.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  // Rows whose fields were left: their problems show, as a field's do once blurred.
  const [left, setLeft] = useState<ReadonlySet<number>>(NO_ROWS_LEFT);
  const { offer: offerUndo, retire: retireUndo } = useRemovedRowUndo(draft.baseline);
  // Once the server's values replace the baseline, positions no longer mean the rows that were left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each new baseline
  useEffect(() => setLeft(NO_ROWS_LEFT), [draft.baseline]);
  const retire = useCallback(() => {
    retireUndo();
    setLeft(NO_ROWS_LEFT);
  }, [retireUndo]);

  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  // Save, Enter and Ctrl+S all come through here. The page's save bar disables
  // Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    if (outcome === 'saved') retire();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [retire, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    retire();
  }, [discardDraft, isSaving, retire]);
  const formProps = useSaveRegionForm('site-redirects', {
    isDirty: draft.isDirty,
    isSubmitting: isSaving,
    submit,
    discard,
    settlement: draft.settlement,
  });

  const rows = useStore(form.store, (state) => state.values.redirects);
  const submitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const readRows = () => form.getFieldValue('redirects');
  const setRows = (next: RedirectRow[]) => form.setFieldValue('redirects', next);

  const problemId = useId();
  const problems = useMemo(() => redirectProblems(rows), [rows]);
  const shown = problems
    .map((problem, index) => ({ ...problem, id: `${problemId}-${index}` }))
    .filter((problem) => submitted || problem.rows.some((row) => left.has(row)));
  /** The shown problems a field has, by id, for its `aria-describedby`. */
  const problemsOf = (row: number, field: RedirectField) =>
    shown.filter((problem) => problem.rows.includes(row) && problem.fields.includes(field)).map((problem) => problem.id);

  // Keyboard users stay in the list: on the new row after Add, on the next row after Remove.
  const formRef = useRef<HTMLFormElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  const focus = useCallback((target: FocusTarget) => {
    const selector = target === 'add' ? '[data-redirects-add]' : `[data-redirect-row="${target.row}"] [data-redirect-${target.control}]`;
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, []);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    focus(target);
  });

  const add = () => {
    const next = addRow(readRows());
    setRows(next);
    focusNext.current = { row: next.length - 1, control: 'from' };
  };
  const remove = (index: number) => {
    const { rows: next, removed } = removeRow(readRows(), index);
    if (!removed) return;
    setRows(next);
    setLeft((previous) => leftAfterRemove(previous, index));
    focusNext.current = next.length === 0 ? 'add' : { row: Math.min(index, next.length - 1), control: 'remove' };
    offerUndo(() => {
      const at = Math.min(index, readRows().length);
      setRows(restoreRow(readRows(), at, removed));
      setLeft((previous) => leftAfterRestore(previous, at));
      focusNext.current = { row: at, control: 'from' };
    });
  };
  const edit = (index: number, field: RedirectField, text: string) => setRows(editRow(readRows(), index, field, text));
  const leave = (index: number) => setLeft((previous) => (previous.has(index) ? previous : new Set(previous).add(index)));

  const addButton = (
    <Button data-redirects-add="" onClick={add} type="button" variant="outline">
      <Plus aria-hidden className="size-4" />
      {t('settings.redirects.add')}
    </Button>
  );

  return (
    <form className="flex flex-col gap-4" noValidate ref={formRef} {...formProps}>
      <SaveRegionSubmit />
      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  // Their list replaces the draft: a row removed from the draft must not come back into it.
                  retire();
                  draft.resolveConflict('redirects', 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button onClick={() => draft.resolveConflict('redirects', 'mine')} size="sm" type="button" variant="ghost">
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <SettingsSection
        description={rows.length > 0 ? t('settings.redirects.description') : undefined}
        footer={rows.length > 0 ? addButton : undefined}
        title={t('settings.redirects.title')}
      >
        {rows.length === 0 ? (
          <DataListEmpty>
            <EmptyState action={addButton} icon={<Route />} title={t('settings.redirects.description')} />
          </DataListEmpty>
        ) : (
          <DataList aria-label={t('settings.redirects.title')}>
            {rows.map((row, index) => (
              <RedirectRowItem
                index={index}
                problemsOf={(field) => problemsOf(index, field)}
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in the draft; rules have no id and sources may repeat
                key={index}
                onChange={(field, text) => edit(index, field, text)}
                onLeave={() => leave(index)}
                onRemove={() => remove(index)}
                row={row}
              />
            ))}
          </DataList>
        )}
        {shown.length > 0 ? (
          <SettingsSectionBody>
            <ProblemSummary onFix={(problem) => focusProblem(problem, focus)} problems={shown} />
          </SettingsSectionBody>
        ) : null}
      </SettingsSection>
    </form>
  );
}

/** Focuses the first field a problem names. */
const focusProblem = (problem: RedirectProblem, focus: (target: FocusTarget) => void) => {
  const [row] = problem.rows;
  const [control] = problem.fields;
  if (row !== undefined && control) focus({ row, control });
};

/**
 * What stops the save, in the validator's words. Each problem that names a
 * row is a button to its first field, so it can be fixed from here.
 */
function ProblemSummary({ problems, onFix }: { problems: Array<RedirectProblem & { id: string }>; onFix: (problem: RedirectProblem) => void }) {
  const t = useT();
  return (
    <Callout title={t('settings.redirects.invalid')} tone="danger">
      <ul className="mt-1 flex flex-col gap-1">
        {problems.map((problem) => (
          <li dir="auto" id={problem.id} key={problem.id}>
            {problem.rows.length > 0 ? (
              <button
                className="text-start underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onFix(problem)}
                type="button"
              >
                {problem.message}
              </button>
            ) : (
              problem.message
            )}
          </li>
        ))}
      </ul>
    </Callout>
  );
}

/**
 * One rule: its source, an arrow that points the reading way, its
 * destination and Remove. Paths and URLs read left to right in every locale.
 * Below ~30rem of row width the destination goes under the source.
 */
function RedirectRowItem({
  index,
  row,
  problemsOf,
  onChange,
  onLeave,
  onRemove,
}: {
  index: number;
  row: RedirectRow;
  /** The shown problems of a field, by id; none means valid. */
  problemsOf: (field: RedirectField) => string[];
  onChange: (field: RedirectField, text: string) => void;
  onLeave: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = useId();
  const fromId = `${id}-from`;
  const removeId = `${id}-remove`;
  const field = (name: RedirectField) => {
    const problems = problemsOf(name);
    return {
      'aria-describedby': problems.length > 0 ? problems.join(' ') : undefined,
      'aria-invalid': problems.length > 0 || undefined,
      autoCapitalize: 'off',
      autoComplete: 'off',
      className: 'font-mono',
      'data-density': 'compact',
      dir: 'ltr',
      onBlur: onLeave,
      onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(name, event.target.value),
      spellCheck: false,
    } as const;
  };
  return (
    <li className="@container/redirect px-4 py-3 sm:px-5" data-redirect-row={index}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @min-[30rem]/redirect:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          {...field('from')}
          aria-label={t('settings.redirects.fromLabel')}
          data-redirect-from=""
          id={fromId}
          placeholder="/intro"
          value={row.from}
        />
        <div className="col-start-1 flex min-w-0 items-center gap-2 @min-[30rem]/redirect:col-start-2">
          <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
          <Input
            {...field('to')}
            aria-label={t('settings.redirects.toLabel')}
            data-redirect-to=""
            placeholder="/get-started/introduction"
            value={row.to}
          />
        </div>
        <IconButton
          aria-labelledby={`${removeId} ${fromId}`}
          className="col-start-2 row-span-2 row-start-1 self-center text-muted-foreground @min-[30rem]/redirect:col-start-3 @min-[30rem]/redirect:row-span-1"
          data-redirect-remove=""
          id={removeId}
          label={t('settings.redirects.remove')}
          onClick={onRemove}
          type="button"
        >
          <X aria-hidden className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * Undo for the last removed row, through the shared toast. An offer belongs to
 * the baseline it was made on: once the server's values replace it (a save, a
 * refetch, another site) or the draft is discarded, the toast goes and a late
 * click restores nothing, so a removed rule never lands in a fresh draft.
 */
function useRemovedRowUndo(baseline: RedirectsValues) {
  const { offerUndo, clearUndo } = useDraftRowUndo();
  const offered = useRef<{ baseline: RedirectsValues } | null>(null);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const retire = useCallback(() => {
    offered.current = null;
    clearUndo();
  }, [clearUndo]);
  useEffect(() => {
    if (offered.current && offered.current.baseline !== baseline) retire();
  }, [baseline, retire]);

  const offer = (restore: () => void) => {
    const entry = { baseline: baselineRef.current };
    offered.current = entry;
    offerUndo(() => {
      if (offered.current !== entry || entry.baseline !== baselineRef.current) return;
      offered.current = null;
      restore();
    });
  };
  return { offer, retire };
}
