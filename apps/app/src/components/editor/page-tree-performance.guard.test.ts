import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('council: the 120-row timing harness enforces a regression budget inside each measured expansion', () => {
  const harness = readFileSync(new URL('./page-tree-performance.test.tsx', import.meta.url), 'utf8');
  expect(harness).toMatch(/expect\(elapsed\)\.toBeLessThan\(1_500\)/);
});
