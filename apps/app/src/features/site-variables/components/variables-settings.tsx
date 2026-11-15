import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListEmpty } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { IconButton } from '@nibleaf/design-system/components/ui/icon-button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Braces, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useDraftRowUndo } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveVariables } from '../api/hooks';
import { addRow, removeRow, restoreRow, type VariablePair, type VariablesValues, variablesPatch, variablesValues } from '../model/variables';

/**
 * Site configuration → Variables, in the editor's Configuration tab and
 * Settings → Appearance. The ordered pairs are one explicit-save draft: Add,
 * Remove and Undo only change the draft, and Save (or Enter, or Ctrl+S)
 * replaces the stored list with it. Rows without a name are not saved.
 */
export function VariablesSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <VariablesForm project={project} />
    </SaveRegionProvider>
  );
}

/** What a save sends for the draft: the rows `variablesPatch` keeps. */
const sentVariables = (values: VariablesValues): VariablesValues => ({ variables: variablesPatch(values) });

/** Where focus goes once the rows have re-rendered. */
type FocusTarget = { row: number; control: 'key' | 'remove' } | 'add';

function VariablesForm({ project }: { project: Project }) {
  const t = useT();
  const saveVariables = useSaveVariables(project.id);
  const source = useMemo(() => variablesValues(project.config), [project.config]);

  const { form, ...draft } = useServerDraftForm<VariablesValues>({
    identity: [project.id, 'variables'],
    source,
    // The save sends rows with a name only, so its own refetch echoes that list, not the draft.
    toSent: sentVariables,
    onSubmit: async (value, save) => {
      try {
        save.succeeded(await saveVariables(value));
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a site this form no longer shows says nothing.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const { offer: offerUndo, retire } = useRemovedRowUndo(draft.baseline);
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
  const formProps = useSaveRegionForm('site-variables', { isDirty: draft.isDirty, isSubmitting: isSaving, submit, discard });

  const rows = useStore(form.store, (state) => state.values.variables);
  const readRows = () => form.getFieldValue('variables');
  const setRows = (next: VariablePair[]) => form.setFieldValue('variables', next);

  // Keyboard users stay in the list: on the new row after Add, on the next row after Remove.
  const formRef = useRef<HTMLFormElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const selector = target === 'add' ? '[data-variables-add]' : `[data-variable-row="${target.row}"] [data-variable-${target.control}]`;
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const add = () => {
    const next = addRow(readRows());
    setRows(next);
    focusNext.current = { row: next.length - 1, control: 'key' };
  };
  const remove = (index: number) => {
    const { rows: next, removed } = removeRow(readRows(), index);
    if (!removed) return;
    setRows(next);
    focusNext.current = next.length === 0 ? 'add' : { row: Math.min(index, next.length - 1), control: 'remove' };
    offerUndo(() => {
      setRows(restoreRow(readRows(), index, removed));
      focusNext.current = { row: Math.min(index, readRows().length - 1), control: 'key' };
    });
  };

  const addButton = (
    <Button data-variables-add="" onClick={add} type="button" variant="outline">
      <Plus aria-hidden className="size-4" />
      {t('settings.variables.add')}
    </Button>
  );
  const usage = (
    <>
      {t('settings.variables.descriptionBefore')}{' '}
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs" dir="ltr">
        {'{{ var.name }}'}
      </code>
      {t('settings.variables.descriptionAfter')}
    </>
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
                  draft.resolveConflict('variables', 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button onClick={() => draft.resolveConflict('variables', 'mine')} size="sm" type="button" variant="ghost">
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
        description={rows.length > 0 ? usage : undefined}
        footer={rows.length > 0 ? addButton : undefined}
        title={t('settings.variables.title')}
      >
        {rows.length === 0 ? (
          <DataListEmpty>
            <EmptyState action={addButton} icon={<Braces />} title={usage} />
          </DataListEmpty>
        ) : (
          <DataList aria-label={t('settings.variables.title')}>
            {rows.map((row, index) => (
              <VariableRow
                index={index}
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in the draft; pairs have no id and keys may repeat
                key={index}
                onKeyChange={(key) => form.setFieldValue(`variables[${index}].key`, key)}
                onRemove={() => remove(index)}
                onValueChange={(value) => form.setFieldValue(`variables[${index}].value`, value)}
                row={row}
              />
            ))}
          </DataList>
        )}
      </SettingsSection>
    </form>
  );
}

/**
 * One pair. The name is code and reads left to right in every locale; the
 * value follows its own text. Remove is named after the row's variable.
 */
function VariableRow({
  index,
  row,
  onKeyChange,
  onValueChange,
  onRemove,
}: {
  index: number;
  row: VariablePair;
  onKeyChange: (key: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = useId();
  const keyId = `${id}-key`;
  const removeId = `${id}-remove`;
  return (
    <li className="@container/variable px-4 py-3 sm:px-5" data-variable-row={index}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @min-[30rem]/variable:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] @min-[30rem]/variable:items-center">
        <Input
          aria-label={t('settings.variables.keyLabel')}
          autoCapitalize="off"
          autoComplete="off"
          className="font-mono"
          data-density="compact"
          data-variable-key=""
          dir="ltr"
          id={keyId}
          onChange={(event) => onKeyChange(event.target.value)}
          placeholder="product"
          spellCheck={false}
          value={row.key}
        />
        <Input
          aria-describedby={keyId}
          aria-label={t('settings.variables.valueLabel')}
          autoComplete="off"
          className="col-start-1 @min-[30rem]/variable:col-start-2"
          data-density="compact"
          dir="auto"
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Acme"
          value={row.value}
        />
        <IconButton
          aria-labelledby={`${removeId} ${keyId}`}
          className="col-start-2 row-span-2 row-start-1 self-center text-muted-foreground @min-[30rem]/variable:col-start-3 @min-[30rem]/variable:row-span-1"
          data-variable-remove=""
          id={removeId}
          label={t('settings.variables.remove')}
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
 * click restores nothing, so a removed row never lands in a fresh draft.
 */
function useRemovedRowUndo(baseline: VariablesValues) {
  const { offerUndo, clearUndo } = useDraftRowUndo();
  const offered = useRef<{ baseline: VariablesValues } | null>(null);
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
