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
});
