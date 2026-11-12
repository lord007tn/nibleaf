import { describe, expect, it } from 'vitest';
import { importedPageIcon, isSupportedPageIcon, normalizePageIconName } from './page-icons';

describe('page icons', () => {
  it.each([
    ['rocket', true],
    ['BookOpen', true],
    ['book_open', true],
    [' Help Circle ', true],
    ['not-a-real-icon', false],
    ['constructor', false],
    ['__proto__', false],
    ['', false],
  ])('%j is supported: %s', (name, supported) => {
    expect(isSupportedPageIcon(name)).toBe(supported);
  });

  it('normalizes authored names to lower-kebab keys', () => {
    expect(normalizePageIconName('BookOpen')).toBe('book-open');
    expect(normalizePageIconName('credit_card')).toBe('credit-card');
  });

  it('keeps a supported or already-stored icon from an import, and drops any other', () => {
    expect(importedPageIcon('rocket')).toBe('rocket');
    expect(importedPageIcon('fa-solid-rocket')).toBeNull();
    expect(importedPageIcon('legacy-name', 'legacy-name')).toBe('legacy-name');
    expect(importedPageIcon('  ')).toBeNull();
    expect(importedPageIcon(undefined)).toBeNull();
  });
});
