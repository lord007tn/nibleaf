import { Label } from '@nibleaf/design-system/components/ui/label';
import { type ReactNode, useEffect, useState } from 'react';
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
  // The field to focus once the submit's render has put its error in the DOM,
  // so its aria-describedby already names the message when focus lands.
  const [focusRequest, setFocusRequest] = useState<{ id: K; attempt: number } | null>(null);
  // What a refused submit says, for the polite live region (AuthFormStatus).
  const [announcement, setAnnouncement] = useState('');
  const keys = Object.keys(errors) as K[];
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  return {
    /** Read out after a refused submit: render it in {@link AuthFormStatus}. */
    announcement,
    /** The error to show under `key` now, if any. */
    visible: (key: K) => (fieldErrorsVisible({ errors: [errors[key]], isBlurred: blurred[key] }, submissionAttempts) ? errors[key] : undefined),
    onBlur: (key: K) => () => setBlurred((current) => (current[key] ? current : { ...current, [key]: true })),
    /** Counts a submission and focuses the first field in error; returns whether the form may be sent. */
    submit: (): boolean => {
      const attempt = submissionAttempts + 1;
      setSubmissionAttempts(attempt);
      const invalid = keys.find((key) => errors[key]);
      if (invalid) {
        setFocusRequest({ id: invalid, attempt });
        // A trailing zero-width space on alternate attempts makes the same message read again.
        setAnnouncement(`${errors[invalid]}${attempt % 2 ? '' : '​'}`);
      } else setAnnouncement('');
      return invalid === undefined;
    },
  };
}

/**
 * A stable, polite live region for a refused submit: rendered from the first
 * paint so screen readers pick up its later text. The field's own error stays
 * linked by aria-describedby; this says it once, even when focus is already there.
 */
export function AuthFormStatus({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only" data-slot="auth-form-status" role="status">
      {message}
    </p>
  );
}
