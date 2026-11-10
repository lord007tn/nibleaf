/**
 * When form errors show (operations/ui-overhaul.md §6.4). Nothing here knows
 * about React or the design system, so it is unit-tested as plain functions.
 */

type FieldMetaLike = {
  errors: ReadonlyArray<unknown>;
  isBlurred?: boolean;
  isTouched?: boolean;
};

/** Distinct, non-empty string messages, in order. Validators may report the same message from several causes. */
export function errorMessages(errors: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  for (const error of errors) {
    if (typeof error === 'string' && error.trim() && !seen.has(error)) seen.add(error);
  }
  return [...seen];
}

/**
 * A field's errors are visible once the person has left the field or tried to
 * submit. While they type in a fresh field nothing shows; after it has been
 * blurred once, errors update as they type, so a fix clears the error at once.
 */
export function fieldErrorsVisible(meta: FieldMetaLike, submissionAttempts: number): boolean {
  return errorMessages(meta.errors).length > 0 && (submissionAttempts > 0 || meta.isBlurred === true);
}

type Validate<V> = (value: V) => string | undefined;
type ValidatorArgs<V> = { value: V; fieldApi: { state: { meta: { isBlurred?: boolean } }; form: { state: { submissionAttempts: number } } } };

/**
 * TanStack Form validators that follow the timing rule: check on blur, then on
 * every change once the field was blurred or the form submitted, and always on
 * submit. Spread into `validators` of `form.Field`.
 */
export function validateOnBlurThenChange<V>(validate: Validate<V>) {
  return {
    onBlur: ({ value }: { value: V }) => validate(value),
    onChange: ({ value, fieldApi }: ValidatorArgs<V>) =>
      fieldApi.state.meta.isBlurred || fieldApi.form.state.submissionAttempts > 0 ? validate(value) : undefined,
    onSubmit: ({ value }: { value: V }) => validate(value),
  };
}

/** Counts the fields currently in error, for "Fix 2 fields". */
export function invalidFieldCount(fieldMeta: Record<string, FieldMetaLike | undefined>): number {
  return Object.values(fieldMeta).filter((meta) => meta && errorMessages(meta.errors).length > 0).length;
}

/** The server's error for a field, set by a failed save and cleared on the field's next change. */
export const SERVER_ERROR_KEY = 'onServer';

type ErrorMapMeta = { errorMap: Record<string, unknown> };

/** Returns field meta with `message` set as its server error. */
export const withServerError = <M extends ErrorMapMeta>(meta: M, message: string): M => ({
  ...meta,
  errorMap: { ...meta.errorMap, [SERVER_ERROR_KEY]: message },
});

/**
 * Errors that a new value makes stale: the server's (it judged the old value),
 * and the blur and submit checks (they ran on the old value). The change
 * validator, which runs right after, reports what is wrong with the new value.
 */
const STALE_ON_CHANGE = [SERVER_ERROR_KEY, 'onBlur', 'onSubmit'] as const;

/** Returns field meta without errors a new value makes stale (the same object when there were none). */
export const withoutStaleErrors = <M extends ErrorMapMeta>(meta: M): M => {
  if (STALE_ON_CHANGE.every((key) => meta.errorMap[key] === undefined)) return meta;
  const errorMap = { ...meta.errorMap };
  for (const key of STALE_ON_CHANGE) delete errorMap[key];
  return { ...meta, errorMap };
};
