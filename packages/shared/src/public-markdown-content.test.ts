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
});
