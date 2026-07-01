/**
 * Small client-side validators for use with `@tanstack/react-form` field
 * `validators` ({ onChange / onSubmit }). Each returns an error string when the
 * value is invalid, or `undefined` when it's fine — exactly the shape TanStack
 * Form expects, so the message surfaces in `field.state.meta.errors`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validators run client-side, so localize the message to the user's chosen locale
// (the same `midad.locale` key the i18n provider persists). Arabic messages are
// generic (no English field label injected) to read naturally in RTL.
const isArabic = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('midad.locale') === 'ar';
  } catch {
    return false;
  }
};

export const required =
  (label = 'This field') =>
  (value: string) => {
    if (value.trim().length > 0) {
      return undefined;
    }
    return isArabic() ? 'هذا الحقل مطلوب' : `${label} is required`;
  };

export const email = (value: string) => {
  const ar = isArabic();
  if (value.trim().length === 0) {
    return ar ? 'البريد الإلكتروني مطلوب' : 'Email is required';
  }
  if (EMAIL_RE.test(value.trim())) {
    return undefined;
  }
  return ar ? 'أدخل بريدًا إلكترونيًا صالحًا' : 'Enter a valid email address';
};

export const minLength =
  (min: number, label = 'Password') =>
  (value: string) => {
    if (value.length >= min) {
      return undefined;
    }
    return isArabic() ? `يجب ألا يقل عن ${min} أحرف` : `${label} must be at least ${min} characters`;
  };

/** Normalise a TanStack Form field's `meta.errors` into clean strings to render. */
export const fieldErrors = (errors: unknown[]): string[] => errors.filter((error): error is string => typeof error === 'string' && error.length > 0);
