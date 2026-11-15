import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList } from '@nibleaf/design-system/components/ui/data-list';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { IconButton } from '@nibleaf/design-system/components/ui/icon-button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { PanelTop, Plus, X } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FIELD_INPUT,
  FIELD_MONO,
  Field,
  GroupLabel,
  LanguageScopePicker,
  SectionHeader,
  sortLanguagesDefaultFirst,
  ToggleRow,
  useDraftRowUndo,
  useScopeDirtyGuard,
} from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useNavbarLanguages, useSaveNavbar } from '../api/hooks';
import {
  type AnchorRow,
  addRow,
  editRow,
  languageNavbarValues,
  type NavbarProblem,
  type NavbarValues,
  type NavRow,
  navbarProblems,
  navbarValues,
  PROJECT_SCOPE,
  ROW_LISTS,
  type RowField,
  type RowList,
  removeRow,
  restoreRow,
  sentNavbarValues,
} from '../model/navbar';

/** Props for an address or icon-name field: no autocorrect, left to right in every locale. */
const CODE_INPUT = { autoCapitalize: 'off', autoComplete: 'off', dir: 'ltr', spellCheck: false } as const;

/** The validator's caps, so a field never takes more than the API stores. */
const MAX = { ctaLabel: 60, label: 80, href: 500, icon: 40 } as const;

const HREF_PLACEHOLDER: Record<RowList, string> = { links: '/docs', tabs: '/guides', anchors: 'https://community.example.com' };

/**
 * Site configuration → Navbar, in the editor's Configuration tab. One
 * explicit-save form edits the active scope: "Default" edits the project
 * navbar; a language scope localizes the CTA label and the three lists, and
 * shows the global CTA URL and switches read-only.
 */
export function NavbarSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <NavbarForm project={project} />
    </SaveRegionProvider>
  );
}

/** Where focus goes once the rows have re-rendered. */
type FocusTarget = { list: RowList; row: number; control: RowField | 'remove' } | { list: RowList; control: 'add' };

const NOTHING_LEFT: ReadonlySet<string> = new Set();
const rowKey = (list: RowList, row: number) => `${list}:${row}`;

/** The left rows of `list` after the row at `index` was removed (`delta` -1) or put back (`delta` +1): later rows move with it. */
function shiftLeft(left: ReadonlySet<string>, list: RowList, index: number, delta: 1 | -1): Set<string> {
  const next = new Set<string>();
  for (const key of left) {
    const [owner, position] = key.split(':');
    const row = Number(position);
    if (owner !== list || position === undefined) next.add(key);
    else if (delta === -1 && row === index) continue;
    else next.add(rowKey(list, row >= index ? row + delta : row));
  }
  return next;
}

function NavbarForm({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useNavbarLanguages(project.id);
  const { saveProject, saveLanguage } = useSaveNavbar(project.id);
  const ordered = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = ordered.find((language) => language.isDefault);
  const extraLanguages = ordered.filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>(PROJECT_SCOPE);
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const projectNavbar = project.config?.navbar;
  const override = activeLanguage?.config?.navbar;
  const source = useMemo(
    () => (activeLanguage ? languageNavbarValues(override, projectNavbar) : navbarValues(projectNavbar)),
    [activeLanguage, override, projectNavbar],
  );
  const scopeKind = activeLanguage ? 'language' : 'project';
  const identity = [project.id, 'navbar', activeLanguage?.id ?? PROJECT_SCOPE] as const;

  // Whether the last confirmed save left nothing to save or resolve (`succeeded`'s answer).
  const settled = useRef(true);
  // The baseline the next save is judged against: a project save sends only what differs from it.
  const baselineNow = useRef(source);
  const { form, ...draft } = useServerDraftForm<NavbarValues>({
    identity,
    source,
    // The save sends trimmed CTA text, lists without blank rows and trimmed icons
    // (from a language, the CTA label and lists only); judge its echo by that.
    toSent: (value) => sentNavbarValues(scopeKind, value, baselineNow.current),
    onSubmit: async (value, save) => {
      if (navbarProblems(scopeKind, value, save.baseline).length > 0) {
        save.failed();
        return 'invalid';
      }
      try {
        const confirmed = activeLanguage ? await saveLanguage(activeLanguage.id, value, projectNavbar) : await saveProject(value, save.baseline);
        settled.current = save.succeeded(confirmed);
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a scope or site this form has since left says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  baselineNow.current = draft.baseline;

  // When a problem shows, as a field's does: once its field or row was left, or
  // once a save was tried. Kept here, not read from the form's own submission
  // count, which a confirmed save resets even when the draft it leaves is still
  // invalid. It belongs to one scope of one site: another identity starts
  // without it. Only a settled save, Discard or that change clears it.
  const identityKey = JSON.stringify(identity);
  const [left, setLeft] = useState<ReadonlySet<string>>(NOTHING_LEFT);
  const [submitted, setSubmitted] = useState(false);
  const [visibilityFor, setVisibilityFor] = useState(identityKey);
  if (visibilityFor !== identityKey) {
    setVisibilityFor(identityKey);
    setLeft(NOTHING_LEFT);
    setSubmitted(false);
  }
  const { offer: offerUndo, retire: retireUndo } = useRemovedRowUndo(draft.baseline, identityKey);
  const retire = useCallback(() => {
    retireUndo();
    setLeft(NOTHING_LEFT);
    setSubmitted(false);
  }, [retireUndo]);

  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  // Save, Enter and Ctrl+S all come through here. The page's save bar disables
  // Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    settled.current = true;
    setSubmitted(true);
    const outcome = await submitDraft();
    // A save never brings a removed row back. When it left the draft unsettled
    // (edits made during it, or a value changed elsewhere to resolve), the draft,
    // its conflict and its shown problems all stay.
    if (outcome === 'saved') {
      if (settled.current) retire();
      else retireUndo();
    }
    return outcome === 'busy' ? 'failed' : outcome;
  }, [retire, retireUndo, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    retire();
  }, [discardDraft, isSaving, retire]);
  const formProps = useSaveRegionForm('site-navbar', { isDirty: draft.isDirty, isSubmitting: isSaving, submit, discard });

  // Switching scope asks first while there are edits, or a save that can still change them.
  const { guard, setDirty } = useScopeDirtyGuard();
  const unsettled = draft.isDirty || isSaving;
  useLayoutEffect(() => setDirty(unsettled), [setDirty, unsettled]);

  const values = useStore(form.store, (state) => state.values);
  const problemId = useId();
  const problems = navbarProblems(scopeKind, values, draft.baseline);
  const shown = problems
    .map((problem, index) => ({ ...problem, id: `${problemId}-${index}` }))
    .filter(
      (problem) =>
        submitted || (problem.rows.length === 0 ? left.has(problem.key) : problem.rows.some((row) => left.has(rowKey(problem.key as RowList, row)))),
    );
  const ctaProblems = (key: 'ctaLabel' | 'ctaUrl') => shown.filter((problem) => problem.key === key);
  const rowProblems = (list: RowList, row: number) => shown.filter((problem) => problem.key === list && problem.rows.includes(row));

  // Keyboard users stay in the list: on the new row after Add, on the next row
  // after Remove, on the restored row after Undo.
  const formRef = useRef<HTMLFormElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const selector =
      target.control === 'add'
        ? `[data-navbar-add="${target.list}"]`
        : `[data-navbar-row="${rowKey(target.list, target.row)}"] [data-navbar-${target.control}]`;
    const element = formRef.current?.querySelector<HTMLElement>(selector);
    element?.focus();
    // After Undo, focus leaves the toast, and Sonner hands it back to whatever
    // had it before the toast (#751): take it once more, from outside the toast.
    if (element && document.activeElement !== element) element.focus();
  });

  type Rows = NavRow[] | AnchorRow[];
  const readRows = (list: RowList) => form.getFieldValue(list) as Rows;
  const setRows = (list: RowList, rows: Rows) => (form.setFieldValue as unknown as (field: RowList, value: Rows) => void)(list, rows);
  const add = (list: RowList) => {
    const anchor: AnchorRow = { label: '', href: '', icon: '' };
    const next = addRow<NavRow>(readRows(list), list === 'anchors' ? anchor : { label: '', href: '' });
    setRows(list, next as Rows);
    focusNext.current = { list, row: next.length - 1, control: 'label' };
  };
  const remove = (list: RowList, index: number) => {
    const { rows: next, removed } = removeRow(readRows(list) as AnchorRow[], index);
    if (!removed) return;
    setRows(list, next);
    setLeft((previous) => shiftLeft(previous, list, index, -1));
    focusNext.current = next.length === 0 ? { list, control: 'add' } : { list, row: Math.min(index, next.length - 1), control: 'remove' };
    offerUndo(() => {
      const rows = readRows(list) as AnchorRow[];
      const at = Math.min(index, rows.length);
      setRows(list, restoreRow(rows, at, removed));
      setLeft((previous) => shiftLeft(previous, list, at, 1));
      focusNext.current = { list, row: at, control: 'label' };
    });
  };
  const edit = (list: RowList, index: number, field: RowField, text: string) =>
    setRows(list, editRow(readRows(list) as AnchorRow[], index, field as keyof AnchorRow & RowField, text));
  const leave = (key: string) => setLeft((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));

  const textDir = activeLanguage ? (activeLanguage.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto';
  const lang = activeLanguage?.code;

  return (
    <form noValidate ref={formRef} {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<PanelTop className="size-4" />} title={t('settings.navbar.title')} />
      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.navbar.scope.hint')}
        languages={extraLanguages}
        onChange={setScope}
        value={scope}
      />

      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  // Their lists replace the draft's: a row removed from the draft must not come back into them.
                  retireUndo();
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
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <form.Field name="ctaLabel">
        {(field) => (
          <CtaField hint={t('settings.navbar.ctaLabel.hint')} label={t('settings.navbar.ctaLabel.label')} problems={ctaProblems('ctaLabel')}>
            {(props) => (
              <Input
                {...props}
                className={FIELD_INPUT}
                dir={textDir}
                lang={lang}
                maxLength={MAX.ctaLabel}
                onBlur={() => leave('ctaLabel')}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={(activeLanguage && projectNavbar?.ctaLabel) || t('settings.navbar.ctaLabel.placeholder')}
                value={field.state.value}
              />
            )}
          </CtaField>
        )}
      </form.Field>

      {activeLanguage ? (
        // Global: shown so the scope reads as the whole navbar, read-only, and saying why.
        <Field hint={t('settings.chrome.scope.globalField')} label={t('settings.navbar.ctaUrl.label')}>
          <Input {...CODE_INPUT} className={FIELD_MONO} disabled placeholder="https://example.com/demo" value={values.ctaUrl} />
        </Field>
      ) : (
        <form.Field name="ctaUrl">
          {(field) => (
            <CtaField hint={t('settings.navbar.ctaUrl.hint')} label={t('settings.navbar.ctaUrl.label')} problems={ctaProblems('ctaUrl')}>
              {(props) => (
                <Input
                  {...props}
                  {...CODE_INPUT}
                  className={FIELD_MONO}
                  inputMode="url"
                  maxLength={MAX.href}
                  onBlur={() => leave('ctaUrl')}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="https://example.com/demo"
                  value={field.state.value}
                />
              )}
            </CtaField>
          )}
        </form.Field>
      )}

      {ROW_LISTS.map((list) => (
        <RowListSection
          key={list}
          list={list}
          onAdd={() => add(list)}
          onChange={(index, field, text) => edit(list, index, field, text)}
          onLeave={(index) => leave(rowKey(list, index))}
          onRemove={(index) => remove(list, index)}
          problemsOf={(index) => rowProblems(list, index)}
          rows={values[list]}
          textDir={textDir}
          lang={lang}
        />
      ))}

      <div className="mt-6">
        {activeLanguage ? (
          <>
            <ToggleRow
              checked={values.showSearch}
              disabled
              hint={t('settings.chrome.scope.globalField')}
              title={t('settings.navbar.showSearch.title')}
            />
            <ToggleRow
              checked={values.changelog}
              disabled
              hint={t('settings.chrome.scope.globalField')}
              title={t('settings.navbar.changelog.title')}
            />
          </>
        ) : (
          <>
            <form.Field name="showSearch">
              {(field) => (
                <ToggleRow
                  checked={field.state.value}
                  hint={t('settings.navbar.showSearch.hint')}
                  onCheckedChange={field.handleChange}
                  title={t('settings.navbar.showSearch.title')}
                />
              )}
            </form.Field>
            <form.Field name="changelog">
              {(field) => (
                <ToggleRow
                  checked={field.state.value}
                  hint={t('settings.navbar.changelog.hint')}
                  onCheckedChange={field.handleChange}
                  title={t('settings.navbar.changelog.title')}
                />
              )}
            </form.Field>
          </>
        )}
      </div>
    </form>
  );
}

type ShownProblem = NavbarProblem & { id: string };

/** Props a field's input takes to be named by its label and described by its shown problems. */
const describedBy = (id: string, problems: readonly ShownProblem[]) => ({
  id,
  'aria-describedby': problems.length > 0 ? problems.map((problem) => problem.id).join(' ') : undefined,
  'aria-invalid': problems.length > 0 || undefined,
});

/** A CTA field: the section's labelled row, with the validator's words under it once shown. */
function CtaField({
  label,
  hint,
  problems,
  children,
}: {
  label: string;
  hint: string;
  problems: ShownProblem[];
  children: (props: ReturnType<typeof describedBy>) => ReactNode;
}) {
  const id = useId();
  return (
    <Field hint={hint} htmlFor={id} label={label}>
      {children(describedBy(id, problems))}
      <ProblemText problems={problems} />
    </Field>
  );
}

/** The validator's words for the shown problems, each with the id its field points at. */
function ProblemText({ problems }: { problems: ShownProblem[] }) {
  return problems.map((problem) => <FieldError className="mt-1.5" dir="auto" errors={[problem.message]} id={problem.id} key={problem.id} />);
}

/** One list (links, tabs or anchors): its heading, its rows and Add. */
function RowListSection({
  list,
  rows,
  textDir,
  lang,
  problemsOf,
  onAdd,
  onChange,
  onLeave,
  onRemove,
}: {
  list: RowList;
  rows: NavRow[] | AnchorRow[];
  textDir: 'ltr' | 'rtl' | 'auto';
  lang: string | undefined;
  problemsOf: (index: number) => ShownProblem[];
  onAdd: () => void;
  onChange: (index: number, field: RowField, text: string) => void;
  onLeave: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const t = useT();
  const headingId = useId();
  return (
    <div className="mt-6">
      <GroupLabel className="mb-1">
        <span id={headingId}>{t(`settings.navbar.${list}.label`)}</span>
      </GroupLabel>
      {list === 'links' ? null : <p className="mb-2.5 text-muted-foreground text-xs leading-snug">{t(`settings.navbar.${list}.hint`)}</p>}
      {rows.length > 0 ? (
        <DataList aria-labelledby={headingId} bordered className="mt-2 mb-3">
          {rows.map((row, index) => (
            <NavRowItem
              index={index}
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in the draft; links have no id and may repeat
              key={index}
              lang={lang}
              list={list}
              onChange={(field, text) => onChange(index, field, text)}
              onLeave={() => onLeave(index)}
              onRemove={() => onRemove(index)}
              problems={problemsOf(index)}
              row={row}
              textDir={textDir}
            />
          ))}
        </DataList>
      ) : null}
      <Button
        className={cn('border-dashed text-muted-foreground', rows.length === 0 && 'mt-2')}
        data-navbar-add={list}
        onClick={onAdd}
        type="button"
        variant="outline"
      >
        <Plus aria-hidden className="size-4" />
        {t(`settings.navbar.${list}.add`)}
      </Button>
    </div>
  );
}

/**
 * One row: its label (in the scope's direction), its address and, for an
 * anchor, its icon name (both left to right), each with a visible label, then
 * Remove, named after the row. Below ~30rem of row width (anchors: ~36rem)
 * the fields stack instead of squeezing.
 */
function NavRowItem({
  list,
  index,
  row,
  textDir,
  lang,
  problems,
  onChange,
  onLeave,
  onRemove,
}: {
  list: RowList;
  index: number;
  row: NavRow | AnchorRow;
  textDir: 'ltr' | 'rtl' | 'auto';
  lang: string | undefined;
  problems: ShownProblem[];
  onChange: (field: RowField, text: string) => void;
  onLeave: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = useId();
  const anchor = list === 'anchors';
  const of = (field: RowField) => problems.filter((problem) => problem.fields.includes(field));
  const input = (field: RowField) => ({
    ...describedBy(`${id}-${field}`, of(field)),
    [`data-navbar-${field}`]: '',
    density: 'compact' as const,
    maxLength: MAX[field],
    onBlur: onLeave,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(field, event.target.value),
  });
  // Remove is named "Remove link" plus the row's label, or its address while it has no label.
  const identity = row.label.trim() || row.href.trim() || String(index + 1);
  return (
    <li className="@container/navrow px-4 py-3 sm:px-5" data-navbar-row={rowKey(list, index)}>
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 gap-y-2.5',
          anchor
            ? '@min-[36rem]/navrow:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,8rem)_auto]'
            : '@min-[30rem]/navrow:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]',
        )}
      >
        <RowFieldBox htmlFor={`${id}-label`} label={t('settings.banner.linkLabel.label')}>
          <Input {...input('label')} dir={textDir} lang={lang} placeholder={t(`settings.navbar.${list}.labelPlaceholder`)} value={row.label} />
        </RowFieldBox>
        <RowFieldBox
          className={
            anchor
              ? '@min-[36rem]/navrow:col-start-2 @min-[36rem]/navrow:row-start-1'
              : '@min-[30rem]/navrow:col-start-2 @min-[30rem]/navrow:row-start-1'
          }
          htmlFor={`${id}-href`}
          label={t('editor.format.linkPrompt')}
        >
          <Input {...input('href')} {...CODE_INPUT} className="font-mono" inputMode="url" placeholder={HREF_PLACEHOLDER[list]} value={row.href} />
        </RowFieldBox>
        {anchor ? (
          <RowFieldBox
            className="@min-[36rem]/navrow:col-start-3 @min-[36rem]/navrow:row-start-1"
            htmlFor={`${id}-icon`}
            label={t('settings.general.icon.label')}
          >
            <Input {...input('icon')} {...CODE_INPUT} placeholder={t('settings.navbar.anchors.iconPlaceholder')} value={(row as AnchorRow).icon} />
          </RowFieldBox>
        ) : null}
        <IconButton
          aria-labelledby={`${id}-remove ${id}-identity`}
          className={cn(
            'col-start-2 row-start-1 text-muted-foreground',
            anchor ? '@min-[36rem]/navrow:col-start-4' : '@min-[30rem]/navrow:col-start-3',
          )}
          data-navbar-remove=""
          id={`${id}-remove`}
          label={t(`settings.navbar.${list}.remove`)}
          onClick={onRemove}
          type="button"
        >
          <X aria-hidden className="size-4" />
        </IconButton>
        <span className="sr-only" dir="auto" id={`${id}-identity`}>
          {identity}
        </span>
      </div>
      <ProblemText problems={problems} />
    </li>
  );
}

/** A row's field: a small persistent label over its input. */
function RowFieldBox({ label, htmlFor, className, children }: { label: string; htmlFor: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('col-start-1 flex min-w-0 flex-col gap-1', className)}>
      <label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Undo for the last removed row, through the shared toast. An offer belongs to
 * the baseline and scope it was made on: once the server's values replace the
 * baseline (a save, a refetch, Use theirs), the scope or site changes, the
 * draft is discarded or the form unmounts, the toast goes and a late click
 * restores nothing, so a removed row never lands in a fresh draft or in
 * another scope. A failed save changes none of these, so its Undo stays.
 */
function useRemovedRowUndo(baseline: NavbarValues, identity: string) {
  const { offerUndo, clearUndo } = useDraftRowUndo();
  const offered = useRef<{ baseline: NavbarValues; identity: string } | null>(null);
  const current = useRef({ baseline, identity });
  useLayoutEffect(() => {
    current.current = { baseline, identity };
  }, [baseline, identity]);

  const retire = useCallback(() => {
    offered.current = null;
    clearUndo();
  }, [clearUndo]);
  useEffect(() => {
    const entry = offered.current;
    if (entry && (entry.baseline !== baseline || entry.identity !== identity)) retire();
  }, [baseline, identity, retire]);
  useEffect(
    () => () => {
      offered.current = null;
    },
    [],
  );

  const offer = (restore: () => void) => {
    const entry = { ...current.current };
    offered.current = entry;
    offerUndo(() => {
      const now = current.current;
      if (offered.current !== entry || entry.baseline !== now.baseline || entry.identity !== now.identity) return;
      offered.current = null;
      restore();
    });
  };
  return { offer, retire };
}
