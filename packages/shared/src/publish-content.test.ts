import { describe, expect, it } from 'vitest';
import { pageContentFacts } from './publish-checks';

describe('pageContentFacts', () => {
  it('finds images without alt text: inline, reference-style, multiline <img>, and inside components', () => {
    const content = [
      '![](/inline.png) ![Described](/ok.png)',
      '',
      '![][shot]',
      '',
      '[shot]: /reference.png',
      '',
      '<img',
      '  src="/multiline.png"',
      '/>',
      '',
      '<Frame>',
      '  <img src="/framed.png" alt="" />',
      '</Frame>',
      '',
      '<img src="/fine.png" alt="Chart" />',
      '',
      '<img src="/expression.png" alt={caption} />',
    ].join('\n');
    expect(pageContentFacts(content).imagesWithoutAlt).toEqual(['/inline.png', '/reference.png', '/multiline.png', '/framed.png']);
  });

  it('finds raw-HTML images in content that is not valid MDX', () => {
    expect(pageContentFacts('<!-- note -->\n\n<img\n  src="/raw.png">').imagesWithoutAlt).toEqual(['/raw.png']);
  });

  it('ignores images in code and comments', () => {
    expect(pageContentFacts('```\n![](/a.png)\n```\n\n<!-- ![](/b.png) -->').imagesWithoutAlt).toEqual([]);
  });

  it('finds stray text: a lone / paragraph, a literal --- and <p> leftovers, not dividers or code', () => {
    const content = ['Intro.', '', '/', '', '\\---', '', '---', '', 'Open / to search.', '', '```', '/', '```'].join('\n');
    expect(pageContentFacts(content).strayText).toEqual(['/', '---']);
    expect(pageContentFacts('<p>---</p>').strayText).toEqual(['---']);
  });
});
