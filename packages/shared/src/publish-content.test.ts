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

  it('finds video embeds without a title, frames shown as links, and videos without a secure address', () => {
    const content = [
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=5"></iframe>',
      '',
      '<iframe src="https://vimeo.com/76979871" title="Titled"></iframe>',
      '',
      '<Frame caption="Pen">',
      '  <iframe src="https://codepen.io/x" title="Pen"></iframe>',
      '</Frame>',
      '',
      '<iframe src="http://example.com/frame"></iframe>',
      '',
      '<video controls src="http://cdn.example.com/a.mp4"></video>',
      '',
      '<video controls src="https://cdn.example.com/b.mp4">',
      '  <source src="ftp://cdn.example.com/b.webm" type="video/webm" />',
      '</video>',
      '',
      '<video controls src="/api/public/projects/p/assets/c.mp4"></video>',
      '',
      '<picture><source srcset="dark.png"><img src="light.png" alt="Logo"></picture>',
      '',
      '```html',
      '<iframe src="https://youtu.be/dQw4w9WgXcQ"></iframe>',
      '<video src="http://in-code.example/a.mp4"></video>',
      '```',
    ].join('\n');
    const facts = pageContentFacts(content);
    expect(facts.untitledEmbeds).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s']);
    expect(facts.embedsAsLinks).toEqual(['https://codepen.io/x', 'http://example.com/frame']);
    expect(facts.insecureVideos).toEqual(['http://cdn.example.com/a.mp4', 'ftp://cdn.example.com/b.webm']);
  });

  it('reports no embeds for a page without raw HTML', () => {
    const facts = pageContentFacts('# Title\n\n[YouTube](https://youtu.be/dQw4w9WgXcQ)');
    expect([facts.untitledEmbeds, facts.embedsAsLinks, facts.insecureVideos]).toEqual([[], [], []]);
  });
});
