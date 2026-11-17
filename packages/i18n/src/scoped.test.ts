import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MESSAGE_IDS } from './message-ids';
import { auth_signin_subtitle } from './paraglide/messages/auth_signin_subtitle.js';
import { validation_required } from './paraglide/messages/validation_required.js';
import { scopedTranslate } from './scoped';
import { translateFn } from './translate';

const messages = { 'auth.signIn.subtitle': auth_signin_subtitle, 'validation.required': validation_required } as const;

describe('scopedTranslate', () => {
  it('reads the same text as the catalog translator, in any locale', () => {
    for (const locale of ['en', 'ar', 'de'] as const) {
      expect(scopedTranslate(messages, 'auth.signIn.subtitle', undefined, locale)).toBe(translateFn('auth.signIn.subtitle', undefined, locale));
      expect(scopedTranslate(messages, 'validation.required', { label: 'Email' }, locale)).toBe(
        translateFn('validation.required', { label: 'Email' }, locale),
      );
    }
  });

  it('reads an unknown key as itself, as translateFn does', () => {
    expect(scopedTranslate({} as Record<string, never>, 'auth.missing')).toBe('auth.missing');
  });

  it('never imports the whole catalog or the key map (MKT-001)', () => {
    const source = readFileSync(new URL('./scoped.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/translate'|from '\.\/message-ids'|paraglide\/messages\.js/);
    expect(MESSAGE_IDS['auth.signIn.subtitle']).toBe('auth_signin_subtitle');
  });
});
