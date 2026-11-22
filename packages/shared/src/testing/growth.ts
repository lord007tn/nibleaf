/**
 * Timing bounds for tests, calibrated against the same work on the same runner.
 *
 * A fixed wall-clock deadline, or a ratio against a different kind of work,
 * fails whenever a busy CI runner or a garbage collection lands on one side. So
 * the same function is timed on a small input and on a 4x larger one of the
 * same shape: medians of three, in alternating order after a warmup, so GC and
 * JIT state are shared. Linear work grows about 4x; quadratic work 16x.
 *
 * The large input runs a quarter as many times per sample and its time is scaled
 * back up, so both samples last about as long. On a busy or single-core runner
 * the scheduler takes the CPU away every few tens of milliseconds; a long sample
 * catches more of those pauses than a short one, which reads as growth that
 * isn't there. Samples of equal length catch about the same share.
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
 *
 * When one call of the small input already takes `minMs`, the repeat count stays
 * at 4 and each large sample is a single call, scaled up 4x: a garbage collection
 * or scheduler pause inside that one call counts four times over, and one bad
 * large sample of three is all the median can absorb. Rows whose single calls
 * are that long (a page of thousands of nested components) can ask for
 * `largeRuns` calls of the large input per sample (the small input then runs
 * 4 * largeRuns times) and an odd number of `samples` for the medians. Neither
 * changes what is compared, only how much a single pause weighs.
 */
export interface GrowthOptions<T> {
  minMs?: number;
  /** Wall time the whole measurement may take before it gives up (default 2 s). */
  budgetMs?: number;
  vary?: (input: T, rep: number) => T;
  /** Paired samples behind each median, odd (default 3). */
  samples?: number;
  /** The fewest calls of the large input in each sample (default 1). */
  largeRuns?: number;
  /**
   * How much larger `large` is than `small` (default 4). Pass 8, with an input
   * 8x larger, for rows where n^1.5 work must fail: 4x n^1.5 costs exactly 8x,
   * inside `linearGrowthLimit`, while 8x costs 22.6x against linear's 8x, which
   * `superlinearGrowthLimit` separates (#730). The large input then runs an
   * eighth as often per sample, scaled back up, as with 4.
   */
  factor?: 4 | 8;
}

/** Checks `samples`, `largeRuns` and `factor`, returning the starting repeat count. */
const sampling = (samples: number, largeRuns: number, factor: number): number => {
  if (!Number.isInteger(samples) || samples < 3 || samples % 2 === 0)
    throw new Error(`growth samples must be an odd integer of at least 3, not ${samples}`);
  if (!Number.isInteger(largeRuns) || largeRuns < 1) throw new Error(`growth largeRuns must be a positive integer, not ${largeRuns}`);
  if (factor !== 4 && factor !== 8) throw new Error(`growth factor must be 4 or 8, not ${factor}`);
  // At least `factor`, so the large input can run 1/factor as often (see timeLarge).
  return factor * largeRuns;
};
/** The middle of an odd number of samples. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[(values.length - 1) >> 1] ?? 0;

/** The size of a growth input, for the log line: a string's or array's length, a
 *  Map's or Set's size, or what `{ size }`/`{ length }` reports. */
const sizeOf = (input: unknown): string => {
  if (typeof input === 'string' || Array.isArray(input)) return String(input.length);
  if (input instanceof Map || input instanceof Set) return String(input.size);
  const size = (input as { size?: unknown; length?: unknown } | null)?.size ?? (input as { length?: unknown } | null)?.length;
  return typeof size === 'number' ? String(size) : '?';
};

/** Every measurement logs its sizes, medians, ratio and runs per sample through
 *  console.info, so CI history shows how close each row runs to its bound (the
 *  limit ratio for linearGrowthLimit is 8 + 20 / small). */
const logGrowth = (small: unknown, large: unknown, [smallMs, largeMs]: [number, number], repeat: number, largeRuns: number, factor = 4) => {
  console.info(
    `growth n=${sizeOf(small)} / ${factor}n=${sizeOf(large)}: ${smallMs.toFixed(2)} ms / ${largeMs.toFixed(2)} ms (${(largeMs / smallMs).toFixed(2)}x; ${repeat} / ${largeRuns} runs per sample)`,
  );
};

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
  { minMs = 4, budgetMs = 2000, vary, samples = 3, largeRuns = 1, factor = 4 }: GrowthOptions<T> = {},
): [number, number] => {
  let repeat = sampling(samples, largeRuns, factor);
  const deadline = performance.now() + budgetMs;
  let rep = 0;
  // Every result is kept and read below, so the engine can never drop a timed call as unused.
  let sink: unknown;
  const time = (input: T, count: number) => {
    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      rep += 1;
      sink = run(vary ? vary(input, rep) : input);
    }
    return performance.now() - started;
  };
  const timeSmall = () => time(small, repeat);
  // 1/factor as many runs, scaled back up: see the note at the top.
  const timeLarge = () => {
    const count = Math.max(1, Math.round(repeat / factor));
    return (time(large, count) * repeat) / count;
  };
  // Warm both inputs first, so the repeat count is sized on warm (JIT-compiled) runs.
  timeSmall();
  timeLarge();
  for (let first = timeSmall(); first < minMs && repeat < MAX_REPEAT && performance.now() < deadline; first = timeSmall()) {
    repeat = nextRepeat(repeat, first, minMs);
  }
  for (;;) {
    timeLarge();
    const times: [number[], number[]] = [[], []];
    for (let round = 0; round < samples; round += 1) {
      if (round % 2 === 0) {
        times[0].push(timeSmall());
        times[1].push(timeLarge());
      } else {
        times[1].push(timeLarge());
        times[0].push(timeSmall());
      }
    }
    if (sink === UNREACHABLE) throw new Error('unreachable');
    const result: [number, number] = [median(times[0]), median(times[1])];
    if (result[0] >= minMs) {
      logGrowth(small, large, result, repeat, Math.max(1, Math.round(repeat / factor)), factor);
      return result;
    }
    if (performance.now() >= deadline || repeat >= MAX_REPEAT) {
      throw new Error(
        `growthMs calibration failed: the small input stayed under ${minMs} ms (${result[0].toFixed(2)} ms at ${repeat} repeats) within ${budgetMs} ms`,
      );
    }
    repeat = nextRepeat(repeat, result[0], minMs);
  }
};

/** `growthMs` for async work (index building, a model call through a fake adapter):
 *  the same measurement and guarantees, awaiting each run. */
export const growthMsAsync = async <T>(
  run: (input: T) => Promise<unknown>,
  small: T,
  large: T,
  { minMs = 4, budgetMs = 2000, vary, samples = 3, largeRuns = 1, factor = 4 }: GrowthOptions<T> = {},
): Promise<[number, number]> => {
  let repeat = sampling(samples, largeRuns, factor);
  const deadline = performance.now() + budgetMs;
  let rep = 0;
  let sink: unknown;
  const time = async (input: T, count: number) => {
    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      rep += 1;
      sink = await run(vary ? vary(input, rep) : input);
    }
    return performance.now() - started;
  };
  const timeSmall = () => time(small, repeat);
  // 1/factor as many runs, scaled back up: see the note at the top.
  const timeLarge = async () => {
    const count = Math.max(1, Math.round(repeat / factor));
    return ((await time(large, count)) * repeat) / count;
  };
  await timeSmall();
  await timeLarge();
  for (let first = await timeSmall(); first < minMs && repeat < MAX_REPEAT && performance.now() < deadline; first = await timeSmall()) {
    repeat = nextRepeat(repeat, first, minMs);
  }
  for (;;) {
    await timeLarge();
    const times: [number[], number[]] = [[], []];
    for (let round = 0; round < samples; round += 1) {
      if (round % 2 === 0) {
        times[0].push(await timeSmall());
        times[1].push(await timeLarge());
      } else {
        times[1].push(await timeLarge());
        times[0].push(await timeSmall());
      }
    }
    if (sink === UNREACHABLE) throw new Error('unreachable');
    const result: [number, number] = [median(times[0]), median(times[1])];
    if (result[0] >= minMs) {
      logGrowth(small, large, result, repeat, Math.max(1, Math.round(repeat / factor)), factor);
      return result;
    }
    if (performance.now() >= deadline || repeat >= MAX_REPEAT) {
      throw new Error(
        `growthMsAsync calibration failed: the small input stayed under ${minMs} ms (${result[0].toFixed(2)} ms at ${repeat} repeats) within ${budgetMs} ms`,
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

/** The most an 8x larger input (`factor: 8`) may cost when the work is linear or
 *  n log n: 12x, plus 20 ms. Linear work grows 8x and n log n about 9-10x; n^1.5
 *  grows 22.6x and fails it once the small median passes 2 ms (22.6t > 12t + 20),
 *  which `linearGrowthLimit`'s 4x step cannot catch (#730). */
export const superlinearGrowthLimit = (smallMs: number): number => 12 * smallMs + 20;
