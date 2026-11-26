import { describe, expect, it } from 'vitest';
import { rewriteMintlifyInternalLinks } from './mintlify-links';

const routes = new Map([['topic/next', '/topic-2/next']]);
const rewrite = (source: string) => rewriteMintlifyInternalLinks(source, 'intro', routes);
const longTail = `\n\n${'An ordinary paragraph longer than a line.\n\n'.repeat(140)}`;

describe('reference definitions in imports (#686)', () => {
  it.each([
    ['a root definition', '[Go][r]\n\n[r]: /topic/next "Title"'],
    ['a quote with a multiline title', '> [Go][r]\r\n>\r\n> [r]: </topic/next>\r\n>   "First line\r\n>    second line"'],
    ['a list item', '- [Go][r]\n\n  [r]: /topic/next (Title)'],
    ['a balanced MDX component', '<Note>\n[Go][r]\n\n[r]: /topic/next\n</Note>'],
    ['CommonMark after an incomplete MDX component', '[Go][r]\n\n[r]: /topic/next\n\n<Note>'],
  ])('rewrites %s on a page longer than the former cap', (_reason, page) => {
    const source = page + longTail;
    expect(rewrite(source)).toBe(page.replace('/topic/next', '/topic-2/next') + longTail);
  });

  it('changes only the first link definition and keeps a link/image definition and code as authored on a long page', () => {
    const source =
      '[Go][r] [Also][shared] ![Image][shared]\n\n' +
      '[r]: /topic/next "First"\n[r]: /topic/next "Duplicate"\n[shared]: /topic/next\n\n' +
      '[looks-real]: /topic/next extra text\n\n~~~md\n[r]: /topic/next\n~~~' +
      longTail;
    expect(rewrite(source)).toBe(source.replace('[r]: /topic/next "First"', '[r]: /topic-2/next "First"'));
  });

  it.each(['', longTail])('preserves link-shaped text inside a title on both source sizes', (tail) => {
    const source = `[Go][r]\n\n[r]: /topic/next '[Literal](/topic/next) <a href="/topic/next">'${tail}`;
    expect(rewrite(source)).toBe(source.replace('[r]: /topic/next', '[r]: /topic-2/next'));
  });
});
