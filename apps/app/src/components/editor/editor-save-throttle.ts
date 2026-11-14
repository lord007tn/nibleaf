import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * When the editor's autosave sends the page (P2-JRN-001). Every save sends the
 * whole page, and a save used to follow every pause of 0.7 s, so someone typing
 * one character a second saved the page once a second.
 *
 * - A draft is saved once typing pauses for `idleMs`, as before.
 * - Saves start at least `minIntervalMs` apart: a pause soon after a save waits
 *   for the rest of that interval. A save that fails doesn't count: nothing
 *   reached the server, so the next edit is sent after a pause, as before.
 * - While typing goes on without a pause, the draft is saved `maxWaitMs` after its
 *   first unsaved change, so a long burst still reaches the server.
 * - Leaving never waits: `flush` saves a pending draft at once, and it runs when the
 *   window loses focus, the tab is hidden or closed, and the editor unmounts. The
 *   editor's own page-switch, navigation and publish paths save the current draft
 *   directly, as before.
 */

export interface SavePacing {
  idleMs: number;
  minIntervalMs: number;
  maxWaitMs: number;
}

export const SAVE_PACING: SavePacing = { idleMs: 700, minIntervalMs: 3000, maxWaitMs: 10_000 };

/** When a pending draft is due: see the note at the top. */
export function nextSaveAt(
  { firstChangeAt, lastChangeAt, lastSaveAt }: { firstChangeAt: number; lastChangeAt: number; lastSaveAt: number | undefined },
  pacing: SavePacing,
): number {
  const due = Math.min(lastChangeAt + pacing.idleMs, firstChangeAt + pacing.maxWaitMs);
  return lastSaveAt === undefined ? due : Math.max(due, lastSaveAt + pacing.minIntervalMs);
}

interface SaveClock {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

const systemClock: SaveClock = {
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export interface SaveThrottle<T> {
  /** A new draft: schedule its save (see the note at the top). */
  maybeExecute: (draft: T) => void;
  /** Drop the pending draft (it no longer needs saving). */
  cancel: () => void;
  /** Save the pending draft now, if there is one. */
  flush: () => void;
}

/** A draft saver paced as the note at the top describes. `run` may return the
 *  save's promise, so a failed save doesn't count. `same` tells a re-sent draft
 *  from a changed one: re-sending the same draft does not delay its save. */
export function createSaveThrottle<T>(
  run: (draft: T) => unknown,
  same: (a: T, b: T) => boolean = Object.is,
  pacing: SavePacing = SAVE_PACING,
  clock: SaveClock = systemClock,
): SaveThrottle<T> {
  let pending: { draft: T; firstChangeAt: number; lastChangeAt: number } | null = null;
  let lastSaveAt: number | undefined;
  let timer: unknown;
  const stop = () => {
    if (timer !== undefined) clock.clearTimer(timer);
    timer = undefined;
  };
  const fire = () => {
    stop();
    if (!pending) return;
    const { draft } = pending;
    pending = null;
    const startedAt = clock.now();
    lastSaveAt = startedAt;
    const result = run(draft);
    if (result instanceof Promise)
      result.catch(() => {
        if (lastSaveAt === startedAt) lastSaveAt = undefined;
      });
  };
  return {
    maybeExecute(draft) {
      const now = clock.now();
      if (pending && same(pending.draft, draft)) pending = { ...pending, draft };
      else pending = { draft, firstChangeAt: pending?.firstChangeAt ?? now, lastChangeAt: now };
      stop();
      timer = clock.setTimer(fire, Math.max(0, nextSaveAt({ ...pending, lastSaveAt }, pacing) - now));
    },
    cancel() {
      stop();
      pending = null;
    },
    flush: fire,
  };
}

/** `createSaveThrottle` for a component: one saver for its lifetime, which saves a
 *  pending draft when the window loses focus, the tab is hidden or closed, or the
 *  component unmounts. */
export function useSaveThrottle<T>(run: (draft: T) => unknown, same?: (a: T, b: T) => boolean): SaveThrottle<T> {
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  const [throttle] = useState(() => createSaveThrottle<T>((draft) => runRef.current(draft), same));
  useEffect(() => {
    const flush = () => throttle.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') throttle.flush();
    };
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      throttle.flush();
    };
  }, [throttle]);
  return throttle;
}
