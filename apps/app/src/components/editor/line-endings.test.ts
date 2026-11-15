import { describe, expect, it } from 'vitest';
import { finalLineEnding, matchLines, normalizeLineEndings, readLineEndings, restoreLineEndings } from './line-endings';

describe('reading a page’s line endings (#702)', () => {
  it('a page with only LF has none to restore and is read as it is', () => {
    expect(readLineEndings('a\nb\n')).toBeNull();
    expect(normalizeLineEndings('a\nb\n')).toBe('a\nb\n');
  });

  it('reads CRLF, LF and lone CR as line endings, and CR then CRLF as two', () => {
    const source = readLineEndings('a\r\nb\nc\rd\r\r\ne');
    expect(source?.lines).toEqual(['a', 'b', 'c', 'd', '', 'e']);
    expect(source?.endings).toEqual(['\r\n', '\n', '\r', '\r', '\r\n']);
    expect(source?.normalized).toBe('a\nb\nc\nd\n\ne');
    expect(normalizeLineEndings('a\r\nb\nc\rd\r\r\ne')).toBe(source?.normalized);
  });

  it('the most common ending is the one new lines get; ties go to CRLF, then LF', () => {
    expect(readLineEndings('a\r\nb\r\nc\nd')?.dominant).toBe('\r\n');
    expect(readLineEndings('a\nb\nc\r\nd')?.dominant).toBe('\n');
    expect(readLineEndings('a\nb\r\nc')?.dominant).toBe('\r\n');
    expect(readLineEndings('a\rb\rc\nd')?.dominant).toBe('\r');
    expect(readLineEndings('a\rb\nc')?.dominant).toBe('\n');
  });

  it('the last line break of a page, as written', () => {
    expect(['a\r\n', 'a\n', 'a\r', 'a', ''].map(finalLineEnding)).toEqual(['\r\n', '\n', '\r', '', '']);
  });
});

describe('putting the endings back on a save (#702)', () => {
  it('a save that is the source with LF gives back the source', () => {
    const source = 'a\r\nb\nc\rd';
    expect(restoreLineEndings(readLineEndings(source), 'a\nb\nc\nd')).toBe(source);
  });

  it('a page with only LF is saved exactly as the serializer writes it', () => {
    expect(restoreLineEndings(null, 'x\ny')).toBe('x\ny');
  });

  it('unchanged lines keep their own ending; changed and new lines get the common one', () => {
    const source = readLineEndings('one\r\ntwo\nthree\r\nfour\r\nfive');
    // `two` changed, a line inserted after `three`, `five` gone.
    expect(restoreLineEndings(source, 'one\nTWO\nthree\nnew\nfour')).toBe('one\r\nTWO\r\nthree\r\nnew\r\nfour');
    // The source's last line, followed by more, gets the common ending after it.
    expect(restoreLineEndings(source, 'one\ntwo\nthree\nfour\nfive\nsix')).toBe('one\r\ntwo\nthree\r\nfour\r\nfive\r\nsix');
  });

  it('edits at both ends of a mixed page keep every line between them', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const endings = lines.map((_, index) => (index % 3 === 0 ? '\n' : '\r\n'));
    const source = lines.map((line, index) => line + (index < lines.length - 1 ? endings[index] : '')).join('');
    const saved = ['changed 0', ...lines.slice(1, -1), 'changed 199'].join('\n');
    const restored = restoreLineEndings(readLineEndings(source), saved);
    expect(restored).toBe(source.replace('line 0\n', 'changed 0\r\n').replace(/line 199$/, 'changed 199'));
  });

  it('blank lines and repeated lines between edits still match in order', () => {
    const source = readLineEndings('# A\n\nx\r\n\r\n# B\n\nx\r\n\r\nend');
    expect(restoreLineEndings(source, '# A!\n\nx\n\n# B\n\nx\n\nend!')).toBe('# A!\r\n\nx\r\n\r\n# B\n\nx\r\n\r\nend!');
  });
});

describe('matching saved lines to source lines', () => {
  it('matches in order: no saved line matches a source line before an earlier match', () => {
    const match = matchLines(['a', 'b', 'c', 'd'], ['d', 'b', 'c', 'a']);
    const matched = [...match].filter((at) => at >= 0);
    expect(matched).toEqual([...matched].sort((x, y) => x - y));
    expect(matched).toContain(1);
    expect(matched).toContain(2);
  });

  it('does work bounded by the page’s length, even when every line is repeated', () => {
    // No unique lines to anchor on: matching stops, and those lines take the common ending.
    const source = Array.from({ length: 20_000 }, (_, index) => (index % 2 ? 'x' : 'y'));
    const saved = ['start', ...source.slice(1, -1).reverse(), 'end'];
    const started = performance.now();
    matchLines(source, saved);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
