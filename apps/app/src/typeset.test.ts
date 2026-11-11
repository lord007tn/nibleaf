import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'typeset.css'), 'utf8');
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('reader inline code direction', () => {
  it('isolates every inline code span as left-to-right', () => {
    expect(rule('&:where(:not(pre) > code)')).toMatch(/direction: ltr;[\s\S]*unicode-bidi: isolate;/);
  });

  it('keeps an inline command in right-to-left prose together as one box, leaving LTR pages and code blocks alone', () => {
    const rtl = rule('&:where(:not(pre):dir(rtl) > code)');
    expect(rtl).toContain('display: inline-block;');
    expect(rtl).toContain('max-width: 100%;');
    expect(rtl).toContain('overflow-wrap: anywhere;');
    expect(rule('&:where(pre)')).not.toContain('inline-block');
  });

  // dir="auto" blocks carry no explicit dir="rtl" ancestor, and an LTR block inside an
  // RTL page has one it must ignore, so the rule keys on the parent's resolved direction.
  it('matches on the resolved direction of the parent, not an ancestor attribute', () => {
    expect(css).not.toContain('[dir="rtl"] :not(pre) > code');
  });
});
