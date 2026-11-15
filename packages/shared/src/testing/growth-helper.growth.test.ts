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

  // The setting the editor's longest rows use (one large call of tens of ms):
  // spreading a pause over more calls and samples must not let quadratic work by.
  // Five samples of four large calls, for two measurements, run past Vitest's 5 s
  // default on a loaded CI runner (6.4 s seen on #695's merge run); each
  // measurement may take its 20 s budget, so the test gets room for both (#658).
  it('pass linear work and fail quadratic work with four large calls per sample and medians of five', () => {
    const options = { samples: 5, largeRuns: 4, budgetMs: 20_000 };
    const [linearSmall, linearLarge] = growthMs(linear, 'a'.repeat(50_000), 'a'.repeat(200_000), options);
    expect(linearLarge).toBeLessThanOrEqual(linearGrowthLimit(linearSmall));
    // About 4 ms a call on the small input: the regime where the default leaves one large call per sample.
    const [quadraticSmall, quadraticLarge] = growthMs(quadratic, 'a'.repeat(3000), 'a'.repeat(12_000), options);
    expect(quadraticLarge).toBeGreaterThan(linearGrowthLimit(quadraticSmall));
  }, 60_000);
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

  it('runs the large input a quarter as often and scales its time back up, so both samples last about as long', async () => {
    const calls = { small: 0, large: 0 };
    const work = (input: string) => {
      calls[input.length === 1 ? 'small' : 'large'] += 1;
      return spin(0.05 * input.length);
    };
    const check = ([small, large]: [number, number]) => {
      expect(calls.large).toBeLessThan(calls.small / 2);
      // Four times the work per call still reads as about four times the time.
      expect(large / small).toBeGreaterThan(3);
      expect(large / small).toBeLessThan(5.5);
    };
    check(growthMs(work, 'a', 'aaaa'));
    calls.small = 0;
    calls.large = 0;
    check(await growthMsAsync(async (input: string) => work(input), 'a', 'aaaa'));
  });

  it('runs the large input largeRuns times in every sample, and takes the median of samples', async () => {
    const calls = { small: 0, large: 0 };
    // Each small call alone fills minMs, which would leave the large side one call per sample.
    const work = (input: string) => {
      calls[input.length === 1 ? 'small' : 'large'] += 1;
      return spin(5 * input.length);
    };
    growthMs(work, 'a', 'aaaa', { samples: 5, largeRuns: 4 });
    // Two warmups and five samples, four large calls each, and sixteen small calls a sample.
    expect(calls.large).toBe(4 * 7);
    expect(calls.small).toBe(16 * 7);
    calls.small = 0;
    calls.large = 0;
    await growthMsAsync(async (input: string) => work(input), 'a', 'aaaa', { samples: 5, largeRuns: 4 });
    expect(calls.large).toBe(4 * 7);
    expect(() => growthMs(work, 'a', 'aaaa', { samples: 4 })).toThrow(/odd integer/);
    expect(() => growthMs(work, 'a', 'aaaa', { largeRuns: 0 })).toThrow(/positive integer/);
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
