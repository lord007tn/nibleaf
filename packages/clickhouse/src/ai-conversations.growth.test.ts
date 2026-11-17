import { constantGrowthLimit, growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { redactReaderText } from './redaction';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('reader text redaction growth', () => {
  it('stays linear inside the 16 KB kept, and costs nothing more past it', () => {
    // Steered model output stays fast: long runs that almost match an email, a
    // phone number or a token stay linear inside the 16 KB kept (4k against 16k
    // characters, testing/growth), and text past it costs nothing more.
    for (const hostile of [
      (n: number) => `${'a'.repeat(n / 2)}@${'b'.repeat(n / 2)}`,
      (n: number) => `+1${' 1'.repeat(n / 2)}x`,
      (n: number) => `${'a1'.repeat(n / 2)}g`,
    ]) {
      const [small, large] = growthMs(redactReaderText, hostile(4000), hostile(16_000));
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
    const [kept, beyond] = growthMs(redactReaderText, 'x'.repeat(1_250_000), 'x'.repeat(5_000_000), { minMs: 12 });
    expect(beyond).toBeLessThanOrEqual(constantGrowthLimit(kept));
  });
});
