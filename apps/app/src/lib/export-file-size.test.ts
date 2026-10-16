import { describe, expect, it } from 'vitest';
import { formatExportFileSize } from './export-file-size';

describe('export artifact file sizes', () => {
  it.each([
    [0, '0 B', '0 بايت'],
    [1, '1 B', '1 بايت'],
    [1023, '1,023 B', '1,023 بايت'],
    [1024, '1 KiB', '1 كيبيبايت'],
    [4096, '4 KiB', '4 كيبيبايت'],
    [1536, '1.5 KiB', '1.5 كيبيبايت'],
    [1024 ** 2 - 1, '1,024 KiB', '1,024 كيبيبايت'],
    [1024 ** 2, '1 MiB', '1 ميبيبايت'],
    [1024 ** 3 - 1, '1,024 MiB', '1,024 ميبيبايت'],
    [1024 ** 3, '1 GiB', '1 غيبيبايت'],
  ])('formats %i bytes in English and Arabic with binary units', (bytes, english, arabic) => {
    expect(formatExportFileSize(bytes, 'en')).toBe(english);
    expect(formatExportFileSize(bytes, 'ar')).toBe(arabic);
  });
});
