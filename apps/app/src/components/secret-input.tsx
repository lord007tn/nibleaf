import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { ComponentProps } from 'react';

/**
 * Attributes for any field that holds a value the browser must never fill or
 * save as a sign-in: integration webhook URLs, API keys, access tokens.
 *
 * Browsers treat a text field followed by a password-type field as a
 * sign-in form and fill the saved email and password into them, whatever
 * `autoComplete` says. So these fields are never password-type, carry a
 * `name` that isn't a credential name, and opt out of autofill and of
 * password-manager extensions.
 */
export const NO_AUTOFILL_PROPS = {
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

/**
 * A field for a secret value (a token, a key, a webhook URL). It is a text
 * field masked with CSS while `masked`, so the browser never offers or fills
 * a saved password into it and never offers to save what's typed as one.
 * `name` is required so callers pick a non-credential name ("slack-webhook-url",
 * not "password").
 */
export function SecretInput({
  masked = true,
  className,
  name,
  ...props
}: Omit<ComponentProps<typeof Input>, 'type' | 'name'> & { name: string; masked?: boolean }) {
  return (
    <Input
      {...NO_AUTOFILL_PROPS}
      className={cn('font-mono', masked && '[-webkit-text-security:disc]', className)}
      data-masked={masked ? '' : undefined}
      dir="ltr"
      name={name}
      type="text"
      {...props}
    />
  );
}
