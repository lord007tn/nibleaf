import { pageContentFacts } from '@nibleaf/shared/publish-checks';
import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { normalizeMdxBlocks } from '@nibleaf/shared/reader-markdown';
import { importSiteHref } from '@nibleaf/shared/site-links';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { rewriteGitBookImages } from './gitbook-assets';
import { convertGitBookMarkdown, findGitBookSpaceLinks } from './gitbook-markdown';
import { normalizeImportFidelity } from './import-fidelity';
import { protectImportCode } from './import-markdown-code';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const videos = [
  ['https://youtu.be/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk'],
  ['https://vimeo.com/12345678', 'https://player.vimeo.com/video/12345678'],
  ['https://loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef'],
  ['https://demo.wistia.com/medias/abc123def4', 'https://fast.wistia.net/embed/iframe/abc123def4'],
  ['https://media.example.test/tour.mp4', 'https://media.example.test/tour.mp4'],
] as const;
const gitbook = (text: string) => convertGitBookMarkdown(text, { resolveFile: () => undefined });

it.each(['%s\t', '%s ', '<%s\t>', '< %s>'])("doesn't promote a padded standalone URL: %j", (shape) => {
  const source = shape.replace('%s', 'https://youtu.be/abcdefghijk');
  expect(normalizeImportFidelity(source)).toBe(source);
});

// Leading spaces, tabs and quote markers are Markdown container syntax, not URL padding.
const indentedYoutube = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const youtubeFrame = '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"';
it.each([
  ['list continuation', `- item\n\n  ${indentedYoutube}\n`, `\n  ${youtubeFrame}`],
  ['one space', ` ${indentedYoutube}\n`, youtubeFrame],
  ['three spaces', `   ${indentedYoutube}`, youtubeFrame],
  ['three spaces after prose', `Intro.\n\n   ${indentedYoutube}`, `\n   ${youtubeFrame}`],
  ['quote with spaces', `>   ${indentedYoutube}`, `>   ${youtubeFrame}`],
  ['indented angle link', `Intro.\n\n  <${indentedYoutube}>`, `\n  ${youtubeFrame}`],
  ['angle link with a trailing space', `<${indentedYoutube}> `, youtubeFrame],
  ['indented .mp4', '  https://example.com/v.mp4\n', 'src="https://example.com/v.mp4"'],
])('promotes an indented standalone URL: %s', (_name, source, expected) => {
  const output = normalizeImportFidelity(source);
  expect(output).toContain(expected);
  if (source.includes('.mp4')) expect(output).toMatch(/^<video\b/);
});

it('promotes standalone URLs with structural quote and CRLF bytes', () => {
  const source = '> https://youtu.be/abcdefghijk\r\n\r\nAfter.';
  expect(normalizeImportFidelity(source)).toContain('> <iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"');
});

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

it.each([
  ...['http', 'https'].map((scheme) => {
    const src = `${scheme}://cdn.test/a.mp4`;
    return { name: `${scheme} video`, opener: `<video src="${src}">`, report: src, addresses: [src] };
  }),
  { name: 'video without a source', opener: '<video>', report: '', addresses: [] },
  {
    name: 'video with source and track',
    opener: '<video>\n<source src="https://cdn.test/a.mp4">\n<track src="/captions.vtt">',
    report: '',
    addresses: ['https://cdn.test/a.mp4', '/captions.vtt'],
  },
  {
    name: 'video with missing child addresses',
    opener: '<video>\n<source>\n<track>',
    report: '',
    addresses: [],
  },
  {
    name: 'HTTPS iframe',
    opener: '<iframe src="https://youtu.be/abcdefghijk">',
    report: 'https://youtu.be/abcdefghijk',
    addresses: ['https://youtu.be/abcdefghijk'],
  },
  {
    name: 'HTTP iframe',
    opener: '<iframe src="http://frame.test/tour">',
    report: 'http://frame.test/tour',
    addresses: ['http://frame.test/tour'],
  },
  { name: 'iframe without an address', opener: '<iframe>', report: '', addresses: [] },
])('imports an unclosed $name as repairable text and links in both converters', ({ opener, report, addresses }) => {
  const source = `${opener}\n\nFollow with [Guide](/guide).`;
  const gitbookResult = gitbook(source);
  const reports: string[] = [];
  const mintlify = normalizeMintlifyMdx(source, (reference) => reports.push(reference));
  expect(gitbookResult.issues).toEqual([{ kind: 'embed', page: '', reference: report }]);
  expect(reports).toEqual([report]);
  for (const content of [gitbookResult.content, mintlify]) {
    expect(content).not.toMatch(/<(?:video|source|track|iframe)\b/i);
    expect(content.endsWith('Follow with [Guide](/guide).')).toBe(true);
    expect([...content.matchAll(/<a href="([^"]+)">/g)].map((match) => match[1])).toEqual(addresses);
    if (addresses.length === 0) expect(content).toContain('&lt;');
  }
});

it.each(['<video>\n\n', '> <video>\n', '- <video>\n'])('leaves media after a blank or container exit untouched: %j', (prefix) => {
  const outside = '<source src="https://cdn.test/unrelated.mp4">';
  const source = `${prefix}${outside}\n\nFollow.`;
  for (const content of [gitbook(source).content, normalizeMintlifyMdx(source)]) {
    expect(content.endsWith(`${outside}\n\nFollow.`)).toBe(true);
  }
});

it('keeps sources and tracks on a closed video', () => {
  const children = '<source src="https://cdn.test/a.mp4">\n<track src="/captions.vtt">';
  const source = `<video controls>\n${children}\n</video>\n\nFollow.`;
  expect(gitbook(source).content).toBe(source);
  expect(normalizeMintlifyMdx(source)).toBe(source);
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

describe('Imported URL safety', () => {
  it.each([
    'https://help.test//evil.test/next',
    'https://nibleaf.com/pages//evil.test/next',
    'https://help.test/\\evil.test/next',
    'https://nibleaf.com/pages/\\evil.test/next',
  ])('retains and reports a link that would change origin: %s', (url) => {
    const result = importSiteHref(url, 'https://help.test', ['https://nibleaf.com']);
    expect(new URL(result, 'https://help.test').origin).toBe(new URL(url).origin);
    expect(result).toBe(url);
    const issues: string[] = [];
    expect(
      rewriteMintlifyInternalLinks(`[Next](${url})`, 'intro', new Map(), {
        sourceUrl: 'https://help.test',
        onUnresolved: (href) => issues.push(href),
      }),
    ).toBe(`[Next](${url})`);
    expect(issues).toEqual([url]);
  });

  it.each([
    'https://youtu.be\\abcdefghijk',
    'http://youtu.be/abcdefghijk',
    '//youtu.be/abcdefghijk',
    'javascript:alert(1)',
    'data:text/html,<video></video>',
    'https://youtu.be/abc\tdefghijk',
    'https://youtu.be/abc\ndefghijk',
    'https://youtu.be/abc\u0000defghijk',
    '\thttps://youtu.be/abcdefghijk',
    'https://youtu.be/abcdefghijk\r',
  ])('keeps a rejected GitBook media address inert in the reader and publish checks: %j', (url) => {
    for (const input of [`{% video src="${url}" %}`, `<iframe src="${url}" title="Demo"></iframe>`]) {
      const result = gitbook(input);
      expect(result.issues).toHaveLength(1);
      expect(result.content).not.toMatch(/<(?:iframe|video)\b/i);
      const reader = normalizeMdxBlocks(result.content);
      expect(reader).not.toMatch(/<(?:mdxembed|iframe|video)\b/i);
      const facts = pageContentFacts(result.content);
      expect(facts.untitledEmbeds).toEqual([]);
      expect(facts.embedsAsLinks).toEqual([]);
      expect(facts.insecureVideos).toEqual([]);
    }
  });
});

const converters = [
  [
    'GitBook',
    (source: string) => {
      const result = gitbook(source);
      return { content: result.content, issues: result.issues.map(({ reference }) => reference) };
    },
  ],
  [
    'Mintlify',
    (source: string) => {
      const issues: string[] = [];
      return { content: normalizeMintlifyMdx(source, (reference) => issues.push(reference)), issues };
    },
  ],
] as const;

describe('Imported media and protected code', () => {
  const parser = new MarkdownIt({ html: true });

  it.each(converters)('%s keeps protected code out of a fallback embed title', (_name, convert) => {
    const code = '    "quoted <example>"';
    const result = convert(`Example:\n\n${code}\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>`);
    expect(result.content.split(code)).toHaveLength(2);
    expect(result.content).not.toContain('\uE000');
    expect(result.content).toMatch(/<iframe src="https:\/\/www.youtube-nocookie.com\/embed\/abcdefghijk" title="(?:Example:|Video)"><\/iframe>/);
  });

  it.each(converters)('%s preserves indented and container code byte for byte', (_name, convert) => {
    for (const source of [
      '    [Tour](https://youtu.be/abcdefghijk)',
      'Example:\n\n    [Demo](https://youtu.be/abcdefghijk)\n    /\n    \\---',
      '- Example:\n\n      [Demo](https://youtu.be/abcdefghijk)\n      /\n      \\---',
      '> Example:\n>\n>     [Demo](https://youtu.be/abcdefghijk)\n>     /\n>     \\---',
      '- Example:\n\n  ```md\n  [Demo](https://youtu.be/abcdefghijk)\n  /\n  \\---\n  ```',
      '> ```md\n> [Demo](https://youtu.be/abcdefghijk)\n> /\n> \\---\n> ```',
    ]) {
      expect(convert(source).content).toBe(source);
      expect(convert(source).issues).toEqual([]);
    }
  });

  it.each(converters)('%s keeps a provider link embed and its following paragraph in one container', (_name, convert) => {
    for (const source of [
      '- Step one\n\n  [Demo](https://youtu.be/abcdefghijk)\n\n  Finish.',
      '- Outer\n\n  - Step one\n\n    [Demo](https://youtu.be/abcdefghijk)\n\n    Finish.',
      '> Step one\n>\n> [Demo](https://youtu.be/abcdefghijk)\n>\n> Finish.',
    ]) {
      const result = convert(source).content;
      const html = parser.render(result);
      if (source.startsWith('>')) expect(html).toMatch(/<blockquote>[\s\S]*<iframe[\s\S]*Finish\.[\s\S]*<\/blockquote>/);
      else {
        expect(result).toMatch(/\n {2,4}<iframe/);
        const item = html.slice(html.lastIndexOf('<li>'));
        expect(item.indexOf('<iframe')).toBeGreaterThan(0);
        expect(item.indexOf('Finish.')).toBeLessThan(item.indexOf('</li>'));
      }
    }
  });

  it.each(converters)('%s preserves video poster, title, source and captions', (_name, convert) => {
    const source =
      '<video controls poster="/poster.png" title="Training"><source src="https://media.test/training.mp4" type="video/mp4"><track kind="captions" src="/training.vtt" srclang="en" label="English"></video>';
    const result = convert(source);
    expect(result.content).toBe(source);
    expect(result.issues).toEqual([]);
  });

  it.each(converters)('%s adds controls to a video with source children and preserves its poster', (_name, convert) => {
    const result = convert(
      '<video poster="https://posters.test/training.png" title="Training"><source src="https://media.test/training.mp4"></video>',
    );
    expect(result.content).toContain('poster="https://posters.test/training.png" title="Training"');
    expect(result.content).toContain('controls="true"');
    expect(result.issues).toEqual([]);
    expect(pageContentFacts(result.content).hiddenPosters).toEqual(['https://posters.test/training.png']);
  });

  it.each(converters)('%s uses surrounding prose for a title when inline code contains quotes', (_name, convert) => {
    const code = '`a "b" < c`';
    const { content } = convert(`Heading "safe" & sound\n\nText ${code}\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>`);
    expect(content.split(code)).toHaveLength(2);
    expect(content).not.toContain('\uE000');
    const embed = scanAuthoredEmbeds(content)[0];
    expect([...(embed?.attributes.keys() ?? [])]).toEqual(['src', 'title']);
    expect(embed?.attributes.get('title')).toBe('Heading "safe" & sound');
    expect(content).toContain('title="Heading &quot;safe&quot; &amp; sound"');
  });
});

describe.each(converters)('%s media conversion', (_name, convert) => {
  it.each([
    ['label', '[Demo `a "b" <c>`](https://youtu.be/abcdefghijk)'],
    ['caption', '<Frame caption=\'Demo `a "b" <c>`\'>\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>\n\n</Frame>'],
  ])('keeps an inline-code %s out of generated title attributes', (_form, source) => {
    const { content } = convert(source);
    const embed = scanAuthoredEmbeds(content)[0];
    expect(content).not.toContain('\uE000');
    expect(embed?.closed).toBe(true);
    expect([...(embed?.attributes.keys() ?? [])]).toEqual(['src', 'title']);
    expect(embed?.attributes.get('title')).toBe('Video');
    expect(content).toContain('title="Video"></iframe>');
  });

  it.each([
    ['CR', '\r', '\r'],
    ['CRLF', '\r\n', '\r\n'],
    ['mixed', '\r\n', '\r'],
  ])('preserves logical code lines with their %s bytes', (_label, ending, codeEnding) => {
    const code = `    ![Example](./next.png)${codeEnding}    [Literal](https://help.test/next)`;
    const source = `Intro${ending}${ending}${code}`;
    const protectedCode = protectImportCode(source);
    expect(protectedCode.content).not.toContain('./next.png');
    expect(protectedCode.restore(protectedCode.content)).toBe(source);
    const { content: converted } = convert(source);
    const rewritten = rewriteMintlifyAssetReferences(converted, 'intro.mdx', new Set(['next.png']), (path) => `https://assets.test/${path}`);
    expect(rewritten.content).toContain(code);
    expect(rewritten.resolved).toEqual([]);
    expect(rewritten.missing).toEqual([]);
    expect(rewriteGitBookImages(converted, 'intro.md', new Set(['next.png']), '', (path) => `https://assets.test/${path}`).content).toContain(code);
    const component = `<CodeGroup>${ending}  \`\`\`md${ending}  ![Example](./next.png)${codeEnding}  [Literal](https://help.test/next)${ending}  \`\`\`${ending}</CodeGroup>`;
    expect(convert(component).content).toContain(`![Example](./next.png)${codeEnding}`);
  });

  it('does not extend an indented literal fence into following prose', () => {
    const { content } = convert('    ```md\n\n[Demo](https://youtu.be/abcdefghijk)');
    expect(content).toContain('    ```md');
    expect(content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Demo"></iframe>');
  });

  it('keeps a false closer in code while still converting a real embed below it', () => {
    const code = '```md\n    ```\n<Frame>\n[Literal](https://youtu.be/abcdefghijk)\n```';
    const { content } = convert(`${code}\n\n[Demo](https://youtu.be/abcdefghijk)`);
    expect(content).toContain(code);
    expect(content).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Demo"></iframe>');
    const mdx = '<CodeGroup>\n\n  ```md\n  ![Example](./example.png)\n    ```\n</CodeGroup>\n\n![Real](./example.png)';
    expect(rewriteMintlifyAssetReferences(mdx, 'intro.mdx', new Set(['example.png']), (path) => `https://assets.test/${path}`).content).toBe(
      '<CodeGroup>\n\n  ```md\n  ![Example](./example.png)\n    ```\n</CodeGroup>\n\n![Real](https://assets.test/example.png)',
    );
  });

  it.each([true, false])('retains top-level video attributes and caption track (controls present: %s)', (controls) => {
    const opener = `<video src="https://cdn.test/a.mp4" poster="/poster.jpg" title="Original" width="640"${controls ? ' controls' : ''}>`;
    const children = '<track kind="captions" src="/captions.vtt" srclang="en"></video>';
    const expectedOpener = controls ? opener : `${opener.slice(0, -1)} controls="true">`;
    expect(convert(opener + children)).toEqual({ content: expectedOpener + children, issues: [] });
  });

  it.each(['> ', '- ', '1. '])('keeps images in code after a fence-like %s marker', (prefix) => {
    const source = `<CodeGroup>\n  \`\`\`md\n  ${prefix}\`\`\`\n  ![Example](./example.png)\n  \`\`\`\n</CodeGroup>`;
    const blobs = new Set(['example.png']);
    const raw = (path: string) => `https://assets.test/${path}`;
    const { content } = convert(`${source}\n\n![Real](./example.png)`);
    for (const rewritten of [
      rewriteMintlifyAssetReferences(content, 'intro.mdx', blobs, raw),
      rewriteGitBookImages(content, 'intro.md', blobs, '', raw),
    ]) {
      expect(rewritten.content).toContain('![Example](./example.png)');
      expect(rewritten.content).toContain('![Real](https://assets.test/example.png)');
    }
    expect(rewriteMintlifyAssetReferences(source, 'intro.mdx', blobs, raw).content).toBe(source);
  });

  it('closes a quoted fence before migrating the following image', () => {
    const source = '<CodeGroup>\n  > ```md\n  > ![Example](./example.png)\n  > ```\n</CodeGroup>\n\n![Real](./example.png)';
    const rewritten = rewriteMintlifyAssetReferences(
      convert(source).content,
      'intro.mdx',
      new Set(['example.png']),
      (path) => `https://assets.test/${path}`,
    );
    expect(rewritten.content).toContain('![Example](./example.png)');
    expect(rewritten.content).toContain('![Real](https://assets.test/example.png)');
  });

  it('migrates only the prose image after repeated fenced examples', () => {
    const source = '<CodeGroup>\n  ```md\n  ![Example](./example.png)\n  ```\n</CodeGroup>';
    const blobs = new Set(['example.png']);
    const raw = (path: string) => `https://assets.example.test/${path}`;
    const before = rewriteMintlifyAssetReferences(source, 'intro.mdx', blobs, raw);
    expect(before.content).toBe(source);
    expect(before.resolved).toEqual([]);
    const { content: converted } = convert(source);
    expect(rewriteGitBookImages(converted, 'intro.md', blobs, '', raw).content).toBe(converted);
    expect(converted).toContain('![Example](./example.png)');
    const prose = rewriteMintlifyAssetReferences(`${source}\n\n![Real](./example.png)`, 'intro.mdx', blobs, raw);
    expect(prose.content).toBe(`${source}\n\n![Real](https://assets.example.test/example.png)`);
    const withBlank = '<CodeGroup>\n  ```md\n  ![Example](./example.png)\n\n  ![Example](./example.png)\n  ```\n</CodeGroup>';
    expect(rewriteMintlifyAssetReferences(withBlank, 'intro.mdx', blobs, raw).content).toBe(withBlank);
    expect(rewriteGitBookImages(convert(withBlank).content, 'intro.md', blobs, '', raw).content).not.toContain('https://assets.example.test');
    const repeated = `${withBlank}\n\n${withBlank}\n\n![Real](./example.png)`;
    expect(rewriteMintlifyAssetReferences(repeated, 'intro.mdx', blobs, raw).content).toBe(
      `${withBlank}\n\n${withBlank}\n\n![Real](https://assets.example.test/example.png)`,
    );
  });

  const codeForms = [
    ['indented Markdown', 'Example:\n\n    [Next](https://help.test/next)\n    [Missing](https://help.test/missing)'],
    ['blockquote code', '> Example:\n>\n>     [Next](https://help.test/next)\n>     [Missing](https://help.test/missing)'],
    ['indented HTML anchor', 'Example:\n\n    <a href="https://help.test/next">Next</a>\n    <a href="https://help.test/missing">Missing</a>'],
  ] as const;

  it.each(codeForms)('keeps a %s literal and out of link discovery and reports', (_form, source) => {
    const issues: string[] = [];
    const { content: converted, issues: conversionIssues } = convert(source);
    issues.push(...conversionIssues);
    expect(converted).toBe(source);
    const linked = rewriteMintlifyInternalLinks(converted, 'intro', new Map([['next', '/guide/next']]), {
      sourceUrl: 'https://help.test',
      onUnresolved: (url) => issues.push(url),
    });
    expect(issues).toEqual([]);
    expect(linked).toBe(source);
    expect(mintlifyInternalLinkTargets(linked, 'intro', 'https://help.test')).toEqual([]);
  });

  it('leaves code images and GitBook space URLs out of asset discovery', () => {
    const source = 'Example:\n\n    ![Example](./next.png)\n    ![Missing](./missing.png)\n    https://app.gitbook.com/s/neutral/next';
    const { content: converted } = convert(source);
    const blobs = new Set(['next.png']);
    expect(rewriteGitBookImages(converted, 'intro.md', blobs, '', (path) => `https://assets.test/${path}`)).toEqual({ content: source, missing: [] });
    expect(rewriteMintlifyAssetReferences(converted, 'intro.mdx', blobs, (path) => `https://assets.test/${path}`)).toEqual({
      content: source,
      missing: [],
      resolved: [],
    });
    expect(findGitBookSpaceLinks(converted)).toEqual([]);
  });
});
