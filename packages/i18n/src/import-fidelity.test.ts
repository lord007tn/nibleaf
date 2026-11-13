import { describe, expect, it } from 'vitest';
import { INTERFACE_LOCALES } from './locales';
import { translateFn } from './translate';

describe('import fidelity report messages', () => {
  it.each(INTERFACE_LOCALES)('formats the source page and unresolved reference in $code', ({ code }) => {
    for (const key of ['settings.import.unmappedEmbed', 'settings.import.unresolvedLink'] as const) {
      const text = translateFn(key, { page: 'guides/tour', reference: 'https://help.example.test/missing#start' }, code);
      expect(text).toContain('guides/tour');
      expect(text).toContain('https://help.example.test/missing#start');
      expect(text).not.toMatch(/\{(?:page|reference)\}|\?{2,}/);
    }
    expect(translateFn('settings.import.sourceUrl', undefined, code)).not.toMatch(/\?{2,}/);
  });
});
