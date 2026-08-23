import { describe, expect, it } from 'vitest';
import { normalizeMdxBlocks, normalizeType } from './mdx-config';

describe('normalizeType', () => {
  it('maps the GitHub caution keyword to danger', () => {
    expect(normalizeType('caution')).toBe('danger');
  });
  it('maps important to info, case-insensitively', () => {
    expect(normalizeType('IMPORTANT')).toBe('info');
  });
  it('passes known types through', () => {
    expect(normalizeType('warning')).toBe('warning');
    expect(normalizeType('tip')).toBe('tip');
  });
  it('defaults unknown or missing values to note', () => {
    expect(normalizeType('zzz')).toBe('note');
    expect(normalizeType(undefined)).toBe('note');
  });
});

describe('normalizeMdxBlocks', () => {
  it('inserts blank lines around an opening/closing block tag with adjacent content', () => {
    expect(normalizeMdxBlocks('<Note>\ntext\n</Note>')).toBe('<Note>\n\ntext\n\n</Note>');
    expect(normalizeMdxBlocks('<Callout type="tip">\n**text**\n</Callout>')).toBe('<Callout type="tip">\n\n**text**\n\n</Callout>');
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
