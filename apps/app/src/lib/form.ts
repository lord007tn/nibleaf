/**
 * Small client-side validators for use with `@tanstack/react-form` field
 * `validators` ({ onChange / onSubmit }). Each returns an error string when the
 * value is invalid, or `undefined` when it's fine — exactly the shape TanStack
 * Form expects, so the message surfaces in `field.state.meta.errors`.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import type { MessageKey } from '@nibleaf/i18n';

type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const required =
  (label = 'This field', t?: Translator) =>
  (value: string) => {
    if (value.trim().length > 0) {
      return undefined;
    }
    return t ? t('validation.required', { label }) : `${label} is required`;
  };

export const email = (value: string, t?: Translator) => {
  if (value.trim().length === 0) {
    return t ? t('validation.emailRequired') : 'Email is required';
  }
  if (EMAIL_RE.test(value.trim())) {
    return undefined;
  }
  return t ? t('validation.emailInvalid') : 'Enter a valid email address';
};

export const minLength =
  (min: number, label = 'Password', t?: Translator) =>
  (value: string) => {
    if (value.length >= min) {
      return undefined;
    }
    return t ? t('validation.minLength', { label, min }) : `${label} must be at least ${min} characters`;
  };

/** Normalise a TanStack Form field's `meta.errors` into clean strings to render. */
export const fieldErrors = (errors: unknown[]): string[] => errors.filter((error): error is string => typeof error === 'string' && error.length > 0);
