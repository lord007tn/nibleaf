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
 * `minMs` (the work got faster once warm), the repeats grow, sized from the
 * shortfall, and the samples are taken again, until the median reaches `minMs`
 * or `budgetMs` of measuring has passed; then the measurement throws rather than
 * return a pair that can't tell growth apart. Near-free work (a length check) may
 * need a million calls per sample; the budget, not a repeat ceiling, is the limit.
 *
 * `vary(input, rep)` gives each call a fresh but equivalent input (append a
 * trailing comment, say), for work behind a cache or memo; `rep` is unique
 * across the whole measurement. Keep it O(1): it runs inside the timed loop.
 */
export interface GrowthOptions<T> {
  minMs?: number;
  /** Wall time the whole measurement may take before it gives up (default 2 s). */
  budgetMs?: number;
  vary?: (input: T, rep: number) => T;
}

/**
 * Growth tests compare timings, so they run on their own, one file at a time
 * (`pnpm test:growth`, vitest `--mode growth`): on a shared CI runner, other test
 * files in parallel workers slow one side of a measurement and not the other.
 * Wrap a growth file's tests in `describe.runIf(growthTestsEnabled)`.
 */
export const growthTestsEnabled = (import.meta as { env?: { MODE?: string } }).env?.MODE === 'growth';

const UNREACHABLE = Symbol('unreachable');
const MAX_REPEAT = 1 << 28;
/** The next repeat count when the small median came in at `smallMs`: enough to clear `minMs` with room. */
const nextRepeat = (repeat: number, smallMs: number, minMs: number): number =>
  Math.min(MAX_REPEAT, Math.max(repeat * 2, Math.ceil((repeat * minMs * 1.5) / Math.max(smallMs, minMs / 1024))));

export const growthMs = <T>(
  run: (input: T) => unknown,
  small: T,
  large: T,
  { minMs = 4, budgetMs = 2000, vary }: GrowthOptions<T> = {},
): [number, number] => {
  const deadline = performance.now() + budgetMs;
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
  for (let first = time(small); first < minMs && repeat < MAX_REPEAT && performance.now() < deadline; first = time(small)) {
    repeat = nextRepeat(repeat, first, minMs);
  }
  for (;;) {
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
    if (performance.now() >= deadline || repeat >= MAX_REPEAT) {
      throw new Error(
        `growthMs calibration failed: the small input stayed under ${minMs} ms (${result[0].toFixed(2)} ms at ${repeat} repeats) within ${budgetMs} ms`,
      );
    }
    repeat = nextRepeat(repeat, result[0], minMs);
  }
};

/** The most a 4x larger input may cost when the work is linear: 8x, plus 20 ms
 *  of timer and scheduling noise. Quadratic work (16x) fails it. */
export const linearGrowthLimit = (smallMs: number): number => 8 * smallMs + 20;

/** The most a 4x larger input may cost when the work must not depend on input
 *  size at all (a length check, a sampled window, an output cap): 2x, plus 20 ms.
 *  Linear work (4x) fails it; measure with `minMs: 12` so the small side is long
 *  enough for that (4t > 2t + 20 once t > 10). */
export const constantGrowthLimit = (smallMs: number): number => 2 * smallMs + 20;
