import { useCallback, useEffect, useState } from 'react';

export const OTP_RESEND_COOLDOWN_SECONDS = 45;

/** Keep OTP resend controls aligned with the server-side rate limit. */
export function useOtpResendCountdown(cooldownSeconds = OTP_RESEND_COOLDOWN_SECONDS) {
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((remaining) => remaining - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  /** Starts the cooldown; `seconds` overrides it, for example with the wait a rate limit answered. */
  const startCountdown = useCallback((seconds?: number) => setResendIn(Math.ceil(seconds ?? cooldownSeconds)), [cooldownSeconds]);
  const resetCountdown = useCallback(() => setResendIn(0), []);

  return { resendIn, resetCountdown, startCountdown };
}
