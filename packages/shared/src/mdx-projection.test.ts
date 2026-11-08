import { describe, expect, it } from 'vitest';
import { buildMdxTree, tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';

const PRIVATE_USE = /[-]/;
const collapse = (value: string) => value.replace(/\n{3,}/g, '\n\n');
const withoutCode = (value: string) => value.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, '');

describe('the shared MDX tokenizer (#341)', () => {
  const kinds = (source: string) => tokenizeMdx(source, new Set(['note', 'card'])).map((token) => token.kind);

  it('reads fences of any length and marker, inside containers too, as opaque code', () => {
    expect(kinds('a\n~~~~\n<Note>\n~~~~\nb')).toEqual(['text', 'code', 'text']);
    expect(kinds('> ```js\n> <Note>\n> ```')).toEqual(['code']);
    // A shorter closing run does not close a longer fence.
    expect(tokenizeMdx('````\n```\n<Note>\n````\nafter', new Set(['note']))[0]).toMatchObject({ kind: 'code', value: '````\n```\n<Note>\n````' });
  });

  it('keeps inline code within its paragraph', () => {
    expect(kinds('`<Note>` text')).toEqual(['code', 'text']);
    expect(kinds('a `b\n\nc` d')).toEqual(['text']);
  });

  it('reads quote-aware attributes, and a lone quote as text', () => {
    expect(tokenizeMdx('<Card title="a > b">x</Card>', new Set(['card']))[0]).toMatchObject({ kind: 'open', attributes: ' title="a > b"' });
    expect(tokenizeMdx("<Card title=don't>x</Card>", new Set(['card']))[0]).toMatchObject({ kind: 'open', attributes: " title=don't" });
  });

  it('falls back to text for unmatched tags', () => {
    expect(buildMdxTree(tokenizeMdx('</Note> <Note>open', new Set(['note'])))).toEqual([
      { kind: 'text', value: '</Note>' },
      { kind: 'text', value: ' ' },
      { kind: 'text', value: '<Note>' },
      { kind: 'text', value: 'open' },
    ]);
  });
});

describe('restored projection behaviours (#341 checklist, #320 oracle)', () => {
  it('projects components around code blocks and keeps the code literal', () => {
    expect(md('<CodeGroup>\n\n```js title="a.js"\nconst a = 1 < 2;\n```\n\n</CodeGroup>')).toBe('```js title="a.js"\nconst a = 1 < 2;\n```');
    expect(collapse(md('<Card title="T" href="/x">\n\n```sh\nnpm i <pkg>\n```\n\n</Card>\n\nAfter.'))).toBe(
      '### [T](/x)\n\n```sh\nnpm i <pkg>\n```\n\nAfter.',
    );
    expect(md('<Tabs>\n<Tab title="npm">\n\n```bash\nnpm i\n```\n\n</Tab>\n</Tabs>')).toBe('### npm\n\n```bash\nnpm i\n```');
  });

  it('keeps blockquotes, including the ones callouts become, as Markdown', () => {
    expect(md('<Note>\n\nhello\n\n</Note>\n\n> quoted & kept\n> > nested')).toBe('> hello\n\n> quoted &amp; kept\n> > nested');
    // Only a marker at the start of a line: elsewhere `>` is escaped.
    expect(md('a > b')).toBe('a &gt; b');
  });

  it('quotes every line of a code block inside a callout, once per level', () => {
    const quotedCode = '> ```html\n> <div>hi</div>\n> line2\n> ```';
    const source = '<Note>\nRun this:\n\n```html\n<div>hi</div>\nline2\n```\n\nafter\n</Note>\n\nnext para';
    expect(portable(source)).toContain(quotedCode);
    const output = md(source);
    expect(output).toContain(quotedCode);
    expect(output).toContain('> after');
    expect(output.endsWith('next para')).toBe(true);
    expect(output.match(/```/g)).toHaveLength(2);
    expect(portable('<Note>\n<Warning>\n\n```js\nconst a = 1;\n```\n\n</Warning>\n</Note>')).toContain('> > ```js\n> > const a = 1;\n> > ```');
  });

  it('indents every line inside a Folder or a RelatedCard', () => {
    expect(portable('<Folder name="src">\n\n```txt\na\nb\n```\n\n</Folder>').trimEnd()).toBe('- **src/**\n  ```txt\n  a\n  b\n  ```');
    expect(portable('<RelatedCard title="R">\n\nOne\nTwo\n\n</RelatedCard>')).toBe('- R\n  One\n  Two');
  });

  it('projects a tooltip as its text and tip', () => {
    expect(portable('<Tooltip tip="Application programming interface">API</Tooltip>')).toBe('API (Application programming interface)');
    expect(md('An <Tooltip tip="a {b} &amp; c">API</Tooltip>.')).toBe('An API (a {b} &amp; c).');
  });

  it('reads an attribute value containing ">" whole, and a lone quote as text', () => {
    expect(portable('<Tooltip tip="a > b">API</Tooltip>')).toBe('API (a &gt; b)');
    expect(portable("<Card title=don't>\n\nBody\n\n</Card>\n\nIt's after <Badge>B</Badge>.")).toBe("Body\n\nIt's after **B**.");
  });

  it('projects atoms written as an empty pair like self-closing ones', () => {
    expect(portable('<File name="a.ts"></File>')).toBe(portable('<File name="a.ts" />'));
    expect(portable('<File name="a.ts"></File>')).toBe('- `a.ts`');
    expect(portable('A<Icon icon="star"></Icon>B')).toBe('AB');
    expect(portable('<RelatedCard title="R" href="/r"></RelatedCard>')).toBe('- [R](/r)');
  });

  it('names fields by path, query, header or body, with required, default and deprecated', () => {
    expect(portable('<ParamField query="limit" type="number" default="20" required deprecated>\n\nPage size.\n\n</ParamField>')).toBe(
      '#### limit · number · required · default: 20 · deprecated\n\nPage size.',
    );
    expect(portable('<ParamField path="id" type="string" required={false}>\n\nThe id.\n\n</ParamField>')).toBe('#### id · string\n\nThe id.');
    expect(portable('<ResponseField name="ok" type="boolean">\n\nDone.\n\n</ResponseField>')).toBe('#### ok · boolean\n\nDone.');
  });

  it('keeps matched, correctly nested sub, sup and underline pairs', () => {
    expect(md('10<sup>-3</sup>, H<sub>2</sub>O and <u>under</u>')).toBe('10<sup>-3</sup>, H<sub>2</sub>O and <u>under</u>');
    expect(md('Crossed <u>a <sub>b</u> c</sub>, stray </sup>')).toBe('Crossed &lt;u&gt;a <sub>b&lt;/u&gt; c</sub>, stray &lt;/sup&gt;');
    expect(md('`<sub>code</sub>`')).toBe('`<sub>code</sub>`');
  });

  it('projects attribute text as plain text, never as Markdown or HTML', () => {
    expect(md('<Card title="a_b *c* [d] \\ e <i>">\n\nx\n\n</Card>')).toBe('### a\\_b \\*c\\* \\[d\\] \\\\ e &lt;i&gt;\n\nx');
  });

  it('keeps a "}" that closes nothing', () => {
    expect(md('Literal \\{y} and a} b, while {hidden} goes.')).toBe('Literal \\{y} and a} b, while  goes.');
  });

  it('keeps code in projected attribute text instead of leaking a placeholder', () => {
    const output = md('<Card title="Use `x`" href="/a">\n\nBody\n\n</Card> and <Tooltip tip="Run `npm i`">T</Tooltip>.');
    expect(output).toContain('Use `x`');
    expect(output).toContain('T (Run `npm i`)');
    expect(output).not.toMatch(PRIVATE_USE);
  });
});

describe("regression cases from #320's reviews (#341)", () => {
  const fence = '```js\nconst tag = "<script>kept as code</script>";\n```';

  it.each([
    ['nested Folders', `<Folder name="a">\n<Folder name="b">\n\n${fence}\n\n</Folder>\n</Folder>`],
    ['nested callouts of the same tag', `<Note>\n<Note>\n\n${fence}\n\n</Note>\n</Note>`],
  ])('never lets a script through after %s around a fenced block (round 8 blocker)', (_label, around) => {
    for (const output of [md(`${around}\n\n<script>alert(1)</script>\n\nAfter`), portable(`${around}\n\n<script>alert(1)</script>`)]) {
      expect(output).toContain('const tag = "<script>kept as code</script>";');
    }
    const output = md(`${around}\n\n<script>alert(1)</script>\n\nAfter`);
    expect(withoutCode(output.replace(/^[ >]*/gm, ''))).not.toMatch(/<\/?script/i);
    expect(output).toContain('After');
  });

  it.each([
    ['a tilde fence', '~~~html\n<script>literal()</script>\n~~~'],
    ['a fence closed by a longer one', '```html\n<script>literal()</script>\n`````'],
  ])('quotes a callout around %s and keeps the code one block', (_label, code) => {
    const output = md(`<Note>\n\n${code}\n\n</Note>\n\nProse <script>alert(1)</script> continues`);
    expect(output).toContain(code.replace(/^/gm, '> '));
    expect(output).toContain('Prose');
    expect(output).toContain('continues');
    expect(
      output
        .split('\n')
        .filter((line) => !line.startsWith('>'))
        .join('\n'),
    ).not.toMatch(/<\/?script/i);
  });

  it('keeps inline code inside projected attribute text', () => {
    expect(md('<Card title="Use `<Note>` here">\n\nBody\n\n</Card>')).toBe('### Use `<Note>` here\n\nBody');
  });

  it('projects a Folder inside a callout, and nested callouts', () => {
    expect(portable('<Note>\n<Folder name="src">\n<File name="a.ts" />\n</Folder>\n</Note>')).toBe('> - **src/**\n>   - `a.ts`');
    expect(portable('<Note>\nouter\n\n<Tip>\ninner\n</Tip>\n</Note>')).toBe('> outer\n>\n> > inner');
  });

  it('keeps a callout around a fenced block one code block in .md, and prose after it prose', () => {
    const output = md('<Note>\nRun:\n\n```sh\nnpm i\n```\n\n</Note>\n\nThen continue.');
    expect(output).toBe('> Run:\n>\n> ```sh\n> npm i\n> ```\n\nThen continue.');
  });

  it('never leaks a private placeholder', () => {
    const source = `<Card title="\`a\`">\n\n\`b\` ${fence}\n\n</Card>\n\n<Tooltip tip="\`c\`">d</Tooltip> \`\`e \` f\`\``;
    for (const output of [md(source), portable(source)]) expect(output).not.toMatch(PRIVATE_USE);
  });

  it('lets an unclosed <style> hide at most its own stretch of prose, never later code', () => {
    const output = md('<style>unclosed\n\n```txt\nkept code\n```\n\nKept prose.');
    expect(output).toContain('kept code');
    expect(output).toContain('Kept prose.');
    expect(output).not.toContain('unclosed');
  });
});
