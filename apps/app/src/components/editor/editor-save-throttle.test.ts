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

/*
 * P2-ED-005: a keystroke no longer hands over a draft. It says the page changed
 * (`maybeExecuteLazy`), and the draft is read when the save is due or a flush
 * runs. Each schedule below is run twice, once handing over a draft per
 * keystroke (as before) and once lazily, and must save at the same moments with
 * the same drafts, while reading the draft only once per save.
 */
describe('createSaveThrottle: a lazily read draft (P2-ED-005)', () => {
  /** One keystroke per entry of `gaps` (the ms after it), eagerly or lazily. */
  function run(gaps: number[], lazy: boolean, after = 20_000) {
    const result = setup();
    let text = '';
    let reads = 0;
    const read = () => {
      reads += 1;
      return text;
    };
    for (const gap of gaps) {
      text += 'x';
      if (lazy) result.throttle.maybeExecuteLazy(read);
      else result.throttle.maybeExecute(text);
      result.time.advance(gap);
    }
    result.time.advance(after);
    return { saves: result.saves, reads };
  }
  const schedules: Array<[string, number[]]> = [
    ['one character a second for 12 s (idle, minimum interval)', Array(12).fill(1000)],
    ['a burst of 60 characters 50 ms apart', Array(60).fill(50)],
    ['typing 200 ms apart for 25 s (maximum wait)', Array(125).fill(200)],
    ['typing 500 ms apart for 25 s (no pause long enough)', Array(50).fill(500)],
    ['bursts and pauses', [100, 100, 900, 50, 50, 50, 3000, 200, 200, 200, 200, 4000, 10, 10, 700, 699, 701]],
  ];
  it.each(schedules)('%s: the same saves, and one read per save', (_name, gaps) => {
    const eager = run(gaps, false);
    const lazy = run(gaps, true);
    expect(lazy.saves).toEqual(eager.saves);
    expect(lazy.saves.length).toBeGreaterThan(0);
    expect(lazy.reads).toBe(lazy.saves.length);
  });

  it('reads nothing until the save is due; flush reads and saves at once', () => {
    const result = setup();
    let reads = 0;
    result.throttle.maybeExecuteLazy(() => {
      reads += 1;
      return 'a';
    });
    result.time.advance(699);
    expect(reads).toBe(0);
    result.throttle.flush();
    expect(reads).toBe(1);
    expect(result.saves).toEqual([{ at: 699, draft: 'a' }]);
    result.throttle.flush();
    expect(reads).toBe(1);
  });

  it('a read that finds nothing to save saves nothing, and does not count as a save', () => {
    const result = setup();
    result.throttle.maybeExecuteLazy(() => null);
    result.time.advance(700);
    expect(result.saves).toEqual([]);
    // No save at 700, so no minimum interval from it: the next one goes after the pause.
    result.throttle.maybeExecuteLazy(() => 'b');
    result.time.advance(700);
    expect(result.saves).toEqual([{ at: 1400, draft: 'b' }]);
  });

  it('settle: the draft the pending change now reads keeps the save at its time', () => {
    const result = setup();
    result.throttle.maybeExecuteLazy(() => 'a');
    result.time.advance(300);
    result.throttle.settle('a');
    result.time.advance(400);
    expect(result.saves).toEqual([{ at: 700, draft: 'a' }]);
  });

  it('settle with nothing pending is a new change', () => {
    const result = setup();
    result.throttle.settle('a');
    result.time.advance(700);
    expect(result.saves).toEqual([{ at: 700, draft: 'a' }]);
  });

  it('an eager draft while a lazy change is pending: a new change, saved with the lazily read draft', () => {
    const result = setup();
    let text = 'a';
    result.throttle.maybeExecuteLazy(() => text);
    result.time.advance(500);
    // The title changed: a new change, and the save reads the latest draft.
    result.throttle.maybeExecute('stale');
    text = 'ab';
    result.time.advance(699);
    expect(result.saves).toEqual([]);
    result.time.advance(1);
    expect(result.saves).toEqual([{ at: 1200, draft: 'ab' }]);
  });

  it('the same eager draft again while a lazy change is pending keeps its time', () => {
    const result = setup();
    result.throttle.maybeExecute('a');
    result.time.advance(100);
    result.throttle.maybeExecuteLazy(() => 'ab');
    result.time.advance(300);
    // Re-sent unchanged (the page was refetched): not a change.
    result.throttle.maybeExecute('a');
    result.time.advance(400);
    expect(result.saves).toEqual([{ at: 800, draft: 'ab' }]);
  });

  it('cancel drops a lazy change without reading it', () => {
    const result = setup();
    let reads = 0;
    result.throttle.maybeExecuteLazy(() => {
      reads += 1;
      return 'a';
    });
    result.throttle.cancel();
    result.time.advance(20_000);
    expect(reads).toBe(0);
    expect(result.saves).toEqual([]);
  });
});
