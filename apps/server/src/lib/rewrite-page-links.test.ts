import { describe, expect, it } from 'vitest';
import { rewritePageLinks } from './rewrite-page-links';

describe('rewritePageLinks', () => {
  const rewrite = (href: string) => (href.startsWith('/old') ? href.replace('/old', '/new') : href);

  it('council: expressions, multiline JSX props and HTML stay byte-identical', () => {
    const source = '{true && "[expression](/old)"}\n\n<Card\n  title="[prop](/old)"\n>\n\n[real](/old)\n\n</Card>\n\n<div>[html](/old)</div>';
    expect(rewritePageLinks(source, rewrite).content).toBe(source.replace('[real](/old)', '[real](/new)'));
  });

  it('preserves Arabic, emoji and CRLF bytes outside the patched destination', () => {
    const source = '# العربية 🧭\r\n\r\n[ابدأ 🚀](/old#تثبيت)\r\n\r\n```md\r\n[مثال](/old)\r\n```\r\n';
    expect(rewritePageLinks(source, rewrite).content).toBe(source.replace('](/old#تثبيت)', '](/new#تثبيت)'));
  });

  it('patches parsed destinations without changing MDX, titles, images or external links', () => {
    const source =
      '<Card title="[literal](/old)">\n\n[**Guide**](</old#heading> "Read this") and [](/old?x=(1)).\n\n![image](/old) [external](https://example.com/old)\n\n</Card>';
    expect(rewritePageLinks(source, rewrite)).toEqual({
      content: source.replace('</old#heading>', '</new#heading>').replace('[](/old?x=(1))', '[](/new?x=(1))'),
      linksUpdated: 2,
      documentsSkipped: 0,
    });
  });

  it('leaves fenced, indented, inline and container code unchanged, including unmatched fences', () => {
    const source =
      '[guide](/old)\n\n`[inline](/old)`\n\n    [indent](/old)\n\n> ~~~md\n> [quote](/old)\n> ~~~\n\n- ```md\n  [list](/old)\n  ```\n\n````md\n[code](/old)\n```\n[still code](/old)';
    expect(rewritePageLinks(source, rewrite)).toEqual({
      content: source.replace('[guide](/old)', '[guide](/new)'),
      linksUpdated: 1,
      documentsSkipped: 0,
    });
  });

  it('preserves escaped Markdown that is not a link', () => {
    expect(rewritePageLinks('\\[literal](/old) [real](/old)', rewrite)).toEqual({
      content: '\\[literal](/old) [real](/new)',
      linksUpdated: 1,
      documentsSkipped: 0,
    });
  });
});
