import { describe, expect, it } from 'vitest';
import { diffPageLines, PAGE_DIFF_MAX_BYTES, PAGE_DIFF_MAX_LINES } from './page-history';

describe('bounded page line diff', () => {
  it('preserves both documents including blank lines and an unchanged suffix', () => {
    const diff = diffPageLines('Heading\n\nOld\nEnd\n', 'Heading\n\nNew\nEnd\n');
    expect(diff.status).toBe('changed');
    if (diff.status === 'too-large') throw new Error('Unexpected limit');
    expect(
      diff.lines
        .filter((line) => line.kind !== 'added')
        .map((line) => line.text)
        .join('\n'),
    ).toBe('Heading\n\nOld\nEnd\n');
    expect(
      diff.lines
        .filter((line) => line.kind !== 'removed')
        .map((line) => line.text)
        .join('\n'),
    ).toBe('Heading\n\nNew\nEnd\n');
    expect(diff.lines.filter((line) => line.kind === 'removed')).toEqual([{ kind: 'removed', text: 'Old' }]);
  });

  it('rejects giant lines and multi-byte adversarial input at the byte cap', () => {
    expect(diffPageLines('x'.repeat(PAGE_DIFF_MAX_BYTES + 1), '')).toEqual({ status: 'too-large', limit: 'bytes' });
    expect(diffPageLines('', '😀'.repeat(PAGE_DIFF_MAX_BYTES / 4 + 1))).toEqual({ status: 'too-large', limit: 'bytes' });
  });

  it('rejects excessive repeated lines before building diff output', () => {
    expect(diffPageLines('\n'.repeat(PAGE_DIFF_MAX_LINES), '')).toEqual({ status: 'too-large', limit: 'lines' });
    const result = diffPageLines('a\n'.repeat(PAGE_DIFF_MAX_LINES - 1), 'b\n'.repeat(PAGE_DIFF_MAX_LINES - 1));
    expect(result.status).toBe('changed');
    if (result.status !== 'too-large') expect(result.lines.length).toBeLessThanOrEqual(2 * PAGE_DIFF_MAX_LINES);
  });

  it('accepts exact bounds and handles equal and empty documents', () => {
    expect(diffPageLines('x'.repeat(PAGE_DIFF_MAX_BYTES), '').status).toBe('changed');
    expect(diffPageLines('', '')).toEqual({ status: 'equal', lines: [{ kind: 'same', text: '' }] });
  });
});
