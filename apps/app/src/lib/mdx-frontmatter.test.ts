import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { describe, expect, it } from 'vitest';

/** Exercise the actual parser binding used by the build's MDX plugin. */
function frontmatter(type: 'yaml' | 'toml', value: string) {
  const tree = { type: 'root', children: [{ type, value }] };
  const transform = remarkMdxFrontmatter.call({} as never, { name: 'frontmatter' });
  if (typeof transform !== 'function') throw new Error('Expected the MDX frontmatter transformer');
  transform(tree as never, {} as never, () => undefined);
  return tree;
}

describe('MDX frontmatter parser compatibility', () => {
  it.each([
    ['yaml', 'title: Documentation\ndraft: false\n'],
    ['toml', 'title = "Documentation"\ndraft = false\n'],
  ] as const)('preserves %s frontmatter exports', (type, value) => {
    const output = JSON.stringify(frontmatter(type, value));
    expect(output).toContain('ExportNamedDeclaration');
    expect(output).toContain('frontmatter');
    expect(output).toContain('Documentation');
    expect(output).toContain('"value":false');
  });

  it('rejects deeply nested TOML with a bounded parser error', () => {
    let error: unknown;
    try {
      frontmatter('toml', `value = ${'['.repeat(3000)}1${']'.repeat(3000)}`);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
  });

  it('rejects scalar traversal without modifying Object.prototype', () => {
    const key = 'nibleafTomlRegression';
    expect(Object.hasOwn(Object.prototype, key)).toBe(false);
    try {
      expect(() => frontmatter('toml', `[a.b]\ny = 1\n[a.b.y.__proto__.__proto__]\n${key} = "unexpected"`)).toThrow();
      expect(Object.hasOwn(Object.prototype, key)).toBe(false);
    } finally {
      // Restore the test process even if a future vulnerable version regresses.
      Reflect.deleteProperty(Object.prototype, key);
    }
  });
});
