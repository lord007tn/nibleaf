import { fencedMarkdownLines, markdownLineKinds } from '@nibleaf/shared/markdown-code';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { importCodeLines } from './import-markdown-code';
import { rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const adjacentContainers = [
  ['quote', '> Step', '> ', 1],
  ['list', '- Step', '  ', 2],
  ['nested list', '- Outer\n\n  - Step', '    ', 4],
  ['quote in list', '1. Outer\n\n   > Step', '   > ', 3],
  ['numbered list', '1. Step', '   ', 2],
  ['nested quote', '> > Step', '> > ', 2],
] as const;
const parser = new MarkdownIt({ html: true });
const convertGitBook = (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content;
const mediaTokenCounts = (content: string) => {
  const children = parser.parse(content, {}).flatMap((token) => token.children ?? []);
  return { links: children.filter((token) => token.type === 'link_open').length, images: children.filter((token) => token.type === 'image').length };
};

const sameLineForms = [
  ['link suffix', '', '[After](https://example.test/after)', { links: 1, images: 0 }],
  ['image suffix', '', '![x](y)', { links: 0, images: 1 }],
  ['plain leading text', 'Before', '', { links: 0, images: 0 }],
  ['leading text', '[Before](https://example.test/before) ![before](before.png)', '', { links: 1, images: 1 }],
  [
    'both sides',
    '[Before](https://example.test/before) ![before](before.png)',
    '[After](https://example.test/after) ![x](y)',
    { links: 2, images: 2 },
  ],
] as const;
const liquidEmbed = '{% embed url="https://youtu.be/abcdefghijk" %}';

it.each([
  ['link suffix', `> ${liquidEmbed} [After](https://example.test/after)`, { links: 1, images: 0 }],
  ['image suffix', `> ${liquidEmbed} ![x](y)`, { links: 0, images: 1 }],
  ['leading text', `> Before ${liquidEmbed}`, { links: 0, images: 0 }],
] as const)('separates the exact single-line quote repro with %s', (_form, source, expected) => {
  const content = convertGitBook(source);
  const tokens = parser.parse(content, {});
  expect(tokens.find((token) => token.type === 'html_block')?.level).toBe(1);
  expect(tokens.find((token) => token.type === 'inline')?.level).toBe(2);
  expect(mediaTokenCounts(content)).toEqual(expected);
  expect(convertGitBook(content)).toBe(content);
});

describe.each(adjacentContainers)('same-line GitBook media in %s', (_name, opening, prefix, depth) => {
  it.each(sameLineForms)('separates %s into blocks in the same container', (_form, before, after) => {
    const source = `${opening}\n${prefix}${before ? `${before} ` : ''}${liquidEmbed}${after ? ` ${after}` : ''}`;
    const content = convertGitBook(source);
    const tokens = parser.parse(content, {});
    const frame = tokens.find((token) => token.type === 'html_block' && token.content.includes('<iframe'));
    expect(frame?.level).toBe(depth);
    for (const prose of [before, after].filter(Boolean)) {
      expect(tokens.find((token) => token.type === 'inline' && token.content.trimEnd().endsWith(prose))?.level).toBe(depth + 1);
    }
    expect(frame?.content.trim().startsWith('<iframe ')).toBe(true);
    expect(frame?.content.trim().endsWith('</iframe>')).toBe(true);
    expect(frame?.content.split('\n').filter(Boolean)).toHaveLength(1);
    const expected = mediaTokenCounts([before, after].join('\n\n'));
    expect(mediaTokenCounts(content)).toEqual(expected);
    expect(convertGitBook(content)).toBe(content);
    const withoutSuffix = `${opening}\n${prefix}${before ? `${before} ` : ''}${liquidEmbed}`;
    expect(convertGitBook(`${withoutSuffix}   \t`)).toBe(convertGitBook(withoutSuffix));
  });
});

it('keeps prose around a list-marker-line embed inside the list item', () => {
  const content = convertGitBook('- Step {% embed url="https://youtu.be/abcdefghijk" %} [After](https://example.test/after) ![x](y)');
  const tokens = parser.parse(content, {});
  expect(tokens.find((token) => token.type === 'html_block')?.level).toBe(2);
  expect(tokens.find((token) => token.type === 'inline' && token.content === 'Step')?.level).toBe(3);
  expect(tokens.find((token) => token.type === 'inline' && token.content.includes('[After]'))?.level).toBe(3);
  expect(mediaTokenCounts(content)).toEqual({ links: 1, images: 1 });
  expect(convertGitBook(content)).toBe(content);
});

it('separates a quote embed with no preceding prose or blank lines', () => {
  const content = convertGitBook('> {% embed url="https://youtu.be/abcdefghijk" %}\n> [After](/next)');
  expect(mediaTokenCounts(content).links).toBe(1);
  expect(parser.parse(content, {}).find((token) => token.type === 'inline')?.level).toBe(2);
  expect(convertGitBook(content)).toBe(content);
});

describe.each(adjacentContainers)('adjacent GitBook embed in %s', (_name, opening, prefix, depth) => {
  it.each([
    ['link', '[After](https://example.test/after)', 'inline'],
    ['image', '![x](y)', 'inline'],
    ['heading', '## After', 'heading_open'],
    ['component', '<Note>\nAfter\n</Note>', 'html_block'],
  ])('separates a following %s while retaining its container', (_kind, after, type) => {
    const source = `${opening}\n${prefix}{% embed url="https://youtu.be/abcdefghijk" %}\n${prefix}${after.replaceAll('\n', `\n${prefix}`)}`;
    const content = convertGitBook(source);
    const tokens = parser.parse(content, {});
    const frame = tokens.find((token) => token.type === 'html_block' && token.content.includes('<iframe'));
    expect(frame?.level).toBe(depth);
    expect(frame?.content).not.toContain(after);
    const following = tokens.find(
      (token) => token.type === type && (type === 'heading_open' || token.content === after || token.content === `${after}\n`),
    );
    expect(following).toBeDefined();
    expect(following?.level).toBe(depth + (type === 'inline' ? 1 : 0));
    if (_kind === 'link') expect(mediaTokenCounts(content).links).toBeGreaterThanOrEqual(1);
    if (_kind === 'image') expect(mediaTokenCounts(content).images).toBeGreaterThanOrEqual(1);
    expect(convertGitBook(content)).toBe(content);
    // Adding separators to an already separated source must not add blanks.
    const separated = `${opening}\n${prefix.trimEnd()}\n${prefix}{% embed url="https://youtu.be/abcdefghijk" %}\n${prefix.trimEnd()}\n${prefix}${after.replaceAll('\n', `\n${prefix}`)}`;
    const blankCount = (value: string) => value.split('\n').filter((line) => !line.trim() || line.trim() === prefix.trim()).length;
    const convertedSeparated = convertGitBook(separated);
    expect(blankCount(convertedSeparated)).toBe(blankCount(content));
    expect(convertGitBook(convertedSeparated)).toBe(convertedSeparated);
  });
});

it('retains main link/image token counts across the container matrix', () => {
  for (const [name, opening, prefix] of adjacentContainers) {
    const source = `${opening}\n${prefix}{% embed url="https://youtu.be/abcdefghijk" %}\n${prefix}[After](https://example.test/after)\n${prefix}![x](y)`;
    const actual = mediaTokenCounts(convertGitBook(source));
    // Recorded using the b50e2e38 converter: nested-list output was indented
    // code; every other row rendered one link and one image.
    const mainCount = name === 'nested list' ? 0 : 1;
    expect(actual.links, name).toBeGreaterThanOrEqual(mainCount);
    expect(actual.images, name).toBeGreaterThanOrEqual(mainCount);
    for (const [form, before, after, mainCounts] of sameLineForms) {
      const inlineSource = `${opening}\n${prefix}${before ? `${before} ` : ''}${liquidEmbed}${after ? ` ${after}` : ''}`;
      const inlineCounts = mediaTokenCounts(convertGitBook(inlineSource));
      // Measured with b50e2e38: these five same-line counts are identical in
      // all six containers, including the nested list.
      expect(inlineCounts.links, `${name}: ${form}`).toBeGreaterThanOrEqual(mainCounts.links);
      expect(inlineCounts.images, `${name}: ${form}`).toBeGreaterThanOrEqual(mainCounts.images);
    }
  }
});

it.each([
  ['list', '- Step one', '  ', '- Step two'],
  ['nested list', '- Outer\n\n  - Step one', '    ', '  - Step two'],
  ['quote', '> Step one', '> ', '> Step two'],
  ['quote in list', '- Outer\n\n  > Step one', '  > ', '- Step two'],
  ['numbered list', '1. Step one', '   ', '2. Step two'],
])('keeps GitBook embeds and following prose in their %s (#585)', (_name, opening, prefix, ending) => {
  const source = `${opening}\n${prefix}\n${prefix}{% embed url="https://youtu.be/abcdefghijk" %}\n${prefix}\n${prefix}Then continue.\n${ending}`;
  const content = convertGitBookMarkdown(source, { resolveFile: () => undefined }).content;
  expect(content).toContain(`\n${prefix}<iframe `);
  expect(content).toContain(`\n${prefix}Then continue.`);
  // No editor load/save helper exists in importer tests. Check the shared
  // reader's block classification and the Markdown parser's container depths.
  expect(fencedMarkdownLines(content.split('\n')).some(Boolean)).toBe(false);
  expect(markdownLineKinds(content.split('\n'))[content.split('\n').findIndex((line) => line.includes('Then continue.'))]).toBe('prose');
  const tokens = new MarkdownIt({ html: true }).parse(content, {});
  const frame = tokens.find((token) => token.type === 'html_block' && token.content.includes('<iframe'));
  const following = tokens.find((token) => token.type === 'inline' && token.content.startsWith('Then continue.'));
  expect(frame).toBeDefined();
  expect(following).toBeDefined();
  expect(frame?.level).toBeGreaterThan(0);
  expect(following?.level).toBe((frame?.level ?? 0) + 1);
});

describe.each([
  [
    'GitBook',
    (source: string, issues: string[]) => {
      const result = convertGitBookMarkdown(source, { resolveFile: () => undefined });
      issues.push(...result.issues.map(({ reference }) => reference));
      return result.content;
    },
  ],
  ['Mintlify', (source: string, issues: string[]) => normalizeMintlifyMdx(source, (url) => issues.push(url))],
] as const)('%s container/media regressions', (_name, convert) => {
  it('also preserves the unindented #588 issue example (already passing on main)', () => {
    const source = '<CodeGroup>\n> ```md\n> [Literal](/literal)\n</CodeGroup>\n\n[After](/next)';
    const content = rewriteMintlifyInternalLinks(convert(source, []), 'intro', new Map([['next', '/rewritten']]));
    expect(content).toContain('[After](/rewritten)');
    expect(normalizeMintlifyMdx(content)).not.toContain('</CodeGroup>');
  });
  it.each([
    ['http', '<video src="http://cdn.test/a.mp4">', 'http://cdn.test/a.mp4'],
    ['https', '<video src="https://cdn.test/a.mp4">', 'https://cdn.test/a.mp4'],
    ['no source', '<video>', ''],
    ['following content', '<video src="https://cdn.test/a.mp4">\n\nKeep this paragraph.\n\n[After](/next)', 'https://cdn.test/a.mp4'],
  ])('makes an unclosed video inert: %s (#584)', (_case, source, url) => {
    const issues: string[] = [];
    const content = convert(source, issues);
    expect(content).not.toContain('<video');
    if (url) expect(content).toContain(`<a href="${url}">`);
    else expect(content).toContain('&lt;video&gt;');
    if (source.includes('Keep this')) expect(content).toContain('Keep this paragraph.\n\n[After](/next)');
    expect(issues).toHaveLength(1);
  });

  it.each([
    ['quote', '    > ```md\n    > [Literal](/literal)'],
    ['list', '    - ```md\n      [Literal](/literal)'],
    ['list with blank', '    - ```md\n      [Literal](/literal)\n\n      [Still literal](/literal)'],
  ])('ends an unclosed %s fence before the component closer (#588)', (_case, example) => {
    const source = `<CodeGroup>\n${example}\n</CodeGroup>\n\n[After](/next)`;
    const code = importCodeLines(source);
    expect(code).toEqual(fencedMarkdownLines(source.split('\n')));
    expect(code[source.split('\n').indexOf('</CodeGroup>')]).toBe(false);
    const content = rewriteMintlifyInternalLinks(convert(source, []), 'intro', new Map([['next', '/rewritten']]));
    expect(content).toContain('[Literal](/literal)');
    if (example.includes('Still literal')) expect(content).toContain('[Still literal](/literal)');
    expect(content).toContain('[After](/rewritten)');
    expect(normalizeMintlifyMdx(content)).not.toContain('</CodeGroup>');
  });

  it.each([
    ['quoted list', '> - ', '>   ', '>'],
    ['nested quoted list', '> > - ', '> >   ', '> >'],
    ['quoted ordered list', '> 1. ', '>    ', '>'],
  ])('protects a blank quote line in an unclosed %s fence', (_case, opening, continuation, blank) => {
    const example = `    ${opening}\`\`\`md\n    ${continuation}[Literal](/literal)\n    ${blank}\n    ${continuation}[Still literal](/literal)`;
    const source = `<CodeGroup>\n${example}\n</CodeGroup>\n\n[After](/next)`;
    const code = importCodeLines(source);
    // Strip component indentation for markdown-it, which treats that indent
    // as code rather than MDX structure. A blank separates the oracle wrapper
    // from its Markdown body so its HTML block cannot swallow the example.
    const oracleSource = `<CodeGroup>\n\n${example.replaceAll('    >', '>')}\n</CodeGroup>\n\n[After](/next)`;
    const oracle = new MarkdownIt({ html: true }).parse(oracleSource, {});
    expect(oracle.filter((token) => token.type === 'fence').map((token) => token.content)).toEqual([
      '[Literal](/literal)\n\n[Still literal](/literal)\n',
    ]);
    expect(code[3]).toBe(true);
    expect(code[4]).toBe(true);
    const content = rewriteMintlifyInternalLinks(
      convert(source, []),
      'intro',
      new Map([
        ['literal', '/changed'],
        ['next', '/rewritten'],
      ]),
    );
    expect(content).toContain('[Still literal](/literal)');
    expect(content).not.toContain('/changed');
    expect(content).toContain('[After](/rewritten)');
  });
});
