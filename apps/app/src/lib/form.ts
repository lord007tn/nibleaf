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
      return;
    }
    return t ? t('validation.required', { label }) : `${label} is required`;
  };

export const email = (value: string, t?: Translator) => {
  if (value.trim().length === 0) {
    return t ? t('validation.emailRequired') : 'Email is required';
  }
  if (EMAIL_RE.test(value.trim())) {
    return;
  }
  return t ? t('validation.emailInvalid') : 'Enter a valid email address';
};
