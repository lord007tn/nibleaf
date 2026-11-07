import { describe, expect, it } from 'vitest';
import { formatMdxLiteralExpression, literalJsxAttributesToHtml, parseMdxList, parseMdxLiteralExpression } from './mdx-attributes';

const components = new Set(['CardGroup', 'Columns', 'Accordion', 'Update', 'ParamField', 'Steps', 'Step', 'Tabs', 'Card', 'Badge']);
const isComponent = (tag: string) => components.has(tag);

describe('parseMdxLiteralExpression', () => {
  it.each([
    ['{3}', 3],
    ['{ -1.5 }', -1.5],
    ['{true}', true],
    ['{false}', false],
    ['{"Hello"}', 'Hello'],
    ["{'It\\'s'}", "It's"],
    ['{`plain`}', 'plain'],
    ['{["Feature", "Fix"]}', ['Feature', 'Fix']],
    ["{['GET', ]}", ['GET']],
    ['{[]}', []],
  ])('reads %s', (source, expected) => {
    expect(parseMdxLiteralExpression(source)).toEqual(expected);
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: an authored template literal with a placeholder is the case under test.
  it.each(['{flags.cols}', '{1 + 2}', '{`${name}`}', '{["a", b]}', '{{ a: 1 }}', '{"a" + "b"}', '3', '{fn()}'])('leaves %s as code', (source) => {
    expect(parseMdxLiteralExpression(source)).toBeUndefined();
  });

  it('writes the canonical JSX form', () => {
    expect(formatMdxLiteralExpression(3)).toBe('{3}');
    expect(formatMdxLiteralExpression(false)).toBe('{false}');
    expect(formatMdxLiteralExpression(['Feature', 'Say "hi"'])).toBe('{["Feature", "Say \\"hi\\""]}');
    expect(parseMdxLiteralExpression(formatMdxLiteralExpression(['Feature', 'Say "hi"']))).toEqual(['Feature', 'Say "hi"']);
  });

  it('reads list attributes in every authored form', () => {
    expect(parseMdxList('{["A", "B"]}')).toEqual(['A', 'B']);
    expect(parseMdxList('["A","B"]')).toEqual(['A', 'B']);
    expect(parseMdxList('Single')).toEqual(['Single']);
    expect(parseMdxList(['A'])).toEqual(['A']);
    expect(parseMdxList('')).toEqual([]);
    expect(parseMdxList('{tags}')).toEqual([]);
  });
});

describe('literalJsxAttributesToHtml', () => {
  it('turns literal expression props on components into HTML attributes', () => {
    expect(literalJsxAttributesToHtml('<CardGroup cols={3}>', isComponent)).toBe('<CardGroup cols="3">');
    expect(literalJsxAttributesToHtml('<Accordion title={"Hi"} defaultOpen={true}>', isComponent)).toBe('<Accordion title="Hi" defaultOpen="true">');
    expect(literalJsxAttributesToHtml('<Tabs sync={false}>', isComponent)).toBe('<Tabs sync="false">');
    expect(literalJsxAttributesToHtml('<Update label="v2" tags={["Feature", "Fix"]}>', isComponent)).toBe(
      '<Update label="v2" tags="[&quot;Feature&quot;,&quot;Fix&quot;]">',
    );
    expect(literalJsxAttributesToHtml('<Step stepNumber={2} />', isComponent)).toBe('<Step stepNumber="2" />');
  });

  it('escapes literal strings so they cannot break out of the attribute', () => {
    expect(literalJsxAttributesToHtml('<Card title={"a\\" onclick=\\"x"}>', isComponent)).toBe('<Card title="a&quot; onclick=&quot;x">');
    expect(literalJsxAttributesToHtml('<Card title={"<script>"}>', isComponent)).toBe('<Card title="&lt;script&gt;">');
  });

  it('drops a false HTML boolean attribute instead of writing one that reads as true', () => {
    expect(literalJsxAttributesToHtml('<ParamField query="a" required={false}>', isComponent)).toBe('<ParamField query="a">');
    expect(literalJsxAttributesToHtml('<Badge disabled={false}>x</Badge>', isComponent)).toBe('<Badge>x</Badge>');
  });

  it('keeps code, unknown tags and non-literal expressions exactly as authored', () => {
    const untouched = [
      '<CardGroup cols={columns}>',
      '<Chart data={3}>',
      '<CardGroup cols={{ a: 1 }}>',
      '`<CardGroup cols={3}>`',
      '```mdx\n<CardGroup cols={3}>\n```',
      '  ```mdx\n  <Columns cols={2}>\n  ```',
    ];
    for (const source of untouched) expect(literalJsxAttributesToHtml(source, isComponent)).toBe(source);
  });

  it('rewrites tags that span several lines', () => {
    expect(literalJsxAttributesToHtml('<Columns\n  cols={2}\n>', isComponent)).toBe('<Columns\n  cols="2"\n>');
  });
});
