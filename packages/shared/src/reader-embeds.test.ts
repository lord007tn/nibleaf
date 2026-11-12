import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { readerEmbedSource, rewriteReaderEmbeds, scanAuthoredEmbeds } from './reader-embeds';
import { normalizeMdxBlocks } from './reader-markdown';
import { readerSanitizeSchema } from './reader-sanitize';

const YT = 'dQw4w9WgXcQ';
const LOOM = '0123456789abcdef0123456789abcdef';

type Hast = { type: string; tagName?: string; properties?: Record<string, unknown>; value?: string; children?: Hast[] };

/** The reader's rich pipeline up to and including the sanitizer. */
const reader = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, readerSanitizeSchema);
const render = (content: string): Hast => reader.runSync(reader.parse(normalizeMdxBlocks(content))) as unknown as Hast;
const elements = (tree: Hast, tagName: string, into: Hast[] = []): Hast[] => {
  if (tree.type === 'element' && tree.tagName === tagName) into.push(tree);
  for (const child of tree.children ?? []) elements(child, tagName, into);
  return into;
};
const text = (tree: Hast): string => (tree.type === 'text' ? (tree.value ?? '') : (tree.children ?? []).map(text).join(''));

/** A real-shaped Mintlify page: its documented YouTube embed inside a Frame, and its video examples. */
const MINTLIFY_PAGE = `---
title: Product tour
---

Watch the tour first.

<Frame>
  <iframe
    className="w-full aspect-video rounded-xl"
    src="https://www.youtube.com/embed/${YT}?si=abc123"
    title="YouTube video player"
    frameBorder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  ></iframe>
</Frame>

<iframe src="https://www.loom.com/embed/${LOOM}" title="Loom walkthrough" style={{ width: "100%", height: 400 }} allowFullScreen></iframe>

<video
  autoPlay
  muted
  loop
  playsInline
  className="w-full aspect-video rounded-xl"
  src="https://cdn.example.com/demo.mp4"
></video>

<video controls onplay="alert(1)" poster="javascript:alert(1)" src="https://cdn.example.com/b.mp4">
  <source src="https://cdn.example.com/b.webm" type="video/webm" onerror="alert(1)" />
</video>

<iframe src="https://codepen.io/team/pen/abc" title="A pen" onload="alert(1)"></iframe>
`;

describe('normalizeMdxBlocks rewrites authored iframes', () => {
  it('turns an allowlisted player into the reader element with only its allowed props', () => {
    expect(normalizeMdxBlocks(`<iframe src="https://youtu.be/${YT}?t=30" title="Tour" width="560" onload="x()" allow="autoplay"></iframe>`)).toBe(
      `<mdxembed provider="youtube" videoid="${YT}" start="30" title="Tour"></mdxembed>`,
    );
  });

  it('rewrites a multi-line Mintlify iframe inside a Frame onto one line', () => {
    const normalized = normalizeMdxBlocks(MINTLIFY_PAGE);
    expect(normalized).toContain(
      `<mdxframe>\n\n  <mdxembed provider="youtube" videoid="${YT}" title="YouTube video player"></mdxembed>\n\n</mdxframe>`,
    );
    expect(normalized).toContain(
      '<video autoPlay muted loop playsInline className="w-full aspect-video rounded-xl" src="https://cdn.example.com/demo.mp4" ></video>',
    );
    expect(normalized).toContain(`<mdxembed provider="loom" videoid="${LOOM}" title="Loom walkthrough"></mdxembed>`);
    expect(normalized).not.toContain('<iframe');
    expect(normalized).not.toContain('allowFullScreen');
  });

  it('turns any other https frame into a link card, and anything else into text', () => {
    expect(rewriteReaderEmbeds('<iframe src="https://codepen.io/x?a=1&amp;b=2" title="Pen"></iframe>')).toBe(
      '<mdxembed href="https://codepen.io/x?a=1&amp;b=2" title="Pen"></mdxembed>',
    );
    expect(rewriteReaderEmbeds('<iframe src="http://example.com/x"></iframe>')).toBe('<mdxembed text="http://example.com/x"></mdxembed>');
    expect(rewriteReaderEmbeds('<iframe src="javascript:alert(1)"></iframe>')).toBe('<mdxembed text="javascript:alert(1)"></mdxembed>');
    expect(rewriteReaderEmbeds('<iframe src="data:text/html,&lt;script&gt;"></iframe>')).toBe(
      '<mdxembed text="data:text/html,&lt;script&gt;"></mdxembed>',
    );
    expect(rewriteReaderEmbeds(`<iframe src="https://www.youtube.com.evil.com/embed/${YT}"></iframe>`)).toBe(
      `<mdxembed href="https://www.youtube.com.evil.com/embed/${YT}"></mdxembed>`,
    );
    expect(rewriteReaderEmbeds('<iframe title="No source"></iframe>')).toBe('');
  });

  it('escapes what it copies, so a value cannot break out of its attribute', () => {
    expect(rewriteReaderEmbeds(`<iframe src='https://youtu.be/${YT}' title='a "b" &lt;c&gt; > &amp; d'></iframe>`)).toBe(
      `<mdxembed provider="youtube" videoid="${YT}" title="a &quot;b&quot; &lt;c&gt; &gt; &amp; d"></mdxembed>`,
    );
  });

  it('leaves a tag with a raw < in a value as written, which the sanitizer then drops', () => {
    const unread = `<iframe src="https://x.example/&quot;><script>alert(1)</script>"></iframe>`;
    expect(rewriteReaderEmbeds(unread)).toBe(unread);
    const page = render(unread);
    expect(elements(page, 'iframe')).toEqual([]);
    expect(elements(page, 'script')).toEqual([]);
  });

  it('reads JSX values, unquoted values and spreads', () => {
    expect(rewriteReaderEmbeds(`<iframe {...props} src={"https://youtu.be/${YT}"} title={\`Clip\`} height={400} allowFullScreen />`)).toBe(
      `<mdxembed provider="youtube" videoid="${YT}" title="Clip"></mdxembed>`,
    );
    expect(rewriteReaderEmbeds(`<IFRAME SRC=https://youtu.be/${YT}></IFRAME>`)).toBe(`<mdxembed provider="youtube" videoid="${YT}"></mdxembed>`);
    expect(rewriteReaderEmbeds('<iframe src={url}></iframe>')).toBe('');
  });

  it('keeps the first of a repeated attribute, as HTML does', () => {
    expect(rewriteReaderEmbeds(`<iframe src="https://youtu.be/${YT}" src="https://evil.example/"></iframe>`)).toBe(
      `<mdxembed provider="youtube" videoid="${YT}"></mdxembed>`,
    );
  });

  it('leaves code, inline code and tags it cannot read as written', () => {
    const fenced = `\`\`\`html\n<iframe src="https://youtu.be/${YT}"></iframe>\n\`\`\``;
    expect(normalizeMdxBlocks(fenced)).toBe(fenced);
    const inline = `Use \`<iframe src="https://youtu.be/${YT}"></iframe>\` here.`;
    expect(normalizeMdxBlocks(inline)).toBe(inline);
    for (const unread of ['<iframe src="https://youtu.be/x', '<iframe src="a" <b>', '<iframes src="x">', '<iframe-x src="x">', '<iframe']) {
      expect(rewriteReaderEmbeds(unread)).toBe(unread);
    }
  });

  it('drops what sits between an iframe’s tags in the same block, which a browser never shows', () => {
    const content = `<iframe src="https://youtu.be/${YT}" title="Tour">\n[Hidden](/hidden) <a href="/hidden-anchor">x</a> <iframe src="https://evil.example/">\n</IFRAME >\n\n[Visible](/visible)`;
    expect(rewriteReaderEmbeds(content)).toBe(`<mdxembed provider="youtube" videoid="${YT}" title="Tour"></mdxembed>\n\n[Visible](/visible)`);
    const links = elements(render(content), 'a').map((link) => link.properties?.href);
    expect(links).toEqual(['/visible']);
  });

  it('leaves an iframe whose closer is past a blank line as written, and keeps the content between', () => {
    const OTHER = 'M7lc1UVf-VE';
    const content = `<iframe src="https://youtu.be/${YT}">\n\n## Install\n\nRun it.\n\n<iframe src="https://youtu.be/${OTHER}"></iframe>`;
    expect(rewriteReaderEmbeds(content)).toBe(
      `<iframe src="https://youtu.be/${YT}">\n\n## Install\n\nRun it.\n\n<mdxembed provider="youtube" videoid="${OTHER}"></mdxembed>`,
    );
    const tree = render(content);
    expect(text(tree)).toContain('Install');
    expect(text(tree)).toContain('Run it.');
    expect(elements(tree, 'mdxembed').map((embed) => embed.properties?.videoId ?? embed.properties?.videoid)).toEqual([OTHER]);
    expect(elements(tree, 'iframe')).toEqual([]);
  });

  it('pairs an iframe with a closer in its own block even when an earlier one has none', () => {
    const content = `<iframe src="https://youtu.be/${YT}">\n\nBetween\n\n<iframe src="https://maps.example.com/live">\n</iframe>\n\nAfter`;
    expect(rewriteReaderEmbeds(content)).toBe(
      `<iframe src="https://youtu.be/${YT}">\n\nBetween\n\n<mdxembed href="https://maps.example.com/live"></mdxembed>\n\nAfter`,
    );
  });

  it('leaves an iframe with no closer as written, which the sanitizer drops', () => {
    const unclosed = `<iframe src="https://youtu.be/${YT}">\n\nAfter`;
    expect(rewriteReaderEmbeds(unclosed)).toBe(unclosed);
    expect(elements(render(unclosed), 'mdxembed')).toEqual([]);
    expect(elements(render(unclosed), 'iframe')).toEqual([]);
  });

  it('reads a self-closing JSX iframe as complete', () => {
    expect(rewriteReaderEmbeds(`<iframe src="https://youtu.be/${YT}" />\n\n[Visible](/visible)`)).toBe(
      `<mdxembed provider="youtube" videoid="${YT}"></mdxembed>\n\n[Visible](/visible)`,
    );
  });

  it('is idempotent', () => {
    const once = normalizeMdxBlocks(MINTLIFY_PAGE);
    expect(normalizeMdxBlocks(once)).toBe(once);
  });
});

describe('the reader sanitizer', () => {
  const tree = render(MINTLIFY_PAGE);

  it('renders no iframe at all, only the reader element with its allowed props', () => {
    expect(elements(tree, 'iframe')).toEqual([]);
    const embeds = elements(tree, 'mdxembed').map((embed) => embed.properties);
    expect(embeds).toEqual([
      { provider: 'youtube', videoid: YT, title: 'YouTube video player' },
      { provider: 'loom', videoid: LOOM, title: 'Loom walkthrough' },
      { href: 'https://codepen.io/team/pen/abc', title: 'A pen' },
    ]);
  });

  it('keeps video and source addresses but drops autoplay, muted, loop, events and unsafe posters', () => {
    const videos = elements(tree, 'video');
    expect(videos.map((video) => video.properties)).toEqual([
      { className: ['w-full', 'aspect-video', 'rounded-xl'], src: 'https://cdn.example.com/demo.mp4' },
      { src: 'https://cdn.example.com/b.mp4' },
    ]);
    expect(elements(tree, 'source').map((source) => source.properties)).toEqual([{ src: 'https://cdn.example.com/b.webm', type: 'video/webm' }]);
  });

  it('keeps an https or same-site poster', () => {
    const [video] = elements(render('<video poster="https://cdn.example.com/p.png" src="/api/public/projects/p/assets/a.mp4"></video>'), 'video');
    expect(video?.properties).toEqual({ poster: 'https://cdn.example.com/p.png', src: '/api/public/projects/p/assets/a.mp4' });
    const [relative] = elements(render('<video poster="/p.png"></video>'), 'video');
    expect(relative?.properties).toEqual({ poster: '/p.png' });
    const [data] = elements(render('<video poster="data:image/png;base64,AAAA"></video>'), 'video');
    expect(data?.properties).toEqual({});
  });

  it('keeps caption tracks with their language and label', () => {
    const page = render(
      '<video src="https://cdn.example.com/a.mp4"><track kind="captions" src="/captions/ar.vtt" srclang="ar" label="العربية" default onload="x()" /><track kind="metadata" src="javascript:alert(1)" /></video>',
    );
    expect(elements(page, 'track').map((track) => track.properties)).toEqual([
      { kind: 'captions', src: '/captions/ar.vtt', srcLang: 'ar', label: 'العربية', default: true },
      {},
    ]);
  });

  it('protocol-checks a hand-written reader element', () => {
    const [embed] = elements(render('<mdxembed href="javascript:alert(1)" onclick="x()" title="t"></mdxembed>'), 'mdxembed');
    expect(embed?.properties).toEqual({ title: 't' });
  });

  it('shows non-https frames as text, never as a link', () => {
    const page = render('<iframe src="javascript:alert(1)" title="Bad"></iframe>');
    expect(elements(page, 'a')).toEqual([]);
    expect(elements(page, 'mdxembed').map((embed) => embed.properties)).toEqual([{ text: 'javascript:alert(1)', title: 'Bad' }]);
    expect(text(page)).not.toContain('<iframe');
  });
});

describe('scanAuthoredEmbeds finds the iframes and videos the reader reads', () => {
  const spans = (text: string) =>
    scanAuthoredEmbeds(text).map((embed) => ({
      kind: embed.kind,
      source: text.slice(embed.start, embed.end),
      closed: embed.closed,
      src: embed.attributes.get('src'),
      title: embed.attributes.get('title'),
    }));

  it('reads each closed iframe and video, with its children, and the values the reader reads', () => {
    expect(spans(MINTLIFY_PAGE)).toEqual([
      expect.objectContaining({ kind: 'iframe', closed: true, src: `https://www.youtube.com/embed/${YT}?si=abc123`, title: 'YouTube video player' }),
      expect.objectContaining({ kind: 'iframe', closed: true, src: `https://www.loom.com/embed/${LOOM}`, title: 'Loom walkthrough' }),
      expect.objectContaining({ kind: 'video', closed: true, src: 'https://cdn.example.com/demo.mp4' }),
      expect.objectContaining({
        kind: 'video',
        closed: true,
        source:
          '<video controls onplay="alert(1)" poster="javascript:alert(1)" src="https://cdn.example.com/b.mp4">\n  <source src="https://cdn.example.com/b.webm" type="video/webm" onerror="alert(1)" />\n</video>',
      }),
      expect.objectContaining({ kind: 'iframe', closed: true, src: 'https://codepen.io/team/pen/abc', title: 'A pen' }),
    ]);
    expect(spans(`<iframe src={"https://youtu.be/${YT}"} title='R&amp;D' />`)).toEqual([
      {
        kind: 'iframe',
        source: `<iframe src={"https://youtu.be/${YT}"} title='R&amp;D' />`,
        closed: true,
        src: `https://youtu.be/${YT}`,
        title: 'R&D',
      },
    ]);
  });

  it('counts a closer only before the next blank line, as the reader does', () => {
    const text = `<iframe src="https://youtu.be/${YT}">\n\n## Install\n\n<iframe src="https://www.loom.com/embed/${LOOM}"></iframe>`;
    expect(spans(text).map(({ closed, src }) => ({ closed, src }))).toEqual([
      { closed: false, src: `https://youtu.be/${YT}` },
      { closed: true, src: `https://www.loom.com/embed/${LOOM}` },
    ]);
    expect(spans('<video src="https://cdn.example.com/a.mp4">\n\nText\n\n</video>')[0]?.closed).toBe(false);
  });

  it('skips tags it cannot read, and similar names', () => {
    expect(spans('<iframes src="x"></iframes> <iframe src="a" <b> <video-x src="y"> <iframe')).toEqual([]);
  });
});

describe('readerEmbedSource', () => {
  it('answers the way the reader shows an iframe', () => {
    expect(readerEmbedSource(`https://youtu.be/${YT}?t=30`)).toEqual({ kind: 'video', video: { provider: 'youtube', id: YT, start: 30 } });
    expect(readerEmbedSource('https://maps.example.com/embed?x=1')).toEqual({ kind: 'link', url: new URL('https://maps.example.com/embed?x=1') });
    expect(readerEmbedSource('http://example.com/x')).toEqual({ kind: 'text', text: 'http://example.com/x' });
    expect(readerEmbedSource('javascript:alert(1)')).toEqual({ kind: 'text', text: 'javascript:alert(1)' });
    expect(readerEmbedSource('  ')).toBeNull();
    expect(readerEmbedSource(undefined)).toBeNull();
  });
});
