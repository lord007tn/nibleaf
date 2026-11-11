import { describe, expect, it } from 'vitest';
import { excerpt, markdownToPlainText, pageDescription, pageExcerpt } from './markdown-text';
import { truncateText } from './utils';

describe('excerpt', () => {
  it('cleans tables, emphasis, callouts, escaped lists, links, images, headings and HTML', () => {
    const markdown =
      '# **Guide**\n> [!IMPORTANT]\n\n| Name | Value |\n| :--- | ---: |\n| *Token* | `secret` |\n\n\\-1- [Read me](/guide)\n![Diagram](/image.png)\n<b>Finish</b>';
    expect(markdownToPlainText(markdown)).toBe('Guide Name Value Token secret Read me Finish');
    expect(excerpt(markdown)).toBe('Guide Name Value Token secret Read me Finish');
  });
  it('keeps Arabic vocalization and grapheme clusters intact while truncating', () => {
    const source = 'مَرْحَبًا بِكُمْ في دَلِيلِ الاستخدام والتوثيق';
    expect(excerpt(source)).toBe(source);
    expect(excerpt(source, 14)).toBe('مَرْحَبًا بِكُمْ في…');
    expect(excerpt('أَ'.repeat(200), 8)).toBe(`${'أَ'.repeat(7)}…`);
    expect(excerpt('👨‍👩‍👧‍👦'.repeat(20), 4)).toBe('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦…');
  });
  it('truncates at a whole word and removes reference-link syntax', () => {
    expect(excerpt('A useful introduction to authentication', 25)).toBe('A useful introduction…');
    expect(excerpt('[Read me][docs]\n\n[docs]: https://example.com\n\n![hidden][image]')).toBe('Read me');
    expect(excerpt('Use `api_key` with _care_ and **attention**.')).toBe('Use api_key with care and attention.');
    expect(excerpt('[Read more](https://example.com/docs_(intro))')).toBe('Read more');
  });
  it('strips fenced code, links, and markdown punctuation', () => {
    const md = '# Title\n\nSee [the docs](https://x) for `code`.\n\n```js\nconst a = 1;\n```';
    const out = excerpt(md);
    expect(out).not.toContain('```');
    expect(out).not.toContain('const a = 1');
    expect(out).toContain('the docs');
    expect(out).not.toContain('https://x');
  });
  it('removes Markdown images instead of leaking image syntax or URLs', () => {
    const out = excerpt('Add the company settings\n\n![](https://ghost.example.com/content/images/steps.jpg)\n\nThen continue.');
    expect(out).toBe('Add the company settings Then continue.');
  });
  it('truncates past the max with an ellipsis', () => {
    const out = excerpt('a '.repeat(200), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('markdownToPlainText on adversarial input (ReDoS, CodeQL js/polynomial-redos)', () => {
  // Author content reaches this on every render and on the public OG route, so
  // each case must stay linear. Each input is about 100k repetitions.
  const cases: Array<[string, string]> = [
    ['unclosed comments', '<!--'.repeat(100_000)],
    ['unclosed script elements', '<script'.repeat(100_000)],
    ['script open tags without a close', '<script>'.repeat(100_000)],
    ['unclosed tags', '<a'.repeat(100_000)],
    ['unclosed closing tags', '</a'.repeat(100_000)],
    ['unclosed brackets', '['.repeat(100_000)],
    ['reference-style link prefixes', '[a]['.repeat(50_000)],
    ['image reference prefixes', '![a]['.repeat(50_000)],
    // micromark's emphasis resolution is superlinear: about 750 ms for 16 KB of
    // `*a` when parsed directly. The marker guard sends it to the linear strip.
    ['dense emphasis (16 KB of *a)', '*a'.repeat(8192)],
    ['dense underscores', '_a'.repeat(8192)],
  ];
  /** Calibrated timing: the same machine's time for a plain linear pass over the
   *  same input. A slow CI core slows both equally, so the ratio stays meaningful,
   *  while superlinear growth (hundreds of times slower at this size) is still caught. */
  const plainStripMs = (input: string): number => {
    const runs: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      let letters = 0;
      for (let index = 0; index < input.length; index += 1) if (/\p{L}/u.test(input[index] ?? '')) letters += 1;
      if (letters < 0) throw new Error('unreachable');
      runs.push(performance.now() - started);
    }
    return runs.sort((a, b) => a - b)[1] ?? 0;
  };
  /** Median of three extractions. A unique suffix bypasses the per-content cache,
   *  so each run measures extraction, not a cache hit. */
  const extractionMs = (input: string): number => {
    markdownToPlainText('<!-- warm up --> <b>x</b> [a](b) *y*');
    const runs: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now();
      markdownToPlainText(`${input}${Math.random()}`);
      runs.push(performance.now() - started);
    }
    return runs.sort((a, b) => a - b)[1] ?? 0;
  };

  // Every dense case above takes the linear strip: calibrated against a linear pass.
  it.each(cases)('stays linear on %s', (_, input) => {
    expect(extractionMs(input)).toBeLessThanOrEqual(10 * plainStripMs(input) + 20);
  });

  // Just under the 200-marker guard the parser legitimately runs, on the 1.5 KB
  // prefix. Calibrated like against like: the same function parsing an ordinary
  // prose page of the same size, which takes the same parser and prefix.
  // Superlinear growth still shows as a large multiple of normal parsing, and a
  // slow core slows both sides equally.
  const ordinaryPage = (size: number): string => {
    const sentence = 'Open the **Settings** page, then add a guest to the booking and save it. ';
    return sentence.repeat(Math.ceil(size / sentence.length)).slice(0, size);
  };
  it.each([
    ['emphasis just under the marker guard', '*aaaaaaa'.repeat(192)],
    ['tags just under the marker guard', `<b>${'a'.repeat(13)}`.repeat(96)],
  ])('stays bounded on %s', (_, input) => {
    const ordinary = ordinaryPage(input.length);
    // About 85 markers and no raw HTML: under the guard, so it takes the parser.
    expect(markdownToPlainText(ordinary)).toContain('Settings page');
    expect(extractionMs(input)).toBeLessThanOrEqual(5 * extractionMs(ordinary) + 20);
  });

  it('strips unclosed raw HTML linearly instead of parsing it', () => {
    expect(markdownToPlainText('Intro text. <script>const secret = 1;')).not.toContain('secret');
    expect(markdownToPlainText('Intro text. <!-- unfinished internal note')).toBe('Intro text.');
    expect(markdownToPlainText('Intro text. <style>p { color: red }')).not.toContain('color');
  });

  it('the linear fallback still gives a clean description for a marker-heavy page', () => {
    const page = `${'See [the guide](https://example.com/guide) and ![diagram](/d.png) for **details**. '.repeat(40)}`;
    const text = markdownToPlainText(page);
    expect(text.startsWith('See the guide and for details.')).toBe(true);
    expect(text).not.toMatch(/https?:|\/d\.png|\*/);
  });

  it('still drops the constructs it guards against', () => {
    expect(markdownToPlainText('Before <!-- hidden --> after')).toBe('Before after');
    expect(markdownToPlainText('A <script>alert(1)</script> B <STYLE>p{}</STYLE> C')).toBe('A B C');
    expect(markdownToPlainText('Use <kbd>Ctrl</kbd> + <a href="x">K</a>')).toBe('Use Ctrl + K');
    expect(markdownToPlainText('2 < 3 and 4 > 1')).toBe('2 < 3 and 4 > 1');
    expect(markdownToPlainText('[Docs][ref] and ![alt][img]\n\n[ref]: https://example.com')).toBe('Docs and');
  });

  it('never blocks on pathological input, and keeps its visible words', () => {
    const text = markdownToPlainText(`Intro words. ${'*a'.repeat(8192)}`);
    expect(text.startsWith('Intro words.')).toBe(true);
    expect(text).not.toContain('*');
  });
});

describe('markdownToPlainText is syntax-aware (council #453)', () => {
  it('drops MDX/JSX comments instead of leaking them', () => {
    expect(markdownToPlainText('{/* Internal launch plan */}\n\nPublic intro.')).toBe('Public intro.');
    expect(markdownToPlainText('Intro {/* inline note */} continues.')).toBe('Intro continues.');
    // Invalid MDX (a bare "<" in prose) falls back to Markdown and still drops it.
    expect(markdownToPlainText('{/* plan */}\n\nCost < 5 dollars.')).toBe('Cost < 5 dollars.');
  });

  it('drops frontmatter values', () => {
    expect(markdownToPlainText('---\ntitle: Secret roadmap\ndescription: internal\n---\n\nVisible body.')).toBe('Visible body.');
    expect(markdownToPlainText('+++\ntitle = "Secret"\n+++\n\nVisible body.')).toBe('Visible body.');
  });

  it('never exposes an HTML comment that contains a code fence', () => {
    const source = 'Start.\n\n<!--\nInternal:\n```\nsecret = 1\n```\nmore internal\n-->\n\nEnd.';
    expect(markdownToPlainText(source)).toBe('Start. End.');
  });

  it('keeps JSX component children but not attributes or expressions', () => {
    expect(markdownToPlainText('<Card title="Hidden attr" href="/x">Visible card text</Card>\n\nValue {props.secret} here.')).toBe(
      'Visible card text Value here.',
    );
  });

  it('decodes every character reference the parser knows', () => {
    expect(markdownToPlainText('Use &lt;Token&gt; &amp; &copy; 2026 &#169; &#x1F600; &#1576;&#1575;&#1576;')).toBe('Use <Token> & © 2026 © 😀 باب');
  });

  it('strips callout markers and imported step markers', () => {
    expect(markdownToPlainText('> [!IMPORTANT]\n> Back up first.')).toBe('Back up first.');
    expect(markdownToPlainText('\\-1- To extend the booking, open it.')).toBe('To extend the booking, open it.');
  });
});

describe('cleaning happens once (council #453)', () => {
  it('the API description is final: truncating it again keeps literal text', () => {
    const decoded = pageDescription({ description: null, content: 'Use &lt;Token&gt; with care.' });
    expect(decoded).toBe('Use <Token> with care.');
    expect(truncateText(decoded)).toBe('Use <Token> with care.');
  });

  it('meta, JSON-LD and llms.txt all read the same cleaned description', () => {
    const page = { description: null, content: '---\ntitle: x\n---\n\n> [!NOTE]\n> Read **this** [guide](/g).' };
    expect(pageDescription(page)).toBe('Read this guide.');
    expect(pageExcerpt(page)).toBe('Read this guide.');
    expect(excerpt(page.content)).toBe('Read this guide.');
  });
});
