import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { themeRepositoryReaderTemplateFiles } from '@nibleaf/shared/theme-repository-templates';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SEPARATOR = String.fromCharCode(0x20_28);

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth),
// on the generated src/lib/markdown.tsx itself, written under apps/app (where its
// npm dependencies resolve) in a gitignored cache folder. Linear work measures
// about 4x for 4x the input.
describe.runIf(growthTestsEnabled)('exported theme repository normalizeMarkdown: growth', () => {
  const root = resolve(import.meta.dirname, '../../.cache', `theme-template-growth-${process.pid}`);
  let normalizeMarkdown: (source: string) => string;
  beforeAll(async () => {
    for (const file of [
      ...themeRepositoryReaderTemplateFiles(),
      { path: 'src/lib/site.ts', content: 'export const uniqueHeadingId = (text: string): string => text;\n' },
      {
        path: 'src/paraglide/messages.js',
        content: "export const fieldRequired = () => '';\nexport const fieldDeprecated = () => '';\nexport const fieldDefault = () => '';\n",
      },
    ]) {
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    ({ normalizeMarkdown } = (await import(/* @vite-ignore */ join(root, 'src/lib/markdown.tsx'))) as {
      normalizeMarkdown: (source: string) => string;
    });
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ['case A', (size: number) => `${'`'.repeat(4000 * size)}${SEPARATOR}x`],
    ['case B', (size: number) => `> ${'`'.repeat(4000 * size)}${SEPARATOR}x\n\ntext`],
  ] as const)(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs((source: string) => normalizeMarkdown(source), build(1), build(4), {
        vary: (source, rep) => `${source}${rep % 2 ? ' ' : ''}`,
      });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
