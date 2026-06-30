/**
 * Renders the inline validation messages for a `@tanstack/react-form` field.
 * Pass `field.state.meta.errors` straight in — the helper filters out empty /
 * non-string entries and renders nothing when the field is valid.
 */
export function FieldError({ errors }: { errors: unknown[] }) {
  const messages = errors.filter((error): error is string => typeof error === 'string' && error.length > 0);
  if (messages.length === 0) {
    return null;
  }
  return <p className="text-destructive text-xs">{messages.join(', ')}</p>;
}

