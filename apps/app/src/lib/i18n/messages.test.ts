import { describe, expect, it } from 'vitest';
import { messages } from './messages';

describe('i18n message tables', () => {
  it('keeps en and ar key sets identical (lock-step)', () => {
    const missingInAr = Object.keys(messages.en).filter((key) => !(key in messages.ar));
    const extraInAr = Object.keys(messages.ar).filter((key) => !(key in messages.en));
    expect(missingInAr).toEqual([]);
    expect(extraInAr).toEqual([]);
  });

  it('has no empty values in either locale', () => {
    for (const [locale, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value, `${locale}.${key} should be non-empty`).not.toBe('');
      }
    }
  });
});

