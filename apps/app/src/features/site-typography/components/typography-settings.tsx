import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { type CSSProperties, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { FormField, type FormFieldControl } from '@/components/ui/form-field';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveTypography } from '../api/hooks';
import {
  activePreset,
  applyPreset,
  type Flow,
  type FontField,
  fontOptions,
  PRESET_NAMES,
  previewStyle,
  RHYTHM_STEPS,
  type RhythmField,
  type TypographyValues,
  typographyValues,
} from '../model/typography';

const FONT_ROWS = [
  { field: 'headingFont', label: 'settings.typography.headingFont.label', hint: 'settings.typography.headingFont.hint' },
  { field: 'bodyFont', label: 'settings.typography.bodyFont.label', hint: 'settings.typography.bodyFont.hint' },
  { field: 'codeFont', label: 'settings.typography.codeFont.label', hint: 'settings.typography.codeFont.hint' },
] as const satisfies ReadonlyArray<{ field: FontField; label: MessageKey; hint: MessageKey }>;

/** Block spacing steps are named in words; sizes and line heights read as numbers. */
const FLOW_LABELS: Record<Flow, MessageKey> = {
  '0.75': 'settings.typography.flow.tight',
  '1': 'settings.typography.flow.snug',
  '1.25': 'settings.typography.flow.normal',
  '1.5': 'settings.typography.flow.roomy',
  '2': 'settings.typography.flow.airy',
};

const RHYTHM_ROWS = [
  { field: 'baseSize', label: 'settings.typography.baseSize.label', hint: 'settings.typography.baseSize.hint' },
  { field: 'leading', label: 'settings.typography.leading.label', hint: 'settings.typography.leading.hint' },
  { field: 'flow', label: 'settings.typography.flow.label', hint: 'settings.typography.flow.hint' },
] as const satisfies ReadonlyArray<{ field: RhythmField; label: MessageKey; hint: MessageKey }>;

/**
 * Site configuration → Typography, in the editor's Configuration tab: the
 * three fonts and the reading rhythm (size, line height, block spacing), in
 * one explicit-save form. A preset fills the rhythm in the draft and the
 * preview follows the draft; only Save stores anything.
 */
export function TypographySettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <TypographyForm project={project} />
    </SaveRegionProvider>
  );
}

function TypographyForm({ project }: { project: Project }) {
  const t = useT();
  const { save } = useSaveTypography(project.id);
  const source = useMemo(() => typographyValues(project.config), [project.config]);

  const { form, ...draft } = useServerDraftForm<TypographyValues>({
    identity: [project.id, 'typography'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        outcome.succeeded(await save(outcome.baseline, value));
        return 'saved';
      } catch (error) {
        outcome.failed();
        // A save for a site this form no longer shows says nothing.
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const preset = activePreset(values);

  const { submit: submitDraft } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  const formProps = useSaveRegionForm('site-typography', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  return (
    <form className="flex flex-col gap-6" noValidate {...formProps}>
      <SaveRegionSubmit />
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
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <SettingsSection title={t('settings.typography.title')}>
        {FONT_ROWS.map(({ field: name, label, hint }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <FormField<string> control="field" description={t(hint)} field={field} label={t(label)}>
                {/* The site's saved font stays listed, so picking another and coming back needs no Discard. */}
                {(control) => <FontSelect control={control} options={fontOptions(name, draft.baseline[name])} />}
              </FormField>
            )}
          </form.Field>
        ))}

        <SettingsRow asGroup description={t('settings.typography.preset.hint')} label={t('settings.typography.preset.label')}>
          {/* Presets only fill the three rhythm rows below; the pressed one is whichever matches them. */}
          <SegmentedControl className="w-full">
            {PRESET_NAMES.map((name) => (
              <SegmentedControlItem
                active={preset === name}
                key={name}
                onClick={() => {
                  const next = applyPreset(form.state.values, name);
                  for (const { field } of RHYTHM_ROWS) form.setFieldValue(field, next[field]);
                }}
              >
                {t(`settings.typography.preset.${name}`)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </SettingsRow>

        {RHYTHM_ROWS.map(({ field: name, label, hint }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <FormField<string> asGroup description={t(hint)} field={field} label={t(label)}>
                {({ value, onValueChange }) => (
                  <SegmentedControl className="w-full">
                    {RHYTHM_STEPS[name].map((step) => (
                      <SegmentedControlItem active={value === step} key={step} onClick={() => onValueChange(step)}>
                        {stepLabel(t, name, step)}
                      </SegmentedControlItem>
                    ))}
                  </SegmentedControl>
                )}
              </FormField>
            )}
          </form.Field>
        ))}

        <SettingsRow asGroup description={t('settings.typography.preview.hint')} label={t('settings.typography.preview.label')} layout="stacked">
          <TypographyPreview values={values} />
        </SettingsRow>
      </SettingsSection>
    </form>
  );
}

function stepLabel(t: ReturnType<typeof useT>, field: RhythmField, step: string) {
  if (field === 'flow') return t(FLOW_LABELS[step as Flow]);
  return field === 'leading' && step === '2' ? '2.0' : step;
}

/** A font picker; each font's name is its own label. */
function FontSelect({ control, options }: { control: FormFieldControl<string>; options: string[] }) {
  const items = options.map((option) => ({ value: option, label: option }));
  return (
    <Select items={items} onValueChange={(next) => control.onValueChange((next as string | null) ?? control.value)} value={control.value}>
      <SelectTrigger {...control.controlProps} aria-labelledby={control.ids.labelId} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A sample set with the typeset variables the published site uses, from the
 * draft (unsaved changes included). It loads no fonts: a font this browser
 * lacks shows in the theme's family.
 */
function TypographyPreview({ values }: { values: TypographyValues }) {
  const t = useT();
  return (
    <div className="typeset rounded-lg bg-muted/40 p-4 sm:p-5" style={previewStyle(values) as CSSProperties}>
      <h2>{t('settings.typography.preview.heading')}</h2>
      <p>{t('settings.typography.preview.body')}</p>
      <ul>
        <li>{t('settings.typography.preview.item1')}</li>
        <li>
          {t('settings.typography.preview.item2')
            .split('`')
            .map((part, i) => (i % 2 === 1 ? <code key={part}>{part}</code> : part))}
        </li>
      </ul>
    </div>
  );
}
