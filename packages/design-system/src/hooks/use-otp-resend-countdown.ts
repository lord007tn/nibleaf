import { useCallback, useEffect, useState } from 'react';

export const OTP_RESEND_COOLDOWN_SECONDS = 45;

const readDeadline = (storageKey: string | undefined): number => {
  if (!storageKey) return 0;
  try {
    const stored = Number(window.sessionStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
};

const writeDeadline = (storageKey: string | undefined, deadline: number) => {
  if (!storageKey) return;
  try {
    if (deadline > Date.now()) window.sessionStorage.setItem(storageKey, String(deadline));
    else window.sessionStorage.removeItem(storageKey);
  } catch {
    // Storage can be unavailable (private mode, blocked): the wait then lasts for this page only.
  }
};

/**
 * Keep OTP resend controls aligned with the server-side rate limit. The wait is
 * an absolute deadline, so it survives a re-render or a step change; with a
 * `storageKey` (one per flow, e.g. "sign-in") it also survives a remount or a
 * reload in the same tab. `resendIn` is the whole seconds left, never negative.
 */
export function useOtpResendCountdown(cooldownSeconds = OTP_RESEND_COOLDOWN_SECONDS, options: { storageKey?: string } = {}) {
  const { storageKey } = options;
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Read a stored wait after mount: the server render has no storage, and the
  // first client render must match it.
  useEffect(() => {
    const stored = readDeadline(storageKey);
    if (stored) {
      setNow(Date.now());
      setDeadline((current) => Math.max(current, stored));
    }
  }, [storageKey]);

  useEffect(() => {
    if (deadline <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(1000, deadline - now));
    return () => window.clearTimeout(timer);
  }, [deadline, now]);

  /** Starts the cooldown; `seconds` overrides it, for example with the wait a rate limit answered. Never shortens a running wait. */
  const startCountdown = useCallback(
    (seconds?: number) => {
      const start = Date.now();
      const next = start + Math.max(0, Math.ceil(seconds ?? cooldownSeconds)) * 1000;
      setNow(start);
      setDeadline((current) => {
        const deadline = Math.max(current, next);
        writeDeadline(storageKey, deadline);
        return deadline;
      });
    },
    [cooldownSeconds, storageKey],
  );
  const resetCountdown = useCallback(() => {
    writeDeadline(storageKey, 0);
    setDeadline(0);
  }, [storageKey]);

  const resendIn = Math.max(0, Math.ceil((deadline - now) / 1000));
  return { resendIn, resetCountdown, startCountdown };
}
