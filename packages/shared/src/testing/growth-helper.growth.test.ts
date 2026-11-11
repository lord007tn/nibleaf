import { describe, expect, it } from 'vitest';
import { constantGrowthLimit, growthMs, growthMsAsync, growthTestsEnabled, linearGrowthLimit } from './growth';

/** Work proportional to the input's length. */
const linear = (input: string) => {
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) sum += input.charCodeAt(index);
  return sum;
};
/** Work proportional to the square of the input's length. */
const quadratic = (input: string) => {
  let sum = 0;
  for (let outer = 0; outer < input.length; outer += 1) for (let inner = outer; inner < input.length; inner += 1) sum += input.charCodeAt(inner);
  return sum;
};
/** Work that ignores the input's length. */
const constant = (input: string) => input.charCodeAt(0);

// The bounds have to catch what they are for, on this runner, or every test
// using them could pass a regression. Margins are wide (minMs) so these never flake.
describe.runIf(growthTestsEnabled)('growth bounds', () => {
  it('pass linear work and fail quadratic work', () => {
    const [linearSmall, linearLarge] = growthMs(linear, 'a'.repeat(50_000), 'a'.repeat(200_000));
    expect(linearLarge).toBeLessThanOrEqual(linearGrowthLimit(linearSmall));
    const [quadraticSmall, quadraticLarge] = growthMs(quadratic, 'a'.repeat(400), 'a'.repeat(1600), { minMs: 10 });
    expect(quadraticLarge).toBeGreaterThan(linearGrowthLimit(quadraticSmall));
  });

  it('pass constant work and fail linear work against the constant bound', () => {
    // Near-free work (a length check) takes about a million calls to fill 12 ms; it still gets there.
    const [constantSmall, constantLarge] = growthMs(constant, 'a'.repeat(50_000), 'a'.repeat(200_000), { minMs: 12 });
    expect(constantSmall).toBeGreaterThanOrEqual(12);
    expect(constantLarge).toBeLessThanOrEqual(constantGrowthLimit(constantSmall));
    const [linearSmall, linearLarge] = growthMs(linear, 'a'.repeat(50_000), 'a'.repeat(200_000), { minMs: 30 });
    expect(linearLarge).toBeGreaterThan(constantGrowthLimit(linearSmall));
  });
});

/** Busy work for about `ms` milliseconds. */
const spin = (ms: number) => {
  const until = performance.now() + ms;
  let turns = 0;
  while (performance.now() < until) turns += 1;
  return turns;
};

describe.runIf(growthTestsEnabled)('growth calibration', () => {
  it('re-measures when the work speeds up after calibration, so the small median it returns is at least minMs', () => {
    // Slow on its first calls (sizing the repeats on them), then 20x faster: the
    // samples taken after calibration would come in well under minMs.
    let calls = 0;
    const speedsUp = (input: string) => {
      calls += 1;
      return spin(calls <= 6 ? 6 : 0.3) + input.length;
    };
    const [small, large] = growthMs(speedsUp, 'a', 'aaaa', { minMs: 4 });
    expect(small).toBeGreaterThanOrEqual(4);
    expect(large).toBeGreaterThan(0);
  });

  it('holds the same guarantee for async work', async () => {
    let calls = 0;
    const speedsUp = async (input: string) => {
      calls += 1;
      return spin(calls <= 6 ? 6 : 0.3) + input.length;
    };
    const [small] = await growthMsAsync(speedsUp, 'a', 'aaaa', { minMs: 4 });
    expect(small).toBeGreaterThanOrEqual(4);
    let vanishingCalls = 0;
    const vanishes = async (input: string) => {
      vanishingCalls += 1;
      return vanishingCalls <= 6 ? spin(6) : input.length;
    };
    await expect(growthMsAsync(vanishes, 'a', 'aaaa', { minMs: 4, budgetMs: 30 })).rejects.toThrow(/calibration failed/);
  });

  it('throws instead of returning a pair that cannot tell growth apart', () => {
    // Slow while the repeats are sized, then almost free, with too little time to
    // fill minMs again: it gives up within its budget rather than return.
    let calls = 0;
    const vanishes = (input: string) => {
      calls += 1;
      return calls <= 6 ? spin(6) : input.length;
    };
    expect(() => growthMs(vanishes, 'a', 'aaaa', { minMs: 4, budgetMs: 30 })).toThrow(/calibration failed/);
  });

  it('gives every call a fresh input when asked, with a counter unique across the measurement', () => {
    const seen = new Set<string>();
    growthMs<string>(
      (input) => {
        seen.add(input);
        return spin(0.05);
      },
      'small',
      'large',
      { minMs: 1, vary: (input, rep) => `${input} ${rep}` },
    );
    // Every call saw a different input: none was a repeat a cache could answer.
    expect(seen.size).toBeGreaterThan(50);
    expect([...seen].every((input) => /^(small|large) \d+$/.test(input))).toBe(true);
  });
});
