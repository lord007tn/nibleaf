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

    // A callout is a real Markdown blockquote: its marker isn't escaped (#341).
    expect(normalized).toContain('> **Portable guidance**');
    expect(normalized).not.toContain('&gt; **Portable guidance**');
    expect(normalized).toContain('&lt;Unknown onclick="run()"&gt;Readable&lt;/Unknown&gt;');
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

  // READER-24: the `.md` export showed "you&#39;re". Quotes are inert once `<` and `>`
  // are escaped, so prose keeps them as written, in text and in projected components.
  it('keeps apostrophes and quotes as written while markup stays inert', () => {
    const source = [
      `Plain prose: you're "here".`,
      `<Note>Expand the environment you're using.</Note>`,
      `<Accordion title="If you're on Docker">Steps you're following.</Accordion>`,
      'Already a reference: you&#39;re, and an ampersand: R&D.',
      `<img src=x onerror="alert('x')"> and <a href='javascript:alert(1)'>link</a>`,
    ].join('\n\n');

    const normalized = normalizePublicMarkdownContent(source);

    expect(normalized).toContain(`Plain prose: you're "here".`);
    expect(normalized).toContain(`> Expand the environment you're using.`);
    expect(normalized).toContain(`### If you're on Docker\n\nSteps you're following.`);
    expect(normalized).toContain('Already a reference: you&#39;re, and an ampersand: R&amp;D.');
    expect(normalized).not.toContain('&#39;re using');
    expect(normalized).not.toMatch(/<img|<a\s/);
    expect(normalized).toContain('&lt;img');
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

  it.each(['/guide', 'guide/setup', '#install', 'https://example.com/a?b=1', 'mailto:team@example.com'])('keeps the safe destination %j', (href) => {
    expect(portablePublicMdxMarkdown(`<Button href="${href}">Go</Button>`)).toBe(`[Go](${href})`);
  });

  it('keeps main tel-link behavior pending URL hardening in #664', () => {
    expect(portablePublicMdxMarkdown('<Button href="tel:+15550100">Go</Button>')).toBe('[Go](tel:+15550100)');
  });

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

// Safety cases from #320's reviews (#341): the .md projection never lets an active
// tag through and never breaks code out of its block.
describe('public Markdown projection safety (#341)', () => {
  const md = (source: string) => normalizePublicMarkdownContent(source);
  const fence = ['```js', 'const tag = "<script>kept as code</script>";', '```'].join('\n');
  // Containers prefix each code line (`> `, indentation): compare and strip code line by line.
  const unprefixed = (output: string) => output.replace(/^[ >]*/gm, '');
  const withoutCode = (output: string, code: string) => unprefixed(output).replace(code, '');

  it.each([
    ['nested Folders', `<Folder name="a">\n<Folder name="b">\n\n${fence}\n\n</Folder>\n</Folder>`],
    ['nested callouts', `<Note>\n<Note>\n\n${fence}\n\n</Note>\n</Note>`],
    ['a Folder inside a callout', `<Note>\n<Folder name="a">\n\n${fence}\n\n</Folder>\n</Note>`],
  ])('removes a script after %s around a fenced block and keeps the code literal', (_label, around) => {
    const output = md(`${around}\n\n<script>alert(1)</script>\n\nAfter`);
    expect(withoutCode(output, fence)).not.toMatch(/<\/?script/i);
    expect(unprefixed(output)).toContain(fence);
    expect(output).toContain('After');
  });

  it.each([
    ['a tilde fence', ['~~~html', '<script>literal()</script>', '~~~']],
    ['a fence closed by a longer one', ['```html', '<script>literal()</script>', '`````']],
  ])('keeps code literal in a callout around %s and removes scripts from the prose after it', (_label, lines) => {
    const code = lines.join('\n');
    const output = md(`<Note>\n\n${code}\n\n</Note>\n\nProse <script>alert(1)</script> continues`);
    expect(unprefixed(output)).toContain(code);
    expect(withoutCode(output, code)).not.toMatch(/<\/?script/i);
    expect(output).toContain('Prose');
    expect(output).toContain('continues');
  });

  it('neutralizes live HTML when main joins an inline unclosed style to a fence', () => {
    const output = md(`Text <style>\nhidden\n\n${fence}\n\nAfter`);
    expect(output).toBe(`Text ${fence.replaceAll('<', '&lt;')}\n\nAfter`);
    expect(output).not.toMatch(/<\/?style/i);
  });

  it('never leaks a private placeholder', () => {
    const output = md(`<Card title="Use \`<Note>\` here">body</Card>\n\nInline \`<script>\` and ${fence}`);
    expect(output).not.toMatch(/[]/);
    expect(output).toContain('`<script>`');
  });
});
