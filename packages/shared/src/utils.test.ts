import { describe, expect, it } from 'vitest';
import { excerpt, joinPath, plural, slugify } from './utils';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Getting Started!')).toBe('getting-started');
    expect(slugify('  Hello   World  ')).toBe('hello-world');
  });
  it('trims leading/trailing dashes and handles empty results', () => {
    expect(slugify('--Foo--')).toBe('foo');
    expect(slugify('@@@')).toBe('');
  });
});

describe('joinPath', () => {
  it('returns the slug when there is no parent', () => {
    expect(joinPath(null, 'intro')).toBe('intro');
    expect(joinPath('', 'intro')).toBe('intro');
    expect(joinPath(undefined, 'intro')).toBe('intro');
  });
  it('joins parent and slug, trimming surrounding slashes', () => {
    expect(joinPath('guides', 'intro')).toBe('guides/intro');
    expect(joinPath('/guides/', 'intro')).toBe('guides/intro');
  });
});

describe('excerpt', () => {
  it('strips fenced code, links, and markdown punctuation', () => {
    const md = '# Title\n\nSee [the docs](https://x) for `code`.\n\n```js\nconst a = 1;\n```';
    const out = excerpt(md);
    expect(out).not.toContain('```');
    expect(out).not.toContain('const a = 1');
    expect(out).toContain('the docs');
    expect(out).not.toContain('https://x');
  });
  it('truncates past the max with an ellipsis', () => {
    const out = excerpt('a '.repeat(200), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('plural', () => {
  it('omits the suffix only for a count of one', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(2, 'page')).toBe('2 pages');
    expect(plural(0, 'site')).toBe('0 sites');
  });
});
