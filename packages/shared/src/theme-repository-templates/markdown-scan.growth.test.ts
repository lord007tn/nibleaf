import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '../testing/growth';
import { markdownScanTemplate } from './markdown-scan';

type Scan = Record<
  'inlineCodeRanges' | 'expandSelfClosingComponents' | 'stripMarkdownLinks' | 'headingParts' | 'fenceParts' | 'frontmatterEntry' | 'trimSlashes',
  (text: string) => unknown
>;

const SEPARATOR = String.fromCharCode(0x20_28);

// Timing bounds, run on their own (pnpm test:growth; see ../testing/growth), on
// the generated src/lib/markdown-scan.ts itself. Linear work measures about 4x
// for 4x the input; quadratic work, 16x.
describe.runIf(growthTestsEnabled)('generated src/lib/markdown-scan.ts: growth', () => {
  const root = resolve(import.meta.dirname, '../../.cache', `markdown-scan-growth-${process.pid}`);
  let scan: Scan;
  beforeAll(async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'markdown-scan.ts'), markdownScanTemplate());
    scan = (await import(/* @vite-ignore */ join(root, 'markdown-scan.ts'))) as Scan;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    [
      'case A',
      'inlineCodeRanges',
      (size: number) => Array.from({ length: 100 * Math.sqrt(size) }, (_, index) => `${'`'.repeat(index + 1)}a`).join(''),
    ],
    ['case B', 'expandSelfClosingComponents', (size: number) => '<File a'.repeat(4000 * size)],
    ['case C', 'stripMarkdownLinks', (size: number) => '[a'.repeat(4000 * size)],
    ['case D', 'headingParts', (size: number) => `## a${' '.repeat(1000 * size)}x`],
    ['case E', 'fenceParts', (size: number) => `${'`'.repeat(4000 * size)}${SEPARATOR}x`],
    ['case F', 'frontmatterEntry', (size: number) => `title: ${' '.repeat(4000 * size)}a${SEPARATOR}b`],
    ['case G', 'trimSlashes', (size: number) => `a${'/'.repeat(4000 * size)}b`],
  ] as const)(
    'stays linear on %s (%s)',
    (_label, name, build) => {
      const [small, large] = growthMs((text: string) => scan[name](text), build(1), build(4), {
        vary: (text, rep) => `${text}${rep % 2 ? ' ' : ''}`,
      });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
