import { describe, expect, it } from 'vitest';
import { excerpt, markdownToPlainText, pageDescription, pageDescriptionText, pageExcerpt } from './markdown-text';
import { growthMs, linearGrowthLimit } from './testing/growth';
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
  // each case must stay linear: timed at n and 4n repetitions against itself
  // (testing/growth). The largest input is the size these cases always used.
  // Extraction caches by content, so every call gets a fresh, equivalent input:
  // a unique number after the text (testing/growth `vary`).
  const fresh = { vary: (input: string, rep: number) => `${input} ${rep}` };
  const cases: Array<[string, (n: number) => string, number]> = [
    ['unclosed comments', (n) => '<!--'.repeat(n), 25_000],
    ['unclosed script elements', (n) => '<script'.repeat(n), 25_000],
    ['script open tags without a close', (n) => '<script>'.repeat(n), 25_000],
    ['unclosed tags', (n) => '<a'.repeat(n), 25_000],
    ['unclosed closing tags', (n) => '</a'.repeat(n), 25_000],
    ['unclosed brackets', (n) => '['.repeat(n), 25_000],
    ['reference-style link prefixes', (n) => '[a]['.repeat(n), 12_500],
    ['image reference prefixes', (n) => '![a]['.repeat(n), 12_500],
    // micromark's emphasis resolution is superlinear: about 750 ms for 16 KB of
    // `*a` when parsed directly. The marker guard sends it to the linear strip.
    ['dense emphasis (16 KB of *a)', (n) => '*a'.repeat(n), 2048],
    ['dense underscores', (n) => '_a'.repeat(n), 2048],
  ];

  // Every dense case above takes the linear strip.
  it.each(cases)('stays linear on %s', (_, build, n) => {
    const [small, large] = growthMs(markdownToPlainText, build(n), build(4 * n), fresh);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  // Just under the 200-marker guard the parser legitimately runs, on the 1.5 KB
  // prefix; both sizes stay under the guard (the larger is the size this case
  // always used). micromark's superlinear paths would show as growth here.
  it.each([
    ['emphasis just under the marker guard', (n: number) => '*aaaaaaa'.repeat(n), 48],
    ['tags just under the marker guard', (n: number) => `<b>${'a'.repeat(13)}`.repeat(n), 24],
  ] as const)('stays bounded on %s', (_, build, n) => {
    expect(markdownToPlainText(build(4 * n))).toContain('a');
    const [small, large] = growthMs(markdownToPlainText, build(n), build(4 * n), fresh);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
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

// AUTH-19: the automatic meta description used to read
// "Install Run the installer, then sign in . See Configuration. First item … | Name | Value |…".
describe('pageDescription', () => {
  const page = (content: string, description: string | null = null) => ({ content, description, config: null });

  it('uses the page paragraphs only: no heading, list, table or code text', () => {
    const content =
      '# Install\n\nRun the installer, then sign in . See [Configuration](/config).\n\n1. First item\n2. Second item\n\n| Name | Value |\n| --- | --- |\n| a | b |\n\n```bash\nnpm i\n```\n\nThen open the dashboard .';
    expect(pageDescription(page(content))).toBe('Run the installer, then sign in. See Configuration. Then open the dashboard.');
  });

  it('keeps paragraphs inside callouts and quotes, in order', () => {
    const content = '> [!NOTE]\n> Back up the database first.\n\n<Note>\nUse a strong password.\n</Note>\n\n## Steps\n\n- Ignored list item';
    expect(pageDescription(page(content))).toBe('Back up the database first. Use a strong password.');
  });

  it('keeps the prose found in a shorter prefix when a longer one has unclosed raw HTML', () => {
    // Under 200 characters of prose in the first 1.5 KB, then an unclosed comment in the 4 KB prefix.
    const content = `# Install\n\nRun the installer, then sign in.\n\n${'- step\n'.repeat(260)}\n<!-- draft notes`;
    expect(content.length).toBeGreaterThan(1536);
    expect(pageDescription(page(content))).toBe('Run the installer, then sign in.');
  });

  it('gives the editor the full text, and search the same text cut at about 155 characters', () => {
    const long = page(`${'Configure the reservation calendar for each property. '.repeat(6)}`);
    expect(pageDescriptionText(long)).toBe('Configure the reservation calendar for each property. '.repeat(6).trim());
    expect(pageDescriptionText(long).endsWith('…')).toBe(false);
    expect(pageDescription(long)).toBe(truncateText(pageDescriptionText(long), 155));
  });

  it('falls back to all visible text when a page has no paragraphs', () => {
    expect(pageDescription(page('# Shortcuts\n\n- Save with Ctrl+S\n- Search with Ctrl+K'))).toBe('Shortcuts Save with Ctrl+S Search with Ctrl+K');
  });

  it('tidies Arabic punctuation spacing and caps at about 155 characters on a word boundary', () => {
    expect(pageDescription(page('افتح لوحة التحكم ، ثم اختر الحجز ؟'))).toBe('افتح لوحة التحكم، ثم اختر الحجز؟');
    // A dotfile or extension after a space is not punctuation ending a phrase.
    expect(pageDescription(page('Copy .env.production.example , then edit it .'))).toBe('Copy .env.production.example, then edit it.');
    const long = pageDescription(page(`${'Configure the reservation calendar for each property. '.repeat(6)}`));
    expect(long.length).toBeLessThanOrEqual(155);
    expect(long.endsWith('…')).toBe(true);
  });

  it('prefers the author description and the SEO override', () => {
    expect(pageDescription(page('Body text here.', 'Written **summary**.'))).toBe('Written summary.');
    expect(pageDescription({ content: 'Body.', description: 'Summary.', config: { seo: { metaDescription: 'From SEO settings .' } } })).toBe(
      'From SEO settings.',
    );
  });
});
