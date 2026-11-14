/**
 * The sign-in and sign-up pages must not carry the whole message catalog
 * (MKT-001: 1,210 KiB of JavaScript, 811 KiB of it every product message in
 * every locale). `useT`/`useLocale` (@nibleaf/i18n/react) and the package root
 * read messages through translateFn, which imports the catalog; these modules
 * translate through AUTH_MESSAGES instead. The size itself is guarded by the
 * auth budgets in scripts/check-bundle-budget.mjs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../..');
const AUTH_SURFACE = [
  'routes/(auth)/route.tsx',
  'routes/(auth)/sign-in.tsx',
  'routes/(auth)/sign-up.tsx',
  'routes/(auth)/verify-email.tsx',
  'routes/(auth)/forgot-password.tsx',
  'routes/(auth)/reset-password.tsx',
  'components/auth-providers.tsx',
  'components/localized-product-providers.tsx',
  'components/auth-email-code.tsx',
  'components/auth-form.tsx',
  'components/terms-notice.tsx',
  'components/interface-language-dialog.tsx',
  'components/query-error-state.tsx',
  'layouts/auth.tsx',
  'lib/form.ts',
  'lib/auth-errors.ts',
  'lib/auth-messages.ts',
];

describe('auth pages translate without the full catalog', () => {
  it.each(AUTH_SURFACE)('%s imports no catalog translator', (file) => {
    const source = readFileSync(resolve(src, file), 'utf8');
    expect(source).not.toMatch(/from '@nibleaf\/i18n\/react'/);
    expect(source).not.toMatch(/^import (?!type\b)[^;]*from '@nibleaf\/i18n';/m);
    expect(source).not.toMatch(/from '@nibleaf\/i18n\/messages';/);
  });
});
