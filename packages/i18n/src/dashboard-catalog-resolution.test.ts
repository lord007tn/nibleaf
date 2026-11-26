// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dashboardMessage } from '@nibleaf/i18n/dashboard-catalog';
import { describe, expect, it } from 'vitest';
import { common_cancel } from './paraglide/messages/common_cancel.js';

describe('dashboard-only package resolution', () => {
  const resolveCatalog = (conditions: string[]) =>
    execFileSync(
      process.execPath,
      [
        ...conditions.map((condition) => `--conditions=${condition}`),
        '--input-type=module',
        '-e',
        'console.log(import.meta.resolve("@nibleaf/i18n/dashboard-catalog"))',
      ],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
    ).trim();

  it('keeps the synchronous full namespace for SSR and ordinary browser/admin consumers', () => {
    expect(resolveCatalog([])).toMatch(/dashboard-catalog\.server\.ts$/);
    expect(resolveCatalog(['browser'])).toMatch(/dashboard-catalog\.server\.ts$/);
    expect(dashboardMessage('common_cancel', 'ar')).toBe(common_cancel);
  });

  it("selects the client catalog only with the main dashboard's explicit condition", () => {
    expect(resolveCatalog(['nibleaf-dashboard', 'browser'])).toMatch(/dashboard-catalog\.client\.ts$/);
  });

  it('keeps the shared translator behind that conditional boundary', () => {
    const source = readFileSync(new URL('./translate.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '@nibleaf/i18n/dashboard-catalog'");
    expect(source).not.toContain('./paraglide/');
  });
});
