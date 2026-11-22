import { describe, expect, it } from 'vitest';
import { mdxLineRoles, tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { normalizeMdxBlocks } from './reader-markdown';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

const COMPONENTS: ReadonlySet<string> = new Set(['note']);
/** Every callout is read in the reader's form: one overrun fence, then n callouts in its code. */
const reshaped = (n: number) => `1. >~~~md\n   > x\n   > ~~~\n${'\n<Note>After</Note>\n'.repeat(n)}`;
/** Each repeat opens an overrun fence main closes on the next opener, with a candidate callout. */
const repeated = (n: number) => '1. >~~~md\n   > x\n   > ~~~\n\n<Note>After</Note>\n\n'.repeat(n);
/** One overrun fence, then n candidate callouts, each inside a multiline MDX comment (#917 review). */
const commented = (n: number) => `1. >~~~md\n   > x\n   > ~~~\n${'\n{/*\n\n<Note>After</Note>\n\n*/}\n'.repeat(n)}`;
/** One overrun fence, then n candidate callouts inside one math block the reader renders literally (#917 re-check). */
const literal = (n: number) => `1. >~~~md\n   > x\n   > ~~~\n\n$$\n${'\n<Note>After</Note>\n'.repeat(n)}\n$$`;
/** The #917 re-check page, then one long run of a fence marker and a line separator: the fence opener's regex
 *  once retried the whole run at each length, as `.` stops at the separator. */
const RECHECK_PAGE = '1. >~~~md\n   > CODEMARK\n   > ~~~\n\n<Note>ReviewText</Note>\n\n';
const markerRun = (marker: string) => (n: number) => `${RECHECK_PAGE}${marker.repeat(n)}${String.fromCharCode(0x20_28)}x`;
const backticks = markerRun('`');
const tildes = markerRun('~');

describe.runIf(growthTestsEnabled)('reader-form callouts (#591): growth', () => {
  it.each([
    ['many callouts after one overrun fence', reshaped, 2000],
    ['many overrun fences with callouts', repeated, 1000],
    ['many callouts inside MDX comments', commented, 1000],
    ['many callouts inside a math block', literal, 1000],
    ['a long backtick run after the callout', backticks, 16_000],
    ['a long tilde run after the callout', tildes, 16_000],
  ] as const)('tokenizes %s in linear time', (_name, build, n) => {
    const [small, large] = growthMs((source: string) => tokenizeMdx(source, COMPONENTS), build(n), build(4 * n), { minMs: 20 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    const [rolesSmall, rolesLarge] = growthMs((source: string) => mdxLineRoles(source, COMPONENTS), build(n), build(4 * n), { minMs: 20 });
    expect(rolesLarge).toBeLessThanOrEqual(linearGrowthLimit(rolesSmall));
  });

  it.each([
    ['backtick', backticks],
    ['tilde', tildes],
  ] as const)('exports and normalizes a long %s run after the callout in linear time (#917 re-check)', (_name, build) => {
    for (const project of [portablePublicMdxMarkdown, normalizePublicMarkdownContent, normalizeMdxBlocks]) {
      const [small, large] = growthMs(project, build(16_000), build(64_000), { minMs: 20 });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
  });

  it('reads every callout after the overrun fence in the reader form', () => {
    expect(tokenizeMdx(reshaped(3), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(3);
  });

  it('keeps every callout inside an MDX comment as code', () => {
    expect(tokenizeMdx(commented(3), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(0);
  });

  it('keeps every callout inside a math block as code', () => {
    expect(tokenizeMdx(literal(3), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(0);
  });

  it('quotes the callout before a long marker run', () => {
    for (const build of [backticks, tildes]) expect(tokenizeMdx(build(16_000), COMPONENTS).filter((token) => token.kind === 'open')).toHaveLength(1);
  });
});
