/**
 * Timing bounds for tests, calibrated against the same work on the same runner.
 *
 * A fixed wall-clock deadline, or a ratio against a different kind of work,
 * fails whenever a busy CI runner or a garbage collection lands on one side. So
 * the same function is timed on a small input and on a 4x larger one of the
 * same shape: medians of three, in alternating order after a warmup, so GC and
 * JIT state are shared. Linear work grows about 4x; quadratic work 16x.
 *
 * After one warm run of each input, each measurement repeats the function until
 * the small input takes at least `minMs`, doubling the count as needed, so fast functions still measure enough
 * time for the bound to mean something on any machine: with the 20 ms of slack
 * below, quadratic growth only shows once the small measurement exceeds 2.5 ms
 * (16t > 8t + 20), and linear growth against the constant bound once it exceeds
 * 10 ms (4t > 2t + 20).
 */
const UNREACHABLE = Symbol('unreachable');

export const growthMs = <T>(run: (input: T) => unknown, small: T, large: T, { minMs = 4 }: { minMs?: number } = {}): [number, number] => {
  let repeat = 1;
  // Every result is kept and read below, so the engine can never drop a timed call as unused.
  let sink: unknown;
  const time = (input: T) => {
    const started = performance.now();
    for (let index = 0; index < repeat; index += 1) sink = run(input);
    return performance.now() - started;
  };
  // Warm both inputs first, so the repeat count is sized on warm (JIT-compiled) runs.
  time(small);
  time(large);
  while (time(small) < minMs && repeat < 1 << 24) repeat *= 2;
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
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
  return [median(times[0]), median(times[1])];
};

/** The most a 4x larger input may cost when the work is linear: 8x, plus 20 ms
 *  of timer and scheduling noise. Quadratic work (16x) fails it. */
export const linearGrowthLimit = (smallMs: number): number => 8 * smallMs + 20;

/** The most a 4x larger input may cost when the work must not depend on input
 *  size at all (a length check, a sampled window, an output cap): 2x, plus 20 ms.
 *  Linear work (4x) fails it; measure with `minMs: 12` so the small side is long
 *  enough for that (4t > 2t + 20 once t > 10). */
export const constantGrowthLimit = (smallMs: number): number => 2 * smallMs + 20;
