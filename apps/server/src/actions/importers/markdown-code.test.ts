import { describe, expect, it } from 'vitest';
import { closesMarkdownFence, openingMarkdownFence, protectMarkdownCode } from './markdown-code';

describe('import Markdown code boundaries', () => {
  it.each([
    '````mdx\r\n<img src="literal" />\r\n```\r\n~~~~\r\n`````\r\n',
    '~~~mdx\n![Example](literal)\n~~\n~~~\n',
    '```mdx\n<img src="literal" />',
  ])('preserves exact fenced source and only transforms prose', (literal) => {
    const input = `before\n${literal}`;
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).not.toContain('literal');
    expect(protectedCode.restore(protectedCode.content.replace('before', 'after'))).toBe(`after\n${literal}`);
  });

  it('resumes prose after a matching close and preserves variable-length multiline inline code', () => {
    const literal = '``<img src="literal" />\n`nested` ``';
    const input = `~~~\ncode\n~~~\n${literal}\n![Real](real)`;
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).not.toContain('literal');
    expect(protectedCode.restore(protectedCode.content.replace('(real)', '(hosted)'))).toBe(input.replace('(real)', '(hosted)'));
  });

  it('leaves unmatched and escaped inline delimiters as prose', () => {
    const input = '\\`escaped and `unmatched';
    const protectedCode = protectMarkdownCode(input);
    expect(protectedCode.content).toBe(input);
    expect(protectedCode.restore(protectedCode.content)).toBe(input);
  });

  it('shares matching rules with the MDX normalizer', () => {
    expect(openingMarkdownFence('```bad`info')).toBeUndefined();
    expect(openingMarkdownFence('    ```')).toBeUndefined();
    expect(openingMarkdownFence('    ```', Number.POSITIVE_INFINITY)).toEqual({ marker: '`', length: 3 });
    const fence = { marker: '`', length: 4 };
    expect(closesMarkdownFence('~~~', fence)).toBe(false);
    expect(closesMarkdownFence('```', fence)).toBe(false);
    expect(closesMarkdownFence('`````', fence)).toBe(true);
  });
});
