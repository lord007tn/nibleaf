import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('council: the 120-row timing harness enforces a regression budget inside each measured expansion', () => {
  // The harness runs on demand (`bench:page-tree`), outside the unit suite, so a loaded CI run can't flake it.
  const harness = readFileSync(new URL('./page-tree-performance.bench.tsx', import.meta.url), 'utf8');
  expect(harness).toMatch(/expect\(elapsed\)\.toBeLessThan\(1500\)/);
  const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  expect(manifest.scripts['bench:page-tree']).toContain('vitest.bench.config.ts');
});
