import { describe, expect, it } from 'vitest';
import { detectUnsupportedMdxTags } from './unsupported-mdx';

describe('detectUnsupportedMdxTags', () => {
  it('returns nothing for plain markdown', () => {
    expect(detectUnsupportedMdxTags('# Title\n\nSome **bold** text and a [link](/x).')).toEqual([]);
  });

  it('returns nothing for every editor-supported component', () => {
    const doc = [
      '<Steps>\n<Step title="One">\nBody\n</Step>\n</Steps>',
      '<CardGroup cols="2">\n<Card title="A">a</Card>\n</CardGroup>',
      '<Tabs>\n<Tab title="T">t</Tab>\n</Tabs>',
      '<AccordionGroup>\n<Accordion title="Q">a</Accordion>\n</AccordionGroup>',
      '<Frame caption="c">\n\n</Frame>',
      '<Expandable title="More">m</Expandable>',
      '<Update label="v1">u</Update>',
      '<ParamField path="id" type="string">p</ParamField>',
      '<ResponseField name="ok" type="boolean">r</ResponseField>',
      '<CodeGroup>\n\n</CodeGroup>',
      'Inline <Tooltip tip="hi">text</Tooltip> and <Icon icon="rocket" />.',
      '<Note>\nnote\n</Note>\n<Warning>\nw\n</Warning>\n<Callout type="tip">\nc\n</Callout>',
    ].join('\n\n');
    expect(detectUnsupportedMdxTags(doc)).toEqual([]);
  });

  it('flags unknown component tags (opening, closing, and self-closing)', () => {
    expect(detectUnsupportedMdxTags('<Snippet file="x.mdx" />')).toEqual(['Snippet']);
    expect(detectUnsupportedMdxTags('<RequestExample>\nbody\n</RequestExample>')).toEqual(['RequestExample']);
    expect(detectUnsupportedMdxTags('</OrphanClose>')).toEqual(['OrphanClose']);
  });

  it('reports each unknown tag once, in order of first appearance', () => {
    const doc = '<Beta>\n</Beta>\n<Alpha />\n<Beta>again</Beta>';
    expect(detectUnsupportedMdxTags(doc)).toEqual(['Beta', 'Alpha']);
  });

  it('ignores tags inside fenced code blocks', () => {
    const doc = '```jsx\n<Whatever prop="x" />\n```\n\nAfter the fence.';
    expect(detectUnsupportedMdxTags(doc)).toEqual([]);
  });

  it('still detects tags after a fence closes', () => {
    const doc = '```\n<InFence />\n```\n\n<OutOfFence />';
    expect(detectUnsupportedMdxTags(doc)).toEqual(['OutOfFence']);
  });

  it('ignores tags inside inline code spans', () => {
    expect(detectUnsupportedMdxTags('Use `<Snippet />` to include files.')).toEqual([]);
  });

  it('ignores lowercase HTML, autolinks, and comparisons', () => {
    expect(detectUnsupportedMdxTags('<br /> and <https://example.com> and a < B comparison')).toEqual([]);
    expect(detectUnsupportedMdxTags('Email <Foo@example.com> stays untouched.')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(detectUnsupportedMdxTags('')).toEqual([]);
  });
});
