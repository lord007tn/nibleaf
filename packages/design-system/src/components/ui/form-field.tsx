import type { ComponentProps } from 'react';
/**
 * Renders the inline validation messages for a `@tanstack/react-form` field.
 * Pass `field.state.meta.errors` straight in — the helper filters out empty /
 * non-string entries and renders nothing when the field is valid.
 */
export function FieldError({ errors, ...props }: { errors: unknown[] } & ComponentProps<'p'>) {
  const messages = errors.filter((error): error is string => typeof error === 'string' && error.length > 0);
  if (messages.length === 0) {
    return null;
  }
  return <p className="text-destructive text-xs" {...props}>{messages.join(', ')}</p>;
}

