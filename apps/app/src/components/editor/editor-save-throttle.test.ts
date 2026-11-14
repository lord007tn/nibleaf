import { describe, expect, it } from 'vitest';
import { createSaveThrottle, nextSaveAt, SAVE_PACING } from './editor-save-throttle';

/** A clock the test moves by hand, with the timers it holds. */
function manualClock() {
  let now = 0;
  let timers: Array<{ at: number; run: () => void; id: number }> = [];
  let ids = 0;
  return {
    clock: {
      now: () => now,
      setTimer: (run: () => void, ms: number) => {
        ids += 1;
        timers.push({ at: now + ms, run, id: ids });
        return ids;
      },
      clearTimer: (id: unknown) => {
        timers = timers.filter((timer) => timer.id !== id);
      },
    },
    /** Move time forward `ms`, running each timer that falls due, in order. */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((timer) => timer !== next);
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

function setup(run: (draft: string) => unknown = () => undefined) {
  const time = manualClock();
  const saves: Array<{ at: number; draft: string }> = [];
  const throttle = createSaveThrottle<string>(
    (draft) => {
      saves.push({ at: time.clock.now(), draft });
      return run(draft);
    },
    Object.is,
    SAVE_PACING,
    time.clock,
  );
  return { time, saves, throttle };
}

describe('nextSaveAt', () => {
  it.each([
    ['first change, no save yet: after the pause', { firstChangeAt: 0, lastChangeAt: 0, lastSaveAt: undefined }, 700],
    ['soon after a save: the rest of the interval', { firstChangeAt: 1000, lastChangeAt: 1000, lastSaveAt: 700 }, 3700],
    ['long after a save: after the pause', { firstChangeAt: 9000, lastChangeAt: 9000, lastSaveAt: 700 }, 9700],
    ['typing for 10 s without a pause: the maximum wait', { firstChangeAt: 0, lastChangeAt: 9900, lastSaveAt: undefined }, 10_000],
  ])('%s', (_name, state, due) => {
    expect(nextSaveAt(state, SAVE_PACING)).toBe(due);
  });
});

describe('createSaveThrottle', () => {
  /** One draft per keystroke, `every` ms apart. */
  const type = (setupResult: ReturnType<typeof setup>, count: number, every: number) => {
    for (let index = 1; index <= count; index += 1) {
      setupResult.throttle.maybeExecute('x'.repeat(index));
      setupResult.time.advance(every);
    }
  };

  it('one character a second for 12 s: saves at 0.7, 3.7, 6.7, 9.7 and 12.7 s (5; was 12)', () => {
    const result = setup();
    type(result, 12, 1000);
    result.time.advance(20_000);
    expect(result.saves.map((save) => save.at)).toEqual([700, 3700, 6700, 9700, 12_700]);
    expect(result.saves.at(-1)?.draft).toBe('x'.repeat(12));
  });

  it('a burst of 60 characters 50 ms apart: one save, after the burst', () => {
    const result = setup();
    type(result, 60, 50);
    result.time.advance(20_000);
    expect(result.saves.map((save) => save.at)).toEqual([3650]);
  });

  it('typing 200 ms apart for 25 s: a save every 10 s, then one after it stops', () => {
    const result = setup();
    type(result, 125, 200);
    result.time.advance(20_000);
    // The keystroke at 10 s comes after that save, and starts the next 10 s.
    expect(result.saves.map((save) => save.at)).toEqual([10_000, 20_000, 25_500]);
  });

  it('flush saves a pending draft at once, inside the interval; with nothing pending it does nothing', () => {
    const result = setup();
    result.throttle.maybeExecute('a');
    result.time.advance(700);
    result.throttle.maybeExecute('ab');
    result.time.advance(100);
    result.throttle.flush();
    result.throttle.flush();
    expect(result.saves).toEqual([
      { at: 700, draft: 'a' },
      { at: 800, draft: 'ab' },
    ]);
    result.time.advance(20_000);
    expect(result.saves).toHaveLength(2);
  });

  it('cancel drops the pending draft', () => {
    const result = setup();
    result.throttle.maybeExecute('a');
    result.throttle.cancel();
    result.time.advance(20_000);
    expect(result.saves).toEqual([]);
  });

  it('the same draft sent again does not push its save back', () => {
    const result = setup();
    result.throttle.maybeExecute('a');
    result.time.advance(500);
    result.throttle.maybeExecute('a');
    result.time.advance(200);
    expect(result.saves).toEqual([{ at: 700, draft: 'a' }]);
  });

  it('a save that fails does not hold back the next one', async () => {
    const result = setup(() => Promise.reject(new Error('offline')));
    result.throttle.maybeExecute('a');
    result.time.advance(700);
    await Promise.resolve();
    result.throttle.maybeExecute('ab');
    result.time.advance(700);
    expect(result.saves.map((save) => save.at)).toEqual([700, 1400]);
  });
});
