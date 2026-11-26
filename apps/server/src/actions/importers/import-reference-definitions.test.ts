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
    ['a component inside a quote', '> <Note>\n> [Go][r]\n>\n> [r]: /topic/next\n> </Note>'],
    ['a component beside valid inline MDX', '<Note>\n[Go][r]\n\n[r]: /topic/next\n</Note>\n\n<Badge>new</Badge>'],
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

  it('keeps a later duplicate shadowed even when the first definition exceeds the block cap', () => {
    const source = `[Go][r]\n\n[r]: /topic/next "${'x'.repeat(4200)}"\n[r]: /topic/next "Duplicate"`;
    expect(rewrite(source)).toBe(source);
  });

  it('keeps a duplicate shadowed by a syntactically valid definition with a non-rewritten protocol', () => {
    const source = `[Go][r]\n\n[r]: custom:payload\n\n[r]: /topic/next${longTail}`;
    expect(rewrite(source)).toBe(source);
    const rejectedByHtmlDefault = source.replace('custom:payload', 'data:text/plain,example');
    expect(rewrite(rejectedByHtmlDefault)).toBe(rejectedByHtmlDefault);
  });

  it('does not rewrite a definition inside an MDX comment', () => {
    const source = `<Note>\n\n{/*\n\n[Go][r]\n\n[r]: /topic/next "Hidden"\n\n*/}\n\n</Note>${longTail}`;
    expect(rewrite(source)).toBe(source);
  });
});
