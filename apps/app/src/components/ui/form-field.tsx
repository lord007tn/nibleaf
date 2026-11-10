import { SettingsRow, type SettingsRowControl, type SettingsRowIds } from '@nibleaf/design-system/components/ui/settings-row';
import { type AnyFieldApi, useStore } from '@tanstack/react-form';
import { type ReactNode, useId } from 'react';
import { errorMessages, fieldErrorsVisible, withoutStaleErrors } from '@/lib/forms/field-errors';

export type FormFieldControl<V> = {
  /** Spread on the control: id, aria-describedby, aria-invalid and onBlur. */
  controlProps: SettingsRowIds['controlProps'] & { onBlur: () => void };
  value: V;
  /** Sets the value, clearing errors the old value caused (server, blur and submit checks). */
  onValueChange: (value: V) => void;
  ids: SettingsRowIds;
};

/**
 * A TanStack Form field rendered as a SettingsRow (operations/ui-overhaul.md
 * §6.4). It owns the error id and `aria-invalid`, shows errors only once the
 * field was left or the form submitted, and clears a server error (409 slug
 * taken…) as soon as the person changes the value.
 *
 * Validators come from the field (`validateOnBlurThenChange`). The control
 * must call `onBlur` (spread `controlProps`) so blur-time validation runs.
 */
export function FormField<V>({
  field,
  label,
  description,
  layout,
  control,
  disabledReason,
  asGroup,
  children,
}: {
  field: AnyFieldApi;
  label: ReactNode;
  description?: ReactNode;
  layout?: 'inline' | 'stacked';
  control?: SettingsRowControl;
  disabledReason?: ReactNode;
  asGroup?: boolean;
  children: (control: FormFieldControl<V>) => ReactNode;
}) {
  const submissionAttempts = useStore(field.form.store, (state) => state.submissionAttempts);
  const meta = field.state.meta;
  const visible = fieldErrorsVisible(meta, submissionAttempts);
  const message = visible ? errorMessages(meta.errors).join(' ') : undefined;
  const errorId = `${useId()}-error`;

  const onValueChange = (value: V) => {
    field.setMeta((current) => withoutStaleErrors(current));
    field.handleChange(value);
  };

  return (
    <SettingsRow
      asGroup={asGroup}
      control={control}
      description={description}
      disabledReason={disabledReason}
      error={message}
      errorId={errorId}
      label={label}
      layout={layout}
    >
      {(ids) =>
        children({
          controlProps: { ...ids.controlProps, onBlur: field.handleBlur },
          value: field.state.value as V,
          onValueChange,
          ids,
        })
      }
    </SettingsRow>
  );
}
