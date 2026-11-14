import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { expect, it } from 'vitest';
import followingBaseline from './__fixtures__/markdown-export.following.main.json';
import { escapeDisallowedExportHtml as safe } from './export-html';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { exportCodeSamples, renderedActiveHtml } from './testing/export-guard';
import { exportFollowingBlockCases } from './testing/export-guard-cases';

it.each([
  '<u>safe</u> <custom foo="bar">text</custom>',
  '<textarea><script>literal</script></textarea>',
  '<!-- <script>literal</script> -->',
  '~~~html\n<script>literal</script>\n~~~',
  '    <script>literal</script>',
  'Use `<script>literal</script>`.',
  '<div onclick="run()">text</div>',
  '[x](data:text/html,x)',
])('keeps element-inactive output byte-identical: %s', (source) => {
  expect(renderedActiveHtml(source)).toBe(0);
  expect(safe(source)).toBe(source);
});
it.each([
  '![x](data:image/png;base64,AAAA)',
  '[x](javascript:x)',
  '~~~html\n<u>literal</u>\n~~~',
  '{expr}',
  '> 1. nested\n> - list',
  '    indented text',
  '**bold** and `code`',
])('keeps the element body literal: %s', (body) => {
  const source = `<iframe>\n${body}\n</iframe>`;
  const output = safe(source);
  const md = new MarkdownIt({ html: true });
  const tokens = md.parse(output, {});
  const pending = [...tokens];
  const created: string[] = [];
  while (pending.length) {
    const token = pending.pop();
    if (!token) continue;
    if (['fence', 'code_block', 'code_inline', 'link_open', 'image', 'blockquote_open', 'bullet_list_open', 'ordered_list_open'].includes(token.type))
      created.push(token.type);
    if (token.children) pending.push(...token.children);
  }
  expect(created).toEqual([]);
  const nodes: DefaultTreeAdapterTypes.Node[] = [parseFragment(md.render(output))];
  const text: string[] = [];
  while (nodes.length) {
    const node = nodes.pop();
    if (!node) continue;
    if ('value' in node) text.push(node.value);
    if ('childNodes' in node)
      for (let at = node.childNodes.length - 1; at >= 0; at--) {
        const child = node.childNodes[at];
        if (child) nodes.push(child);
      }
  }
  expect(text.join('')).toContain(body);
  expect(renderedActiveHtml(output)).toBe(0);
});
it.each([
  ['<u>BEFORE</u><script>BODY</script><sup>AFTER</sup>', '<u>BEFORE</u>&lt;script>BODY&lt;/script><sup>AFTER</sup>'],
  ['A <script>body <img onerror="run()"></script> B', 'A &lt;script>body &lt;img onerror="run()">&lt;/script> B'],
  ['| A | B |\n| - | - |\n| x\\|y <embed> | <embed> |', '| A | B |\n| - | - |\n| x\\|y &lt;embed> | &lt;embed> |'],
])('edits only the element own span: %s', (source, expected) => {
  expect(safe(source)).toBe(expected);
  expect(renderedActiveHtml(safe(source))).toBe(0);
});
it.each(followingBaseline.cases)('keeps adjacent author text: $name', ({ source, outputs }) => {
  for (const [index, project] of [normalizePublicMarkdownContent, portablePublicMdxMarkdown].entries()) {
    const main = outputs[index] ?? '';
    const output = project(source);
    expect(output).toBe(safe(main));
    expect(renderedActiveHtml(output)).toBe(0);
    if (renderedActiveHtml(main) === 0) expect(output).toBe(main);
    if (main.includes('FOLLOW')) expect(output).toContain('FOLLOW');
    if (exportCodeSamples(main).length && !new MarkdownIt({ html: true }).parse(main, {}).some((token) => token.type === 'list_item_open')) {
      expect(exportCodeSamples(output)).toEqual(exportCodeSamples(main));
      expect(codeTokens(output)).toEqual(codeTokens(main));
    }
  }
});
it('pins adjacent-block sources to main', () => {
  expect(followingBaseline.cases.map(({ name, source }) => ({ name, source }))).toEqual(exportFollowingBlockCases());
});
it('keeps the round-7 list tight', () => {
  const source = '- <script>BODY</script>\n  FOLLOW\n- NEXT';
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    const html = new MarkdownIt({ html: true }).render(output);
    expect(html).toContain('<li>NEXT</li>');
    expect(html).not.toContain('<p>NEXT</p>');
    expect(output).toContain('FOLLOW');
    expect(output).toContain('NEXT');
    expect(renderedActiveHtml(output)).toBe(0);
  }
});

it.each([
  { name: 'top level', source: '<script>x</script>\n    <script>CODE</script>' },
  { name: 'quote', source: '> <script>x</script>\n>     <script>CODE</script>' },
])('preserves following code outside lists: $name', ({ source }) => {
  const output = safe(source);
  const md = new MarkdownIt({ html: true });
  expect(renderedActiveHtml(output)).toBe(0);
  expect(output).toContain(source.split('\n')[1]);
  expect(md.parse(output, {}).find((token) => token.type === 'code_block')?.content).toBe('<script>CODE</script>\n');
});
it('preserves component code through the portable export', () => {
  const output = portablePublicMdxMarkdown('<Note>\n\n<script>x</script>\n    <script>CODE</script>\n\n</Note>');
  expect(renderedActiveHtml(output)).toBe(0);
  expect(output).toContain('>     <script>CODE</script>');
  expect(new MarkdownIt({ html: true }).parse(output, {}).find((token) => token.type === 'code_block')?.content).toBe('<script>CODE</script>\n');
});
it('preserves following code and list tightness with bounded separators', () => {
  const source = '- <script>x</script>\n      <script>CODE</script>\n- NEXT';
  const output = safe(source);
  expect(renderedActiveHtml(output)).toBe(0);
  expect(output).toContain('      <script>CODE</script>');
  expect(codeTokens(output)).toEqual(codeTokens(source));
  const html = new MarkdownIt({ html: true }).render(output);
  expect(html).toContain('<li>NEXT</li>');
  expect(html).not.toContain('<p>NEXT</p>');
  expect(html).toContain('CODE');
  expect(html).toContain('NEXT');
});
it('neutralizes active elements through adversarial container/code transitions', () => {
  const failures: string[] = [];
  const wrappers = [
    (s: string) => s,
    (s: string) =>
      s
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    (s: string) =>
      s
        .split('\n')
        .map((line, at) => (at ? '  ' : '- ') + line)
        .join('\n'),
    (s: string) =>
      s
        .split('\n')
        .map((line, at) => (at ? '  > ' : '- > ') + line)
        .join('\n'),
    (s: string) => `<Note>\n${s}\n</Note>`,
  ];
  for (const tag of ['script', 'style', 'iframe', 'object', 'embed'])
    for (const wrap of wrappers)
      for (const gap of ['', '\n', '    ', '> '])
        for (const after of ['<script>CODE</script>', '<style>CODE</style>', '<iframe>CODE</iframe>', '<object>CODE</object>', '<embed>CODE']) {
          const source = wrap(`<${tag}>BODY</${tag}>\n${gap}${after}\n\nAUTHOR`);
          for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
            const output = project(source);
            if (renderedActiveHtml(output)) failures.push(`${source}\nOUTPUT:${output}`);
          }
        }
  expect(failures.slice(0, 4)).toEqual([]);
});

it('preserves code spans inside image alt text in an active element', () => {
  const literal = '`<script>CODE</script>`';
  const output = safe(`A <object>![${literal}](/x)</object> B`);
  expect(output).toContain(literal);
  expect(renderedActiveHtml(output)).toBe(0);
});

it.each(['script', 'style', 'iframe', 'object', 'embed'])('fixes the exact #633 form for %s', (tag) => {
  const source = `> <div>\n> ~~~\n<${tag}>SAFE</${tag}>`;
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) expect(renderedActiveHtml(project(source))).toBe(0);
  expect(portablePublicMdxMarkdown(source)).toContain('SAFE');
});

it('keeps a link-closing delimiter inside the element body literal', () => {
  const output = safe('[prefix <script>](url)</script>');
  expect(output).toContain('&#93;(url)');
  expect(renderedActiveHtml(output)).toBe(0);
});

const codeTokens = (source: string) => {
  const pending = [...new MarkdownIt({ html: true }).parse(source, {})].reverse();
  const code: string[] = [];
  while (pending.length) {
    const token = pending.pop();
    if (!token) continue;
    if (['code_block', 'fence', 'code_inline'].includes(token.type)) code.push(JSON.stringify([token.type, token.content, token.markup, token.info]));
    if (token.children) pending.push(...[...token.children].reverse());
  }
  return code;
};

const codeBoundaryCases = ['pre', 'textarea', 'div'].flatMap((opener) =>
  ['    <object>', '~~~html\n<object>CODE</object>\n~~~'].flatMap((code) =>
    ['root', 'quote', 'list', 'component'].flatMap((container) => ['', '\n'].map((gap) => ({ opener, code, container, gap }))),
  ),
);
it.each(codeBoundaryCases)(
  'preserves parsed code after a later element: $opener / $container / gap=$gap / $code',
  ({ opener, code, container, gap }) => {
    const body = `<${opener}><script></script>\n${gap}${code}`;
    const source =
      container === 'quote'
        ? body
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
        : container === 'list'
          ? body
              .split('\n')
              .map((line, at) => (at ? '  ' : '- ') + line)
              .join('\n')
          : container === 'component'
            ? `<Note>\n\n${body}\n\n</Note>`
            : body;
    const output = container === 'component' ? portablePublicMdxMarkdown(source) : safe(source);
    expect(renderedActiveHtml(output)).toBe(0);
    // Component content becomes a quote. Lists retain the approved narrow
    // exception for newly exposed elements, but real fences must remain fences.
    if (container !== 'list' || code.startsWith('~~~')) {
      expect(codeTokens(output), source).toEqual(codeTokens(container === 'component' ? body : source));
      if (container !== 'component') expect(exportCodeSamples(output)).toEqual(exportCodeSamples(source));
    }
    if (container === 'list') {
      const md = new MarkdownIt({ html: true });
      expect(md.render(`${output}\n- NEXT`).includes('<p>NEXT</p>')).toBe(md.render(`${source}\n- NEXT`).includes('<p>NEXT</p>'));
    }
    if (container === 'root') expect(codeTokens(portablePublicMdxMarkdown(source))).toEqual(codeTokens(source));
  },
);

it.each(['script', 'pre', 'style', 'textarea'])('preserves the actual HTML-block terminator </%s> rather than a matched element end', (closing) => {
  for (const code of ['    <object>CODE</object>', '~~~html\n<object>CODE</object>\n~~~']) {
    const source = `<pre><object></${closing}></object>\n${code}`;
    const output = safe(source);
    expect(renderedActiveHtml(output)).toBe(0);
    expect(codeTokens(output)).toEqual(codeTokens(source));
    expect(exportCodeSamples(output)).toEqual(exportCodeSamples(source));
  }
});

it.each(['Use `CODE` here.', 'PROSE\n\n    <object>CODE</object>', 'PROSE\n\n~~~html\n<object>CODE</object>\n~~~'])(
  'preserves later code even across intervening prose: %s',
  (following) => {
    const source = `<pre><script></script>\n\n${following}`;
    const output = safe(source);
    expect(renderedActiveHtml(output)).toBe(0);
    expect(codeTokens(output)).toEqual(codeTokens(source));
    expect(exportCodeSamples(output)).toEqual(exportCodeSamples(source));
  },
);

it('keeps source offsets across Unicode case expansion before the terminator', () => {
  const source = '<pre>\u0130<script></script>\n    <object>CODE</object>';
  const output = safe(source);
  expect(renderedActiveHtml(output)).toBe(0);
  expect(codeTokens(output)).toEqual(codeTokens(source));
  expect(exportCodeSamples(output)).toEqual(exportCodeSamples(source));
});
