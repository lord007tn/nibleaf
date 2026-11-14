import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { expect, it } from 'vitest';
import followingBaseline from './__fixtures__/markdown-export.following.main.json';
import { escapeDisallowedExportHtml as safe } from './export-html';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { renderedActiveHtml } from './testing/export-guard';
import { exportFollowingBlockCases } from './testing/export-guard-cases';

it.each([
  '<u>safe</u> <custom foo="bar">text</custom>',
  '<textarea><script>literal</script><img onerror="literal()"></textarea>',
  '<!-- <script>literal</script> -->',
  '~~~html\n<script>literal</script>\n~~~',
  '    <img onerror="literal()">',
  'Use `<img onerror="literal()">`.',
  '[unused]: data:image/png;base64,AAAA',
])('leaves inactive output byte-identical: %s', (source) => {
  expect(renderedActiveHtml(source)).toBe(0);
  expect(safe(source)).toBe(source);
});

it.each([
  '![x](data:image/png;base64,AAAA)',
  '[x](data:image/png;base64,AAAA)',
  '~~~html\n<script>literal()</script>\n~~~',
  '{expr}',
  '> 1. nested\n> - list',
  '    indented text',
  '**bold** and `code`',
])('keeps a neutralized HTML block as literal text: %s', (body) => {
  const source = `<div onclick="run()">\n${body}\n</div>`;
  const output = safe(source);
  const markdown = new MarkdownIt({ html: true });
  const tokens = markdown.parse(output, {});
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
  const nodes: DefaultTreeAdapterTypes.Node[] = [parseFragment(markdown.renderer.render(tokens, markdown.options, {}))];
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
  ['<u>safe</u> <img src="x" onerror="run()"> end', '<u>safe</u> &lt;img src="x" onerror="run()"> end'],
  ['A <script>body <img onerror="run()"></script> B', 'A &lt;script>body &lt;img onerror="run()">&lt;/script> B'],
  ['![label](data:image/png;base64,AAAA)', '![label](#)'],
  ['[label](data:image/png;base64,AAAA)', '[label](#)'],
  ['![label](mailto:me@example.test)', '![label](#)'],
  ['![label][ref]\n\n[ref]: data:image/png;base64,AAAA', '![label][ref]\n\n[ref]: #'],
  [
    '[label][one]\n\n[one]: data:image/png;base64,AAAA\n[two]: data:image/png;base64,AAAA',
    '[label][one]\n\n[one]: #\n[two]: data:image/png;base64,AAAA',
  ],
  ['![label][ref]\n\n[ref]: d&#97;ta:image/png;base64,AAAA', '![label][ref]\n\n[ref]: #'],
  ['> ![label](data:image/png;base64,AAAA)\r\n> `code`', '> ![label](#)\r\n> `code`'],
  [
    '- A <img onerror="run()"> B\n\n  ~~~\n  <img onerror="literal()">\n  ~~~',
    '- A &lt;img onerror="run()"> B\n\n  ~~~\n  <img onerror="literal()">\n  ~~~',
  ],
  [
    '| A | B |\n| - | - |\n| <img onerror="one()"> | <img onerror="two()"> |',
    '| A | B |\n| - | - |\n| &lt;img onerror="one()"> | &lt;img onerror="two()"> |',
  ],
  [
    '| A | B |\n| - | - |\n| x\\|y <img onerror="one()"> | x\\|y <img onerror="two()"> |',
    '| A | B |\n| - | - |\n| x\\|y &lt;img onerror="one()"> | x\\|y &lt;img onerror="two()"> |',
  ],
  [
    '<textarea onfocus="run()">![x](data:image/png;base64,AAAA)</textarea>',
    '&lt;textarea onfocus="run()">!&#91;x](data:image/png;base64,AAAA)&lt;/textarea>',
  ],
])('edits only unsafe spans: %s', (source, expected) => {
  expect(safe(source)).toBe(expected);
  expect(renderedActiveHtml(safe(source))).toBe(0);
});

it.each(followingBaseline.cases)('preserves the next block: $name', ({ source, outputs }) => {
  const markdown = new MarkdownIt({ html: true });
  for (const [index, project] of [normalizePublicMarkdownContent, portablePublicMdxMarkdown].entries()) {
    const main = outputs[index] ?? '';
    const output = project(source);
    expect(output).toBe(safe(main));
    expect(renderedActiveHtml(output)).toBe(0);
    if (renderedActiveHtml(main) === 0) expect(output).toBe(main);
    const before = markdown.parse(main, {});
    const after = markdown.parse(output, {});
    const next = before.find((token) => token.map && ['inline', 'fence', 'code_block'].includes(token.type) && token.content.includes('FOLLOW'));
    if (!next?.map) continue; // Main itself removed this authored block.
    const retained = after.find((token) => token.type === next.type && token.content === next.content);
    expect(retained, main).toBeDefined();
    if (!retained?.map) continue;
    const shift = retained.map[0] - next.map[0];
    // Maps use physical lines. Undo only the authorized inserted boundary line.
    expect(shift).toBeGreaterThanOrEqual(0);
    expect(shift).toBeLessThanOrEqual(1);
    const roles = (tokens: typeof before, map: [number, number], offset: number) =>
      tokens
        .filter((token) => token.map?.[0] === map[0] && token.map[1] === map[1])
        .map((token) => [token.type, token.map?.map((line) => line - offset)]);
    expect(roles(after, retained.map, shift)).toEqual(roles(before, next.map, 0));
    if (next.type === 'fence' || next.type === 'code_block') {
      const code = main
        .split('\n')
        .slice(...next.map)
        .join('\n');
      expect(
        output
          .split('\n')
          .slice(...retained.map)
          .join('\n'),
      ).toBe(code);
    }
  }
});

it('pins every generated following-block source to main', () => {
  expect(followingBaseline.cases.map(({ name, source }) => ({ name, source }))).toEqual(exportFollowingBlockCases());
});
