import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';

describe('public Markdown content normalization', () => {
  it.each(['$&', '$$', "$'", '$`'])('preserves replacement metacharacters in literal public code: %s', (token) => {
    const source = [`Example: \`\`literal ${token}\`\``, '', '~~~mdx', `literal ${token}`, '~~~'].join('\n');
    expect(normalizePublicMarkdownContent(source)).toBe(source);
  });

  it('projects supported MDX while removing executable imports and raw active HTML', () => {
    const source = `import Exploit from "https://attacker.example/exploit.js"

<Callout type="tip">**Portable guidance**</Callout>

<script>globalThis.stolen = true</script>

<Unknown onclick="run()">Readable</Unknown>

\`\`\`mdx
import Example from './example'
<Callout>Code sample</Callout>
\`\`\``;

    const normalized = normalizePublicMarkdownContent(source);

    expect(normalized).toContain('&gt; **Portable guidance**');
    expect(normalized).toContain('&lt;Unknown onclick=&quot;run()&quot;&gt;Readable&lt;/Unknown&gt;');
    expect(normalized).toContain("```mdx\nimport Example from './example'\n<Callout>Code sample</Callout>\n```");
    expect(normalized).not.toContain('Exploit');
    expect(normalized).not.toContain('globalThis.stolen');
    expect(normalized).not.toContain('<script>');
  });

  it('preserves literal HTML and JSON in variable-length inline code spans', () => {
    const source = [
      'Use `<script>alert(1)</script>` with `{"mode":"safe"}` as literal examples.',
      'A double delimiter preserves ``literal `tick`, <tag>, and {value}`` exactly.',
      '<script>globalThis.stolen = true</script>',
    ].join('\n');

    const normalized = normalizePublicMarkdownContent(source);

    expect(normalized).toContain('`<script>alert(1)</script>`');
    expect(normalized).toContain('`{"mode":"safe"}`');
    expect(normalized).toContain('``literal `tick`, <tag>, and {value}``');
    expect(normalized).not.toContain('globalThis.stolen');
  });
});

describe('projected link destinations', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' java\tscript:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'javascript&colon;alert(1)',
    'javascript\\:alert(1)',
    'vbscript:x',
    'data:text/html,x',
    '<javascript:alert(1)>',
  ])('projects no link for the unsafe destination %j', (href) => {
    const output = portablePublicMdxMarkdown(
      `<Button href="${href}">Go</Button> <Card title="Card" href="${href}">\n\nBody\n\n</Card> <RelatedCard title="Related" href="${href}" />`,
    );
    expect(output).not.toMatch(/\]\(/);
    expect(output).toContain('Go');
    expect(output).toContain('Card');
    expect(output).toContain('Related');
  });

  it.each(['/guide', 'guide/setup', '#install', 'https://example.com/a?b=1', 'mailto:team@example.com', 'tel:+15550100'])(
    'keeps the safe destination %j',
    (href) => {
      expect(portablePublicMdxMarkdown(`<Button href="${href}">Go</Button>`)).toBe(`[Go](${href})`);
    },
  );

  it('keeps a destination that tries to close its link and open another inside one link', () => {
    const output = portablePublicMdxMarkdown('<Button href="/) [Injected](javascript:alert%281%29">Go</Button>');
    expect(output).toBe('[Go](/%29%20[Injected]%28javascript:alert%281%29)');
    expect(output.match(/\]\(/g)).toHaveLength(1);
  });

  it('percent-encodes spaces and parentheses in a projected destination', () => {
    expect(portablePublicMdxMarkdown('<Button href="/a b(c)">Go</Button>')).toBe('[Go](/a%20b%28c%29)');
  });

  it('percent-encodes Unicode spaces as UTF-8 bytes', () => {
    expect(portablePublicMdxMarkdown('<Button href="/a b">Go</Button>')).toBe('[Go](/a%E2%80%83b)');
    expect(portablePublicMdxMarkdown('<Button href="/a b">Go</Button>')).toBe('[Go](/a%C2%A0b)');
  });
});

describe('#338 follow-ups', () => {
  it.each([
    ['an inline link', '[x](javascript:alert(1)) and [ok](/a)', '[x](#) and [ok](/a)'],
    ['an image', '![x](  vbscript:x )', '![x](  # )'],
    ['an angle-bracket destination', '[x](<javascript:alert(1)>)', '[x](#)'],
    ['a destination on the next line', '[x](\njavascript:alert(1))', '[x](\n#)'],
    ['a reference definition', '[r]: javascript:alert(1)\n\n[x][r]', '[r]: #\n\n[x][r]'],
    ['an encoded scheme', '[x](&#106;avascript:alert(1))', '[x](#)'],
  ])('points %s with an unsafe destination at #', (_label, source, expected) => {
    expect(normalizePublicMarkdownContent(source)).toBe(expected);
  });

  it('keeps safe and escaped destinations, and code, as written', () => {
    const source = ['[a](https://example.com/a_(b)) [b](mailto:team@example.com) [c\\](javascript:x)', '`[d](javascript:x)`'].join('\n');
    expect(normalizePublicMarkdownContent(source)).toBe(source);
  });

  it("neutralizes a link a Button's body carries", () => {
    expect(normalizePublicMarkdownContent('<Button href="/ok">x](javascript:alert(1)) [y</Button>')).toBe('[x](#) [y](/ok)');
  });

  it('leaves character references already written in prose and titles as they are', () => {
    expect(normalizePublicMarkdownContent('a &amp; b &#65; &#x42; &copy; & c &nope')).toBe('a &amp; b &#65; &#x42; &copy; &amp; c &amp;nope');
    expect(normalizePublicMarkdownContent('<Card title="A &#65; &amp; B">\n\nBody\n\n</Card>')).toBe('### A &#65; &amp; B\n\nBody');
  });

  it.each([
    ['inline', '<Note><Warning>inner</Warning></Note>', '> > inner'],
    ['on their own lines', '<Note>\n\n<Warning>\n\ninner\n\n</Warning>\n\n</Note>', '> > inner'],
    ['after outer text', '<Note>\nouter\n\n<Tip>\ninner\n</Tip>\n</Note>', '> outer\n>\n> > inner'],
    ['of the same tag', '<Note>\n<Note>\ninner\n</Note>\n</Note>', '> > inner'],
  ])('quotes nested callouts once per level (%s)', (_label, source, expected) => {
    expect(portablePublicMdxMarkdown(source)).toBe(expected);
  });

  it('keeps a title whose line break is followed by > whole', () => {
    expect(portablePublicMdxMarkdown('<Card title="Line one\n> two" href="/x">\n\nBody\n\n</Card>')).toBe('### [Line one &gt; two](/x)\n\nBody');
    expect(normalizePublicMarkdownContent('<Card title="a < b > c">\n\nBody\n\n</Card>')).toBe('### a &lt; b &gt; c\n\nBody');
  });

  it('projects an Update as its label, description and body', () => {
    expect(portablePublicMdxMarkdown('<Update label="v1.2" description="March release">\n\nNew stuff\n\n</Update>')).toBe(
      '## v1.2\n\nMarch release\n\nNew stuff',
    );
    expect(portablePublicMdxMarkdown('<Update label="v1.3">\n\nOnly a body\n\n</Update>')).toBe('## v1.3\n\nOnly a body');
  });
});
