/**
 * Timing bounds for tests, calibrated against the same work on the same runner.
 *
 * A fixed wall-clock deadline, or a ratio against a different kind of work,
 * fails whenever a busy CI runner or a garbage collection lands on one side. So
 * the same function is timed on a small input and on a 4x larger one of the
 * same shape: medians of three, in alternating order after a warmup, so GC and
 * JIT state are shared. Linear work grows about 4x; quadratic work 16x.
 *
 * Each measurement repeats the function enough times that the small input's
 * median takes at least `minMs`, which is checked on the samples actually used:
 * with the 20 ms of slack below, quadratic growth only shows once the small
 * median exceeds 2.5 ms (16t > 8t + 20), and linear growth against the constant
 * bound once it exceeds 10 ms (4t > 2t + 20). When the samples come in under
 * `minMs` (the work got faster once warm), the repeats double and the samples are
 * taken again, up to six times; after that the measurement throws rather than
 * return a pair that can't tell growth apart.
 *
 * `vary(input, rep)` gives each call a fresh but equivalent input (append a
 * trailing comment, say), for work behind a cache or memo; `rep` is unique
 * across the whole measurement. Keep it O(1): it runs inside the timed loop.
 */
export interface GrowthOptions<T> {
  minMs?: number;
  vary?: (input: T, rep: number) => T;
}

const UNREACHABLE = Symbol('unreachable');
const MAX_ATTEMPTS = 6;
const MAX_REPEAT = 1 << 24;

export const growthMs = <T>(run: (input: T) => unknown, small: T, large: T, { minMs = 4, vary }: GrowthOptions<T> = {}): [number, number] => {
  let repeat = 1;
  let rep = 0;
  // Every result is kept and read below, so the engine can never drop a timed call as unused.
  let sink: unknown;
  const time = (input: T) => {
    const started = performance.now();
    for (let index = 0; index < repeat; index += 1) {
      rep += 1;
      sink = run(vary ? vary(input, rep) : input);
    }
    return performance.now() - started;
  };
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
  // Warm both inputs first, so the repeat count is sized on warm (JIT-compiled) runs.
  time(small);
  time(large);
  while (time(small) < minMs && repeat < MAX_REPEAT) repeat *= 2;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    time(large);
    const times: [number[], number[]] = [[], []];
    for (let round = 0; round < 3; round += 1) {
      if (round % 2 === 0) {
        times[0].push(time(small));
        times[1].push(time(large));
      } else {
        times[1].push(time(large));
        times[0].push(time(small));
      }
    }
    if (sink === UNREACHABLE) throw new Error('unreachable');
    const result: [number, number] = [median(times[0]), median(times[1])];
    if (result[0] >= minMs) return result;
    repeat = Math.min(repeat * 2, MAX_REPEAT);
  }
  throw new Error(`growthMs calibration failed: the small input stayed under ${minMs} ms after ${MAX_ATTEMPTS} attempts at up to ${repeat} repeats`);
};

/** The most a 4x larger input may cost when the work is linear: 8x, plus 20 ms
 *  of timer and scheduling noise. Quadratic work (16x) fails it. */
export const linearGrowthLimit = (smallMs: number): number => 8 * smallMs + 20;

/** The most a 4x larger input may cost when the work must not depend on input
 *  size at all (a length check, a sampled window, an output cap): 2x, plus 20 ms.
 *  Linear work (4x) fails it; measure with `minMs: 12` so the small side is long
 *  enough for that (4t > 2t + 20 once t > 10). */
export const constantGrowthLimit = (smallMs: number): number => 2 * smallMs + 20;
