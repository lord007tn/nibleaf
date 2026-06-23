/**
 * Small client-side validators for use with `@tanstack/react-form` field
 * `validators` ({ onChange / onSubmit }). Each returns an error string when the
 * value is invalid, or `undefined` when it's fine — exactly the shape TanStack
 * Form expects, so the message surfaces in `field.state.meta.errors`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const required =
  (label = 'This field') =>
  (value: string) =>
    value.trim().length === 0 ? `${label} is required` : undefined;

export const email = (value: string) => {
  if (value.trim().length === 0) {
    return 'Email is required';
  }
  return EMAIL_RE.test(value.trim()) ? undefined : 'Enter a valid email address';
};

export const minLength =
  (min: number, label = 'Password') =>
  (value: string) =>
    value.length < min ? `${label} must be at least ${min} characters` : undefined;

/** Normalise a TanStack Form field's `meta.errors` into clean strings to render. */
export const fieldErrors = (errors: unknown[]): string[] => errors.filter((error): error is string => typeof error === 'string' && error.length > 0);
