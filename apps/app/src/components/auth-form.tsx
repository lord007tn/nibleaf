import { Label } from '@nibleaf/design-system/components/ui/label';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { fieldErrorsVisible } from '@/lib/forms/field-errors';

type FieldControl = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true };

/**
 * A labelled auth field with its error under the control, wired with
 * `aria-describedby` and `aria-invalid` like the dashboard's FormField (which
 * needs TanStack Form and the settings row, so the auth pages keep this light
 * copy). The forms use `noValidate`, so this is the only validation the person
 * sees. The form's {@link AuthFormStatus} reads each error out as it appears.
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
 *
 * What the person is told goes in `announcement` (render it in
 * {@link AuthFormStatus}): a refused submit names the first field in error,
 * and an error that appears outside a submit (leaving the field, or emptying
 * it later) is read out once. A message that only changes while it shows is
 * not read again: it stays in the field's description.
 */
export function useAuthFieldErrors<K extends string>(errors: Record<K, string | undefined>) {
  const [blurred, setBlurred] = useState<Partial<Record<K, boolean>>>({});
  const [submissionAttempts, setSubmissionAttempts] = useState(0);
  // The field to focus once the submit's render has put its error in the DOM,
  // so its aria-describedby already names the message when focus lands.
  const [focusRequest, setFocusRequest] = useState<{ id: K; attempt: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // The last message read out, and whether a submit read it.
  const announced = useRef({ count: 0, message: '', bySubmit: false });
  const announce = (message: string, bySubmit: boolean) => {
    const last = announced.current;
    // Leaving the field and then pressing the submit button reads its error once, not twice.
    if (bySubmit && !last.bySubmit && last.message === message) {
      announced.current = { ...last, bySubmit };
      return;
    }
    const count = last.count + 1;
    announced.current = { count, message, bySubmit };
    // A trailing zero-width space on alternate announcements makes the same message read again.
    setAnnouncement(`${message}${count % 2 ? '' : '\u200b'}`);
  };
  const keys = Object.keys(errors) as K[];
  const visible = (key: K) => (fieldErrorsVisible({ errors: [errors[key]], isBlurred: blurred[key] }, submissionAttempts) ? errors[key] : undefined);
  // Which fields showed an error at the last render, and the submit count then.
  const shown = useRef<{ fields: Set<K>; attempts: number }>({ fields: new Set(), attempts: 0 });
  const showing = keys.filter((key) => visible(key));
  const showingKey = showing.join(' ');

  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of fields in error or the submit count changes; `showing` and `visible` are derived from them.
  useEffect(() => {
    const previous = shown.current;
    shown.current = { fields: new Set(showing), attempts: submissionAttempts };
    // A submit announces for itself (and moves focus to the field).
    if (previous.attempts !== submissionAttempts) return;
    const appeared = showing.find((key) => !previous.fields.has(key));
    const message = appeared ? visible(appeared) : undefined;
    if (message) announce(message, false);
  }, [showingKey, submissionAttempts]);

  return {
    /** Read out by {@link AuthFormStatus}: a refused submit, or an error as it appears. */
    announcement,
    /** The error to show under `key` now, if any. */
    visible,
    onBlur: (key: K) => () => setBlurred((current) => (current[key] ? current : { ...current, [key]: true })),
    /** Counts a submission and focuses the first field in error; returns whether the form may be sent. */
    submit: (): boolean => {
      const attempt = submissionAttempts + 1;
      setSubmissionAttempts(attempt);
      const invalid = keys.find((key) => errors[key]);
      if (invalid) {
        setFocusRequest({ id: invalid, attempt });
        announce(errors[invalid] ?? '', true);
      } else {
        announced.current = { ...announced.current, message: '' };
        setAnnouncement('');
      }
      return invalid === undefined;
    },
  };
}

/** A link inside a sentence ("Already have an account? Log in"): underlined, so it differs from its text by more than colour. */
export const AUTH_INLINE_LINK_CLASS =
  'inline-flex min-h-6 items-center rounded-sm font-medium text-primary underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2';

/**
 * A stable, polite live region for the form's field errors: rendered from the
 * first paint so screen readers pick up its later text. It says an error once
 * as it appears, and a refused submit even when focus is already on the field;
 * the field's own error stays linked by aria-describedby.
 */
export function AuthFormStatus({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only" data-slot="auth-form-status" role="status">
      {message}
    </p>
  );
}
