import { describe, expect, it } from 'vitest';
import { mdxLineRoles, tokenizeMdx } from './mdx-tokens';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

const COMPONENTS: ReadonlySet<string> = new Set(['note']);
/** Every callout is read in the reader's form: one overrun fence, then n callouts in its code. */
const reshaped = (n: number) => `1. >~~~md\n   > x\n   > ~~~\n${'\n<Note>After</Note>\n'.repeat(n)}`;
/** Each repeat opens an overrun fence main closes on the next opener, with a candidate callout. */
const repeated = (n: number) => '1. >~~~md\n   > x\n   > ~~~\n\n<Note>After</Note>\n\n'.repeat(n);
/** One overrun fence, then n candidate callouts, each inside a multiline MDX comment (#917 review). */
const commented = (n: number) => `1. >~~~md\n   > x\n   > ~~~\n${'\n{/*\n\n<Note>After</Note>\n\n*/}\n'.repeat(n)}`;

describe.runIf(growthTestsEnabled)('reader-form callouts (#591): growth', () => {
  it.each([
    ['many callouts after one overrun fence', reshaped, 2000],
    ['many overrun fences with callouts', repeated, 1000],
    ['many callouts inside MDX comments', commented, 1000],
  ] as const)('tokenizes %s in linear time', (_name, build, n) => {
    const [small, large] = growthMs((source: string) => tokenizeMdx(source, COMPONENTS), build(n), build(4 * n), { minMs: 20 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    const [rolesSmall, rolesLarge] = growthMs((source: string) => mdxLineRoles(source, COMPONENTS), build(n), build(4 * n), { minMs: 20 });
    expect(rolesLarge).toBeLessThanOrEqual(linearGrowthLimit(rolesSmall));
  });

  it('reads every callout after the overrun fence in the reader form', () => {
    expect(tokenizeMdx(reshaped(3), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(3);
  });

  it('keeps every callout inside an MDX comment as code', () => {
    expect(tokenizeMdx(commented(3), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(0);
  });
});
