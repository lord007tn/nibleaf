import { describe, expect, it } from 'vitest';
import { normalizeLineEndings, putBackLineEndings, readLineEndings, restoreLineEndings } from './line-endings';

/*
 * A save with the source's endings put back reads back as the serializer wrote
 * it, line for line (#702): normalizing its CRLF and lone CR to LF, as the reader
 * does, gives the save. A lone CR before an empty line and an LF would read as one
 * CRLF and lose that line. Generated pages: every mix of CRLF, LF and lone CR,
 * with empty, repeated and unique lines, saved after random line insertions,
 * deletions and edits (or none). The check is on the endings as put back, before
 * `restoreLineEndings`' own read-back guard, which must then never fire.
 */

const SEED = 0x70_2c_ad_01;
const CASES = 5000;

describe('a save with its endings put back reads back line for line (#702)', () => {
  it(`holds for ${CASES} generated pages and saves`, () => {
    let state = SEED;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const pick = <T>(values: readonly T[]): T => values[next() % values.length] as T;
    const line = () => pick(['', '', '', 'x', 'x', 'y', '# H', '- item', `line ${next() % 40}`, `unique ${next()}`]);
    // Each mix weighted differently: only CR and LF, only CR and CRLF, all three.
    const MIXES = [
      ['\r', '\n'],
      ['\r', '\r\n'],
      ['\r', '\n', '\r\n'],
      ['\r', '\r', '\n'],
      ['\n', '\n', '\r\n', '\r'],
    ] as const;

    const failures: Array<{ source: string; saved: string; put: string }> = [];
    let edited = 0;
    let unedited = 0;
    for (let index = 0; index < CASES; index++) {
      const mix = pick(MIXES);
      const count = 1 + (next() % 30);
      let source = '';
      for (let at = 0; at < count; at++) source += line() + (at < count - 1 || next() % 3 === 0 ? pick(mix) : '');
      // Every page has a CR: a page with only LF has nothing to put back.
      if (!source.includes('\r')) source += `\r${line()}`;
      const endings = readLineEndings(source);
      if (!endings) throw new Error('a page with a CR has endings');
      const lines = endings.normalized.split('\n');
      const operations = next() % 6;
      for (let step = 0; step < operations; step++) {
        const at = next() % (lines.length + 1);
        const kind = next() % 3;
        if (kind === 0) lines.splice(at, 0, line());
        else if (kind === 1 && lines.length > 1) lines.splice(Math.min(at, lines.length - 1), 1);
        else lines[Math.min(at, lines.length - 1)] = pick(['', 'edited', `edited ${next() % 5}`]);
      }
      const saved = lines.join('\n');
      if (saved === endings.normalized) unedited++;
      else edited++;
      const put = putBackLineEndings(endings, saved);
      if (normalizeLineEndings(put) !== saved || restoreLineEndings(endings, saved) !== put) failures.push({ source, saved, put });
      if (saved === endings.normalized) expect(put).toBe(source);
    }
    console.info(`[line-endings-property] ${CASES} cases: ${edited} edited, ${unedited} unedited, ${failures.length} failures`);
    expect(edited + unedited).toBe(CASES);
    expect(failures.slice(0, 3)).toEqual([]);
  });
});
