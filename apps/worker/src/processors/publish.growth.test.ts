import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { collectPublishIssues, page, snapshot } from './publish-links.test-helpers';

const site = (content: string) => snapshot([page({ path: 'guide', content })], { addons: { grammarLinter: true } });

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
// The publish gate's copy checks read each page in time linear in its length:
// about 4x for 4x the input.
describe.runIf(growthTestsEnabled)('collectPublishIssues: growth', () => {
  it.each([
    ['case A', (n: number) => '<pre a'.repeat(n)],
    ['case B', (n: number) => '<code a'.repeat(n)],
  ] as const)(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs((text: string) => collectPublishIssues(site(text)), build(4000), build(16_000), {
        vary: (text, rep) => `${text} ${rep}`,
      });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
