import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { describe, expect, it } from 'vitest';
import { MDX_BLOCK_TAGS, normalizeMdxBlocks, rehypeAuthoredComponentProps, sanitizeSchema } from './mdx-config';

describe('math sanitization boundary', () => {
  it('preserves only recognized code markers and strips authored styling and handlers', () => {
    const result = rehypeSanitize(sanitizeSchema)({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: {
            className: ['language-ts', 'math-inline', 'math-display', 'arbitrary-code-class'],
            style: 'position:fixed',
            onClick: 'alert(1)',
          },
          children: [{ type: 'text', value: 'x' }],
        },
      ],
    });
    const code = result.children[0];
    if (code?.type !== 'element') throw new Error('Sanitized code element was not preserved');
    expect(code.properties.className).toEqual(['language-ts', 'math-inline', 'math-display']);
    expect(code.properties).not.toHaveProperty('style');
    expect(code.properties).not.toHaveProperty('onClick');
    expect(sanitizeSchema.tagNames).not.toContain('math');
  });
});

describe('normalizeMdxBlocks', () => {
  it('inserts blank lines around an opening/closing block tag with adjacent content', () => {
    expect(normalizeMdxBlocks('<Note>\ntext\n</Note>')).toBe('<Note>\n\ntext\n\n</Note>');
    expect(normalizeMdxBlocks('<Callout type="tip">\n**text**\n</Callout>')).toBe('<Callout type="tip">\n\n**text**\n\n</Callout>');
  });
  it('gives one-line block components block form so they never land inside a paragraph', () => {
    expect(normalizeMdxBlocks('Intro.\n\n<Callout type="tip">Upgrading is **instant**.</Callout>\n\nAfter.')).toBe(
      'Intro.\n\n<Callout type="tip">\n\nUpgrading is **instant**.\n\n</Callout>\n\nAfter.',
    );
    expect(normalizeMdxBlocks('  <Accordion title="Why?">Because.</Accordion>')).toBe('<Accordion title="Why?">\n\nBecause.\n\n</Accordion>');
    expect(normalizeMdxBlocks('```mdx\n<Note>Example</Note>\n```')).toBe('```mdx\n<Note>Example</Note>\n```');
    expect(normalizeMdxBlocks('Use <Tooltip tip="x">this</Tooltip> inline.')).toBe('Use <Tooltip tip="x">this</Tooltip> inline.');
    const once = normalizeMdxBlocks('<Note>Text</Note>');
    expect(normalizeMdxBlocks(once)).toBe(once);
  });
  it('never rewrites code samples, including nested and mixed fences', () => {
    const nested = '````md\n```mdx\n<Note>Example</Note>\n```\n<Frame>\nimg\n</Frame>\n````';
    expect(normalizeMdxBlocks(nested)).toBe(nested);
    const mixed = '~~~\n<Note>Inside tildes</Note>\n```\n<Card title="x" />\n~~~';
    expect(normalizeMdxBlocks(mixed)).toBe(mixed);
    const block = '```mdx\n<Note>\ntext\n</Note>\n```';
    expect(normalizeMdxBlocks(block)).toBe(block);
    // Prose after a closed fence is still normalized.
    expect(normalizeMdxBlocks('````\n```\n````\n<Note>After</Note>')).toBe('````\n```\n````\n<Note>\n\nAfter\n\n</Note>');
  });
  it('leaves fenced samples inside list items and blockquotes, and inline code, untouched', () => {
    const inList = '- Example:\n  ```mdx\n  <Note>Example</Note>\n  ```';
    expect(normalizeMdxBlocks(inList)).toBe(inList);
    const inQuote = '> ```mdx\n> <Frame>\n> img\n> </Frame>\n> ```';
    expect(normalizeMdxBlocks(inQuote)).toBe(inQuote);
    expect(normalizeMdxBlocks('Use `<Frame>` or `<Icon icon="x" />` in prose.')).toBe('Use `<Frame>` or `<Icon icon="x" />` in prose.');
    expect(normalizeMdxBlocks('<Frame>\nimg\n</Frame> and `<Frame>`')).toBe('<mdxframe>\n\nimg\n</mdxframe> and `<Frame>`');
  });
  it('expands nested one-line block components level by level and leaves same-tag siblings alone', () => {
    expect(normalizeMdxBlocks('<CardGroup cols="2"><Card title="A">Body</Card></CardGroup>')).toBe(
      '<CardGroup cols="2">\n\n<Card title="A">\n\nBody\n\n</Card>\n\n</CardGroup>',
    );
    const siblings = '<Card title="A">a</Card><Card title="B">b</Card>';
    expect(normalizeMdxBlocks(siblings)).toBe(siblings);
  });
  it('is idempotent', () => {
    const once = normalizeMdxBlocks('<Card title="x">\nbody\n</Card>');
    expect(normalizeMdxBlocks(once)).toBe(once);
  });
  it('leaves already-spaced blocks unchanged (no double blanks)', () => {
    const src = '<Note>\n\ntext\n\n</Note>';
    expect(normalizeMdxBlocks(src)).toBe(src);
  });
  it('renames <Frame> to <mdxframe> to dodge the real HTML <frame> element', () => {
    const out = normalizeMdxBlocks('<Frame>\nimg\n</Frame>');
    expect(out).toContain('<mdxframe>');
    expect(out).toContain('</mdxframe>');
    expect(out).not.toContain('<Frame>');
  });
  it('normalizes nested authored file, API example, and related-content blocks', () => {
    const source = [
      '<FileTree>',
      '<Folder name="src">',
      '<File name="index.ts">',
      '</File>',
      '</Folder>',
      '</FileTree>',
      '<ApiExample>',
      '<RequestExample>',
      'request',
      '</RequestExample>',
      '<ResponseExample>',
      'response',
      '</ResponseExample>',
      '</ApiExample>',
      '<RelatedContent>',
      '<RelatedCard title="Next">',
      'description',
      '</RelatedCard>',
      '</RelatedContent>',
    ].join('\n');
    const output = normalizeMdxBlocks(source);
    expect(output).toContain('<Folder name="src">\n\n<File name="index.ts">');
    expect(output).toContain('<RequestExample>\n\nrequest\n\n</RequestExample>');
    expect(output).toContain('<RelatedCard title="Next">\n\ndescription\n\n</RelatedCard>');
    expect(normalizeMdxBlocks(output)).toBe(output);
  });
  it('expands indented authored atoms so HTML parsing keeps siblings separate', () => {
    const output = normalizeMdxBlocks(
      '<FileTree>\n  <Folder name="src">\n    <File name="index.ts" />\n    <File name="types.ts" />\n  </Folder>\n</FileTree>\n<RelatedContent>\n  <RelatedCard title="One" />\n  <RelatedCard title="Two" />\n</RelatedContent>',
    );
    expect(output).toContain('<File name="index.ts" ></File>');
    expect(output).toContain('<File name="types.ts" ></File>');
    expect(output).toContain('<RelatedCard title="One" ></RelatedCard>');
  });
});

// Literal values from before the reader config was derived from the component
// registry. A component change that alters these is a deliberate reader change:
// update the literals in the same commit.
const COMPONENT_TAG_NAMES = [
  'callout',
  'note',
  'warning',
  'info',
  'tip',
  'check',
  'danger',
  'card',
  'cardgroup',
  'tabs',
  'tab',
  'accordion',
  'accordiongroup',
  'steps',
  'step',
  'mdxframe',
  'tooltip',
  'paramfield',
  'responsefield',
  'expandable',
  'codegroup',
  'icon',
  'update',
  'columns',
  'column',
  'banner',
  'badge',
  'button',
  'filetree',
  'folder',
  'file',
  'apiexample',
  'requestexample',
  'responseexample',
  'relatedcontent',
  'relatedcard',
  'mermaid',
];
// Mintlify parity added the props after the first
// entry of each line; camelCase props are also allowed lowercased.
const COMPONENT_ATTRIBUTES: Record<string, string[]> = {
  callout: ['type', 'icon', 'color'],
  card: ['title', 'href', 'icon', 'horizontal', 'img', 'cta', 'arrow', 'color'],
  cardgroup: ['cols'],
  steps: ['titleSize', 'titlesize'],
  tabs: ['defaultTabIndex', 'defaulttabindex', 'sync', 'borderBottom', 'borderbottom'],
  tab: ['title', 'icon', 'id'],
  accordion: ['title', 'defaultOpen', 'defaultopen', 'description', 'icon', 'id'],
  step: ['title', 'icon', 'stepNumber', 'stepnumber', 'titleSize', 'titlesize'],
  mdxframe: ['caption', 'hint'],
  tooltip: ['tip', 'headline', 'cta', 'href'],
  paramfield: ['path', 'query', 'header', 'body', 'dataDisplayName', 'type', 'required', 'default', 'deprecated', 'placeholder', 'pre', 'post'],
  responsefield: ['dataDisplayName', 'type', 'required', 'default', 'deprecated', 'pre', 'post'],
  expandable: ['title', 'defaultOpen', 'defaultopen'],
  columns: ['cols'],
  icon: ['icon', 'dataDisplayName', 'color', 'size'],
  update: ['label', 'description', 'tags'],
  banner: ['type'],
  badge: ['color', 'size', 'shape', 'icon', 'stroke', 'disabled'],
  button: ['href', 'variant'],
  folder: ['dataDisplayName', 'defaultOpen', 'defaultopen'],
  file: ['dataDisplayName', 'icon'],
  apiexample: ['title'],
  requestexample: ['title'],
  responseexample: ['title', 'status'],
  relatedcontent: ['title'],
  relatedcard: ['title', 'description', 'href', 'icon'],
};
const BLOCK_TAGS =
  'Callout|Note|Warning|Info|Tip|Check|Danger|Card|CardGroup|Tabs|Tab|Accordion|AccordionGroup|Steps|Step|Frame|ParamField|ResponseField|Expandable|Update|Columns|Column|Banner|FileTree|Folder|File|ApiExample|RequestExample|ResponseExample|RelatedContent|RelatedCard';

const sorted = (values: readonly string[]) => [...values].sort();
type TestElement = { type: string; tagName: string; properties: Record<string, unknown>; children: TestElement[] };
const element = (tagName: string, properties: Record<string, unknown> = {}, children: TestElement[] = []): TestElement => ({
  type: 'element',
  tagName,
  properties,
  children,
});

describe('reader config derived from the component registry', () => {
  it('allows exactly the component tags it allowed before', () => {
    const defaults = defaultSchema.tagNames ?? [];
    expect(sanitizeSchema.tagNames?.slice(0, defaults.length)).toEqual(defaults);
    expect(sorted(sanitizeSchema.tagNames?.slice(defaults.length) ?? [])).toEqual(sorted(COMPONENT_TAG_NAMES));
  });

  it('allows exactly the component attributes it allowed before', () => {
    const { '*': star, pre, code, ...rest } = sanitizeSchema.attributes ?? {};
    const { '*': defaultStar, pre: defaultPre, code: _defaultCode, ...defaultRest } = defaultSchema.attributes ?? {};
    expect(star).toEqual([...(defaultStar ?? []), 'className', 'id']);
    expect(pre).toEqual([...(defaultPre ?? []), 'dataTitle', 'dataLang']);
    expect(code).toEqual([['className', /^language-./, 'math-inline', 'math-display'], 'dataTitle', 'dataLang']);
    for (const [tag, attributes] of Object.entries(defaultRest)) {
      if (!(tag in COMPONENT_ATTRIBUTES)) expect(rest[tag], tag).toEqual(attributes);
    }
    const components = Object.entries(rest).filter(([tag]) => !(tag in defaultRest) || tag in COMPONENT_ATTRIBUTES);
    // Attribute order is irrelevant to the sanitizer; compare as sets.
    expect(Object.fromEntries(components.map(([tag, attributes]) => [tag, sorted(attributes as string[])]))).toEqual(
      Object.fromEntries(Object.entries(COMPONENT_ATTRIBUTES).map(([tag, attributes]) => [tag, sorted(attributes)])),
    );
  });

  it('treats the same tags as Markdown-bodied blocks', () => {
    // The tags form a regex alternation followed by \b, so their order does not matter.
    expect(sorted(MDX_BLOCK_TAGS)).toEqual(sorted(BLOCK_TAGS.split('|')));
  });

  it('expands every self-closing component and only those', () => {
    const output = normalizeMdxBlocks('<File name="a" />\n\n<RelatedCard title="b" />\n\nInline <Icon icon="star" /> and <Badge color="x" /> text');
    expect(output).toContain('<File name="a" ></File>');
    expect(output).toContain('<RelatedCard title="b" ></RelatedCard>');
    expect(output).toContain('<Icon icon="star" ></Icon>');
    expect(output).toContain('<Badge color="x" />');
  });

  it('moves `name` to a display attribute only on the components it did before', () => {
    const tags = ['folder', 'file', 'paramfield', 'responsefield', 'icon', 'card', 'tab', 'button', 'input'];
    const tree = element(
      'root',
      {},
      tags.map((tagName) => element(tagName, { name: 'x' })),
    );
    tree.type = 'root';
    rehypeAuthoredComponentProps()(tree as never);
    expect(tree.children.map((child) => [child.tagName, child.properties])).toEqual([
      ['folder', { dataDisplayName: 'x' }],
      ['file', { dataDisplayName: 'x' }],
      ['paramfield', { dataDisplayName: 'x' }],
      ['responsefield', { dataDisplayName: 'x' }],
      ['icon', { dataDisplayName: 'x' }],
      ['card', { name: 'x' }],
      ['tab', { name: 'x' }],
      ['button', { name: 'x' }],
      ['input', { name: 'x' }],
    ]);
  });

  it('unwraps paragraphs around the same structural items as before', () => {
    const structural = ['card', 'tab', 'accordion', 'step', 'column', 'folder', 'file', 'requestexample', 'responseexample', 'relatedcard'];
    const containers = ['cardgroup', 'tabs', 'steps', 'note', 'badge', 'mdxframe', 'filetree', 'apiexample', 'relatedcontent', 'expandable'];
    const tree = element(
      'root',
      {},
      [...structural, ...containers].map((tagName) => element('p', {}, [element(tagName)])),
    );
    tree.type = 'root';
    rehypeAuthoredComponentProps()(tree as never);
    expect(tree.children.map((child) => child.tagName)).toEqual([...structural, ...containers.map(() => 'p')]);
  });
});
