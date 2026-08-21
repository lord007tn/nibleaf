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

  const startCountdown = useCallback(() => setResendIn(cooldownSeconds), [cooldownSeconds]);
  const resetCountdown = useCallback(() => setResendIn(0), []);

  return { resendIn, resetCountdown, startCountdown };
}
