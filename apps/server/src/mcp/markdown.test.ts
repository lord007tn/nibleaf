import { describe, expect, it } from 'vitest';
import { MAX_MCP_MARKDOWN_BYTES, normalizeMcpLine, normalizeMcpMarkdown, prepareMcpMarkdown } from './markdown';

describe('MCP Markdown normalization', () => {
  it('uses LF line endings and drops NUL and other C0 controls except tab and newline', () => {
    expect(normalizeMcpMarkdown('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    expect(normalizeMcpMarkdown('x\u0000y\u0007z\u001b[31m\u000b\u000c\tend')).toBe('xyz[31m\tend');
    expect(normalizeMcpMarkdown('مرحبا 👋 <Note>hi</Note>')).toBe('مرحبا 👋 <Note>hi</Note>');
  });

  it('collapses single-line fields', () => {
    expect(normalizeMcpLine('  Billing\r\n  FAQ\t\u0000 ')).toBe('Billing FAQ');
  });

  it('splits frontmatter with the Git sync parser and caps its fields like the importer', () => {
    const prepared = prepareMcpMarkdown(
      `---\r\ntitle: "${'T'.repeat(250)}"\r\ndescription: 'Short'\r\nicon: book\r\nhidden: true\r\n---\r\n\r\n# Body\r\n`,
    );
    expect(prepared).toEqual({ body: '\n# Body\n', title: 'T'.repeat(200), description: 'Short', icon: 'book' });
    expect(prepareMcpMarkdown('---\nsidebarTitle: Nav name\n---\nBody').title).toBe('Nav name');
    expect(prepareMcpMarkdown('# No frontmatter')).toEqual({ body: '# No frontmatter', title: undefined, description: undefined, icon: undefined });
  });

  it('enforces the byte cap after normalization', () => {
    expect(() => prepareMcpMarkdown('a'.repeat(MAX_MCP_MARKDOWN_BYTES))).not.toThrow();
    expect(() => prepareMcpMarkdown(`${'a'.repeat(MAX_MCP_MARKDOWN_BYTES)}\r\n`)).toThrow(/larger than 128 KiB/);
    // CRLF → LF shrinks the document, so a CRLF file at the cap is accepted.
    expect(() => prepareMcpMarkdown(`${'a'.repeat(MAX_MCP_MARKDOWN_BYTES - 1)}\r\n`)).not.toThrow();
    expect(() => prepareMcpMarkdown('é'.repeat(MAX_MCP_MARKDOWN_BYTES / 2 + 1))).toThrow(/larger than/);
  });
});
