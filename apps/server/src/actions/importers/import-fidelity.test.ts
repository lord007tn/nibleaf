import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const videos = [
  ['https://youtu.be/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk'],
  ['https://vimeo.com/12345678', 'https://player.vimeo.com/video/12345678'],
  ['https://loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'],
  ['https://demo.wistia.com/medias/abc123def4', 'https://fast.wistia.net/embed/iframe/abc123def4'],
  ['https://media.example.test/tour.mp4', 'https://media.example.test/tour.mp4'],
] as const;
const gitbook = (text: string) => convertGitBookMarkdown(text, { resolveFile: () => undefined });

describe('synthetic import fidelity', () => {
  for (const [url, canonical] of videos) {
    it.each(['liquid', 'video block', 'iframe', 'video', 'link'])(`maps ${url} from %s with a title`, (form) => {
      const source =
        form === 'liquid'
          ? `{% embed url="${url}" %}`
          : form === 'video block'
            ? `{% video src="${url}" %}`
            : form === 'link'
              ? `[Tour](${url})`
              : `<${form} src="${url}" title="Tour"></${form}>`;
      for (const content of [
        gitbook(`Tour\n\n${source}`).content,
        ...(form === 'liquid' || form === 'video block' ? [] : [normalizeMintlifyMdx(`Tour\n\n${source}`)]),
      ]) {
        expect(content).toContain(`src="${canonical}"`);
        if (url.endsWith('.mp4')) expect(content).toMatch(/<video\b[^>]*\bcontrols(?:[\s=>])/);
        else expect(content).toContain('title="Tour"');
      }
    });
  }
  it('keeps captions and derives Arabic titles from surrounding text', () => {
    expect(gitbook('فيديو الشرح:\n\n{% embed url="https://youtu.be/abcdefghijk" %}').content).toContain('title="فيديو الشرح:"');
    expect(gitbook('{% embed url="https://vimeo.com/12345678" %}\nA tour\n{% endembed %}').content).toContain('<Frame caption="A tour">');
  });
  it.each([gitbook, (text: string) => ({ content: normalizeMintlifyMdx(text) })])(
    'restores paragraph dividers and removes only embed-adjacent slash paragraphs',
    (convert) => {
      const content = convert(
        'Keep / in text.\n\n/\n\nUnrelated.\n\n<p>---</p>\n\nTour\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>\n\n/\n\nEnd.',
      ).content;
      expect(content).toContain('\n\n---\n\n');
      expect(content).toContain('\n\n/\n\nUnrelated.');
      expect(content).toContain('Keep / in text.');
      expect(content).not.toContain('</iframe>\n\n/');
    },
  );
  it('keeps ordinary inline links and code literal', () => {
    const source =
      'Watch [Tour](https://youtu.be/abcdefghijk) later.\n\n```md\n<p>---</p>\n/\n<iframe src="https://youtu.be/abcdefghijk"></iframe>\n```';
    expect(gitbook(source).content).toBe(source);
    expect(normalizeMintlifyMdx(source)).toBe(source);
  });
  it('keeps unknown https frames and reports every unmapped occurrence', () => {
    const result = gitbook('{% embed url="https://frame.example.test/tour" %}\n\n{% embed url="http://unsafe.example.test/tour" %}');
    expect(result.content).toContain('<iframe src="https://frame.example.test/tour" title=');
    expect(result.issues).toHaveLength(2);
  });
  it.each(['en', 'ar'])('rewrites source and app links, keeps anchors and external links (%s)', (lang) => {
    const issues: unknown[] = [];
    const result = rewriteMintlifyInternalLinks(
      `[App](https://nibleaf.com/pages/start?lang=${lang}#install)\n[Source](https://help.example.test/start#ready)\n[External](https://elsewhere.example.test/start)\n[Missing](https://help.example.test/missing)`,
      'intro',
      new Map([['start', '/guides/start']]),
      { sourceUrl: 'https://help.example.test', onUnresolved: (reference) => issues.push(reference) },
    );
    expect(result).toContain(`[App](/guides/start?lang=${lang}#install)`);
    expect(result).toContain('[Source](/guides/start#ready)');
    expect(result).toContain('[External](https://elsewhere.example.test/start)');
    expect(issues).toEqual(['https://help.example.test/missing']);
  });
});

it('reports each repeated unmapped frame and preserves unsafe media for repair', () => {
  const result = gitbook(
    '<iframe src="https://frame.example.test/tour"></iframe>\n\n<iframe src="https://frame.example.test/tour"></iframe>\n\n<video src="http://media.example.test/tour.mp4"></video>',
  );
  expect(result.issues).toHaveLength(3);
  expect(result.content).toContain('http://media.example.test/tour.mp4');
});

it('keeps unreadable raw media byte for byte and reports it for repair', () => {
  const source = '<iframe src="https://youtu.be/abcdefghijk" title="a < b"></iframe>';
  const result = gitbook(source);
  expect(result.content).toBe(source);
  expect(result.issues).toHaveLength(1);
});

it('keeps a Mintlify Frame caption and uses it as an absent video title', () => {
  const imported = normalizeMintlifyMdx('<Frame caption="A guided tour">\n  <iframe src="https://youtu.be/abcdefghijk"></iframe>\n</Frame>');
  expect(imported).toContain('<Frame caption="A guided tour">');
  expect(imported).toContain('title="A guided tour"');
});

it('removes only slash artifacts beside a captioned video Frame', () => {
  const source =
    'Keep / in text.\n\n/\n\n<Frame caption="Tour">\n\n<iframe src="https://youtu.be/abcdefghijk" title="Tour"></iframe>\n\n</Frame>\n\n/\n\nEnd.';
  const result = gitbook(source).content;
  expect(result).toContain('Keep / in text.');
  expect(result).not.toContain('\n/\n');
  expect(result).toContain('<Frame caption="Tour">');
});

it.each(['"R&amp;D"', "'R&amp;D'"])('derives decoded titles from a Frame caption (%s)', (caption) => {
  expect(normalizeMintlifyMdx(`<Frame caption=${caption}>\n  <iframe src="https://youtu.be/abcdefghijk"></iframe>\n</Frame>`)).toContain(
    'title="R&amp;D"',
  );
});
