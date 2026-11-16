import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { FormField } from '@/components/ui/form-field';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { validateOnBlurThenChange, withServerError } from '@/lib/forms/field-errors';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useCreateSchedule } from '../api/schedules';
import {
  detectedTimezone,
  EXPORT_FORMAT_LABELS,
  SCHEDULE_FIELD_LABELS,
  SCHEDULE_FORMATS,
  SCHEDULE_NAME_MAX,
  SCHEDULE_NUMBER_BOUNDS,
  type ScheduleCadence,
  type ScheduleDraftValues,
  type ScheduleField,
  type ScheduleNumberField,
  type ScheduleProblem,
  scheduleDraftDefaults,
  scheduleFieldProblem,
  scheduleTimezones,
  timezoneLabel,
  toCreateScheduleBody,
} from '../model/schedule-create';

const WEEKDAY_KEYS: MessageKey[] = [
  'settings.exports.workflow.day.sunday',
  'settings.exports.workflow.day.monday',
  'settings.exports.workflow.day.tuesday',
  'settings.exports.workflow.day.wednesday',
  'settings.exports.workflow.day.thursday',
  'settings.exports.workflow.day.friday',
  'settings.exports.workflow.day.saturday',
];

/**
 * A new export schedule. Opening the form starts a draft from defaults taken
 * once (the localized name, the detected timezone); a language change later
 * relabels the form but never renames or dirties the draft. Problems show
 * after a field is left or on Create, and Create focuses the first one.
 *
 * Create is a plain submit: one request at a time, the fields frozen while it
 * runs, and the form closes only once the server confirms. A failure keeps
 * everything as typed for a retry. An unsaved or pending draft counts as
 * unsettled (`onUnsettledChange`, and the settings leave guard).
 */
export function ScheduleCreateForm({
  projectId,
  onCreated,
  onUnsettledChange,
}: {
  projectId: string;
  onCreated: () => void;
  onUnsettledChange?: (unsettled: boolean) => void;
}) {
  const { t } = useLocale();
  const [source] = useState(() => scheduleDraftDefaults({ name: t('settings.exports.workflow.defaultScheduleName'), timezone: detectedTimezone() }));
  const timezoneOptions = useMemo(
    () => scheduleTimezones(source.timezone).map((value) => ({ value, label: timezoneLabel(value) })),
    [source.timezone],
  );
  const createSchedule = useCreateSchedule();
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const formatsReasonId = useId();
  // The shared draft's isCurrent() doesn't cover unmounting yet (#767), and a
  // closed form or a site switch unmounts this one: a request that settles
  // afterwards must not toast, focus or close anything. Retire after #767.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const problemMessage = (field: ScheduleField, problem: ScheduleProblem | undefined) => {
    if (!problem) return;
    if (problem === 'invalid') return t('settings.exports.workflow.scheduleCreateError');
    if (field === 'formats') return t('settings.exports.workflow.formatMinimum');
    if (problem === 'range' && field in SCHEDULE_NUMBER_BOUNDS) {
      return t('settings.exports.workflow.wholeNumber', SCHEDULE_NUMBER_BOUNDS[field as ScheduleNumberField]);
    }
    return t('validation.required', { label: t(SCHEDULE_FIELD_LABELS[field as Exclude<ScheduleField, 'formats'>]) });
  };

  const draft = useServerDraftForm<ScheduleDraftValues>({
    identity: [projectId],
    source,
    onSubmit: async (values, save) => {
      const result = toCreateScheduleBody(values);
      if (!result.ok) {
        for (const [field, problem] of Object.entries(result.problems) as Array<[ScheduleField, ScheduleProblem]>) {
          const message = problemMessage(field, problem);
          if (message) draft.form.setFieldMeta(field, (meta) => withServerError(meta, message));
        }
        return 'invalid';
      }
      const live = () => mounted.current && save.isCurrent();
      setFailure(null);
      try {
        await createSchedule({ projectId, body: result.body });
      } catch (error) {
        if (!live()) return 'failed';
        save.failed();
        // 409: the site already has the most schedules allowed.
        setFailure(friendlyErrorMessage(t, error, 'settings.saveError', { 409: 'settings.exports.workflow.scheduleLimit' }));
        return 'failed';
      }
      if (live()) save.succeeded(values);
      return 'saved';
    },
  });
  const { form } = draft;
  const pending = draft.isSaving;

  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await draft.submit();
    if (!mounted.current) return;
    if (result === 'invalid') setFocusRequest((count) => count + 1);
    if (result === 'saved') {
      toast.success(t('settings.exports.workflow.scheduleCreated'));
      onCreated();
    }
  };

  /** Blur-then-change validation for one field, judged with the rest of the draft as it is now. */
  const validate = <K extends ScheduleField>(field: K) =>
    validateOnBlurThenChange((value: ScheduleDraftValues[K]) =>
      problemMessage(field, scheduleFieldProblem(field, { ...(form.state.values as ScheduleDraftValues), [field]: value })),
    );

  const cadenceOptions: Array<{ value: ScheduleCadence; label: string }> = [
    { value: 'DAILY', label: t('settings.exports.workflow.daily') },
    { value: 'WEEKLY', label: t('settings.exports.workflow.weekly') },
    { value: 'MONTHLY', label: t('settings.exports.workflow.monthly') },
  ];
  const weekdayOptions = WEEKDAY_KEYS.map((key, value) => ({ value, label: t(key) }));

  const numberField = (name: ScheduleNumberField) => (
    <form.Field name={name} validators={validate(name)}>
      {(field) => (
        <FormField<string> field={field} label={t(SCHEDULE_FIELD_LABELS[name])} layout="stacked">
          {({ controlProps, value, onValueChange }) => (
            <Input
              {...controlProps}
              disabled={pending}
              inputMode="numeric"
              max={SCHEDULE_NUMBER_BOUNDS[name].max}
              min={SCHEDULE_NUMBER_BOUNDS[name].min}
              onChange={(event) => onValueChange(event.target.value)}
              required
              type="number"
              value={value}
            />
          )}
        </FormField>
      )}
    </form.Field>
  );

  return (
    <form aria-busy={pending || undefined} className="rounded-lg border border-border" noValidate onSubmit={submit} ref={formRef}>
      <DirtyStateReporter dirty={draft.isDirty || pending} onDirtyChange={onUnsettledChange} />
      <div className="grid min-w-0 sm:grid-cols-2">
        <form.Field name="name" validators={validate('name')}>
          {(field) => (
            <FormField<string> field={field} label={t(SCHEDULE_FIELD_LABELS.name)} layout="stacked">
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir="auto"
                  disabled={pending}
                  maxLength={SCHEDULE_NAME_MAX}
                  onChange={(event) => onValueChange(event.target.value)}
                  required
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="timezone" validators={validate('timezone')}>
          {(field) => (
            <FormField<string> field={field} label={t(SCHEDULE_FIELD_LABELS.timezone)} layout="stacked">
              {({ controlProps, value, onValueChange }) => (
                <Select
                  disabled={pending}
                  items={timezoneOptions}
                  onValueChange={(next) => {
                    if (next) onValueChange(next);
                  }}
                  value={value}
                >
                  <SelectTrigger {...controlProps} className="w-full" dir="ltr">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezoneOptions.map((option) => (
                      <SelectItem dir="ltr" key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="cadence">
          {(field) => (
            <FormField<ScheduleCadence> field={field} label={t(SCHEDULE_FIELD_LABELS.cadence)} layout="stacked">
              {({ controlProps, value, onValueChange }) => (
                <Select
                  disabled={pending}
                  items={cadenceOptions}
                  onValueChange={(next) => {
                    if (!next) return;
                    onValueChange(next);
                    // A day field the new cadence hides keeps its instance: drop its old errors so they can't block Create.
                    for (const day of ['weekday', 'monthday'] as const) {
                      if (form.getFieldMeta(day)) form.setFieldMeta(day, (meta) => ({ ...meta, errorMap: {} }));
                    }
                  }}
                  value={value}
                >
                  <SelectTrigger {...controlProps} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cadenceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="time" validators={validate('time')}>
          {(field) => (
            <FormField<string> field={field} label={t(SCHEDULE_FIELD_LABELS.time)} layout="stacked">
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir="ltr"
                  disabled={pending}
                  onChange={(event) => onValueChange(event.target.value)}
                  required
                  type="time"
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.cadence}>
          {(cadence) =>
            cadence === 'WEEKLY' ? (
              <form.Field name="weekday" validators={validate('weekday')}>
                {(field) => (
                  <FormField<number> field={field} label={t(SCHEDULE_FIELD_LABELS.weekday)} layout="stacked">
                    {({ controlProps, value, onValueChange }) => (
                      <Select
                        disabled={pending}
                        items={weekdayOptions}
                        onValueChange={(next) => {
                          if (next !== null) onValueChange(next);
                        }}
                        value={value}
                      >
                        <SelectTrigger {...controlProps} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {weekdayOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                )}
              </form.Field>
            ) : cadence === 'MONTHLY' ? (
              numberField('monthday')
            ) : null
          }
        </form.Subscribe>
        {numberField('retentionCount')}
        {numberField('retentionDays')}
      </div>
      <form.Field name="formats" validators={validate('formats')}>
        {(field) => {
          const selected = field.state.value;
          const lastOne = selected.length === 1;
          return (
            <div className="space-y-2 px-4 pb-4 sm:px-5">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {SCHEDULE_FORMATS.map((format) => {
                  const checked = selected.includes(format);
                  const id = `${formatsReasonId}-${format}`;
                  return (
                    <div className="flex min-h-11 items-center gap-2 text-sm" key={format}>
                      <Switch
                        aria-describedby={checked && lastOne ? formatsReasonId : undefined}
                        checked={checked}
                        disabled={pending || (checked && lastOne)}
                        id={id}
                        onCheckedChange={() => field.handleChange(checked ? selected.filter((item) => item !== format) : [...selected, format])}
                      />
                      <Label htmlFor={id}>{t(EXPORT_FORMAT_LABELS[format])}</Label>
                    </div>
                  );
                })}
              </div>
              {lastOne ? (
                <p className="text-muted-foreground text-xs" id={formatsReasonId}>
                  {t('settings.exports.workflow.formatMinimum')}
                </p>
              ) : null}
            </div>
          );
        }}
      </form.Field>
      {failure ? (
        <div className="px-4 pb-4 sm:px-5">
          <Callout tone="danger" urgent>
            {failure}
          </Callout>
        </div>
      ) : null}
      <div className="flex justify-end border-border border-t px-4 py-3 sm:px-5">
        <Button loading={pending} loadingText={t('settings.exports.workflow.scheduleCreating')} size="sm" type="submit">
          {t('settings.exports.workflow.createSchedule')}
        </Button>
      </div>
    </form>
  );
}
