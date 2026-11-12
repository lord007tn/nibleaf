import { Label } from '@nibleaf/design-system/components/ui/label';
import { type ReactNode, useState } from 'react';
import { fieldErrorsVisible } from '@/lib/forms/field-errors';

type FieldControl = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };

/**
 * A labelled auth field with its error under the control, wired with
 * `aria-describedby` and `aria-invalid` like the dashboard's FormField. The
 * forms use `noValidate`, so this is the only validation the person sees.
 */
export function AuthTextField({
  id,
  label,
  error,
  description,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  description?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {description ? (
        <p className="text-muted-foreground text-xs" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="break-words text-destructive text-xs" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The dashboard forms' error timing (`fieldErrorsVisible`) for the auth forms:
 * a field's error shows once it was left or the form was submitted, then
 * follows each change. `errors` holds each field's current error, keyed by the
 * field's element id, in the order the form shows them.
 */
export function useAuthFieldErrors<K extends string>(errors: Record<K, string | undefined>) {
  const [blurred, setBlurred] = useState<Partial<Record<K, boolean>>>({});
  const [submissionAttempts, setSubmissionAttempts] = useState(0);
  const keys = Object.keys(errors) as K[];

  return {
    /** The error to show under `key` now, if any. */
    visible: (key: K) => (fieldErrorsVisible({ errors: [errors[key]], isBlurred: blurred[key] }, submissionAttempts) ? errors[key] : undefined),
    onBlur: (key: K) => () => setBlurred((current) => (current[key] ? current : { ...current, [key]: true })),
    /** Counts a submission and focuses the first field in error; returns whether the form may be sent. */
    submit: (): boolean => {
      setSubmissionAttempts((count) => count + 1);
      const invalid = keys.find((key) => errors[key]);
      if (invalid) document.getElementById(invalid)?.focus();
      return invalid === undefined;
    },
  };
}
