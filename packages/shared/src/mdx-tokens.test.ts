import { describe, expect, it } from 'vitest';
import { activeBlockEnd } from './mdx-tokens';

/** The active-block scan as it was: the regex loop the hand-read scan must match. */
const ACTIVE_TAG = /<(\/?)(script|style|iframe|object|embed)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const regexActiveEnd = (source: string, start: number, limit: number): number => {
  ACTIVE_TAG.lastIndex = start;
  let depth = 0;
  for (let match = ACTIVE_TAG.exec(source); match && match.index < limit; match = ACTIVE_TAG.exec(source)) {
    const end = match.index + match[0].length;
    if (match[1]) {
      depth -= 1;
      if (depth <= 0) return Math.min(end, limit);
    } else if (!match[0].endsWith('/>')) depth += 1;
    else if (depth === 0) return end;
  }
  return limit;
};

const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const PIECES = ['<script', '<SCRIPT', '</script', '<style', '</style>', '<iframe', '<scripts', '<b', '>', '/>', '/', '"', "'", ' ', 'x', '=', '\n'];

describe('active blocks (script, style, iframe, object, embed)', () => {
  it('end where the regex scan ended them, on generated markup', () => {
    const next = random(5);
    for (let index = 0; index < 8000; index += 1) {
      const body = Array.from({ length: Math.floor(next() * 40) }, () => PIECES[Math.floor(next() * PIECES.length)]).join('');
      const source = `<script${body}`;
      expect(activeBlockEnd(source, 0), JSON.stringify(source)).toBe(regexActiveEnd(source, 0, source.length));
    }
  });

  it('end real blocks after their own close tag', () => {
    const source = '<script type="a>b">if (a > b) {}</script> after <style>x</style>';
    expect(source.slice(0, activeBlockEnd(source, 0))).toBe('<script type="a>b">if (a > b) {}</script>');
    expect(activeBlockEnd('<style a="1"/> text', 0)).toBe('<style a="1"/>'.length);
  });
});
