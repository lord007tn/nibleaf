import { Button } from '@nibleaf/design-system/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useOtpResendCountdown } from '@nibleaf/design-system/hooks/use-otp-resend-countdown';
import { useLocale } from '@nibleaf/i18n/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { TermsNotice } from '@/components/terms-notice';
import { formatWait, friendlyAuthError, otpFailure, rateLimitWait } from '@/lib/auth-errors';
import { authClient } from '@/services/auth-client';

const CODE_LENGTH = 6;
const SLOTS = Array.from({ length: CODE_LENGTH }, (_, index) => index);

type AuthResult = { data?: unknown; error?: { code?: string; message?: string; status?: number } | null };
type FetchOptions = ReturnType<typeof rateLimitWait>['fetchOptions'];

/** Plain links to the inbox of the two webmail services whose addresses we can recognise from the domain alone. */
const WEBMAIL: Record<string, { app: string; href: string }> = {
  'gmail.com': { app: 'Gmail', href: 'https://mail.google.com/mail/u/0/#inbox' },
  'googlemail.com': { app: 'Gmail', href: 'https://mail.google.com/mail/u/0/#inbox' },
  'outlook.com': { app: 'Outlook', href: 'https://outlook.live.com/mail/0/' },
  'hotmail.com': { app: 'Outlook', href: 'https://outlook.live.com/mail/0/' },
  'live.com': { app: 'Outlook', href: 'https://outlook.live.com/mail/0/' },
};

const webmailFor = (email: string) => WEBMAIL[email.slice(email.lastIndexOf('@') + 1).toLowerCase()] ?? null;

/**
 * The email-code step shared by sign-in and sign-up: send and resend, check the
 * code, and what a failure means. A wrong code clears the boxes and puts the
 * caret back in the first one; a locked or rate-limited code makes "Resend"
 * the main action, with the server's wait as its countdown.
 */
export function useEmailCode({
  flow,
  email,
  verify,
  onVerified,
}: {
  /** Which page asks, so its send-wait is kept apart and survives a reload in this tab. */
  flow: 'sign-in' | 'sign-up';
  email: string;
  verify: (otp: string, fetchOptions: FetchOptions) => Promise<AuthResult>;
  onVerified: (data: unknown) => Promise<void> | void;
}) {
  const { t, locale } = useLocale();
  const [otp, setOtp] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  // Which request is running, so only the button that started it shows a spinner.
  const [busy, setBusy] = useState<'send' | 'resend' | 'verify' | null>(null);
  const inFlight = useRef(false);
  /** An error about the details step (shown above its button). */
  const [error, setError] = useState<string | null>(null);
  /** An error about the code (shown under the boxes). */
  const [codeError, setCodeError] = useState<string | null>(null);
  const [needsNewCode, setNeedsNewCode] = useState(false);
  // An absolute deadline, kept per flow for this tab: changing details, a remount or a
  // reload never clears a wait the server still enforces.
  const { resendIn, startCountdown } = useOtpResendCountdown(undefined, { storageKey: `nibleaf.otp-wait.${flow}` });
  const codeInput = useRef<HTMLInputElement>(null);
  // Focus after the render that re-enables the input; a disabled input can't take focus.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest) codeInput.current?.focus();
  }, [focusRequest]);
  const focusCode = () => setFocusRequest((count) => count + 1);

  const run = async (kind: 'send' | 'resend' | 'verify', task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const requestCode = (kind: 'send' | 'resend' = 'send') => {
    // While a wait runs, a send would only be refused again (and look broken).
    if (resendIn > 0) return Promise.resolve();
    return run(kind, async () => {
      setError(null);
      setCodeError(null);
      const wait = rateLimitWait();
      try {
        const result = await authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }, wait.fetchOptions);
        if (result.error) {
          const failure = otpFailure(result.error, wait.retryAfter(), t, t('auth.otp.sendError'), locale);
          if (kind === 'resend') setCodeError(failure.message);
          else setError(failure.message);
          if (failure.waitSeconds) startCountdown(failure.waitSeconds);
          return;
        }
        setOtp('');
        setNeedsNewCode(false);
        setCodeSent(true);
        startCountdown();
        if (kind === 'resend') focusCode();
      } catch {
        if (kind === 'resend') setCodeError(t('auth.error.tryAgain'));
        else setError(t('auth.error.tryAgain'));
      }
    });
  };

  const back = () => {
    setCodeSent(false);
    setOtp('');
    setError(null);
    setCodeError(null);
    setNeedsNewCode(false);
    // The send-wait stays: the server still enforces it for the next code.
  };

  const verifyCode = (value = otp) => {
    if (value.length !== CODE_LENGTH) {
      setCodeError(t('auth.verify.invalidCode'));
      focusCode();
      return Promise.resolve();
    }
    return run('verify', async () => {
      setCodeError(null);
      const wait = rateLimitWait();
      try {
        const result = await verify(value, wait.fetchOptions);
        if (!result.error) {
          await onVerified(result.data);
          return;
        }
        if (result.error.code === 'TERMS_REQUIRED') {
          back();
          setError(friendlyAuthError(result.error, t, t('auth.otp.invalid')));
          return;
        }
        const failure = otpFailure(result.error, wait.retryAfter(), t, t('auth.otp.invalid'), locale);
        setCodeError(failure.message);
        // A rejected code is no use in the boxes; a server failure keeps it for another try.
        if ((result.error.status ?? 400) < 500) setOtp('');
        if (failure.needsNewCode) {
          setNeedsNewCode(true);
          if (failure.waitSeconds) startCountdown(failure.waitSeconds);
        } else focusCode();
      } catch {
        setCodeError(t('auth.error.tryAgain'));
      }
    });
  };

  return {
    otp,
    setOtp,
    codeSent,
    busy,
    error,
    setError,
    codeError,
    needsNewCode,
    resendIn,
    codeInput,
    requestCode,
    verifyCode,
    back,
  };
}

type EmailCode = ReturnType<typeof useEmailCode>;

/**
 * Says, politely and once, when a send-wait starts and when a new code can be
 * requested again; the countdown itself only ticks in the button label, so it
 * is never read out every second.
 */
export function ResendStatus({ resendIn }: { resendIn: number }) {
  const { t, locale } = useLocale();
  const [message, setMessage] = useState('');
  const waiting = resendIn > 0;
  const wasWaiting = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: announce only when waiting starts or ends, never each second.
  useEffect(() => {
    if (waiting === wasWaiting.current) return;
    wasWaiting.current = waiting;
    setMessage(waiting ? t('auth.otp.resendWait', { wait: formatWait(resendIn, locale) }) : t('auth.otp.resendReady'));
    // Only the transition is announced, with the wait as it was when it started.
  }, [waiting]);
  return (
    <p aria-live="polite" className="sr-only" data-slot="resend-status" role="status">
      {message}
    </p>
  );
}

/** "We sent a 6-digit code to", then the address on its own line: left-to-right, isolated, and broken only when it can't fit. */
function CodeSentTo({ email, className }: { email: string; className?: string }) {
  const { t } = useLocale();
  const webmail = webmailFor(email);
  return (
    <div className={className ?? 'mb-6 text-center text-muted-foreground text-sm lg:text-start'}>
      <p>{t('auth.otp.sentTo')}</p>
      <p className="font-medium text-foreground">
        <span className="[overflow-wrap:anywhere] [unicode-bidi:isolate]" data-slot="code-email" dir="ltr">
          {email}
        </span>
      </p>
      {webmail ? (
        <a className="mt-2 inline-flex items-center gap-1 text-primary hover:underline" href={webmail.href} rel="noopener noreferrer" target="_blank">
          {t('auth.otp.openInbox', { app: webmail.app })}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}

/** Six code boxes (always left-to-right) with their label, hint and error. */
export function AuthCodeField({
  id,
  label,
  value,
  onChange,
  onComplete,
  disabled,
  error,
  hint,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div dir="ltr">
        <InputOTP
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="one-time-code"
          autoFocus
          containerClassName="justify-center"
          disabled={disabled}
          id={id}
          inputMode="numeric"
          maxLength={CODE_LENGTH}
          onChange={onChange}
          onComplete={onComplete}
          ref={inputRef}
          value={value}
        >
          <InputOTPGroup>
            {SLOTS.map((index) => (
              <InputOTPSlot index={index} key={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      {error ? (
        <p className="text-center text-destructive text-sm" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="text-center text-muted-foreground text-xs" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The code step's form: boxes, the main button (Resend once the code is spent), and change-details / resend. */
export function EmailCodeStep({
  code,
  email,
  submitLabel,
  backLabel,
}: {
  code: EmailCode;
  email: string;
  submitLabel: string;
  backLabel: ReactNode;
}) {
  const { t } = useLocale();
  const resendLabel = code.resendIn > 0 ? t('auth.otp.resendIn', { seconds: code.resendIn }) : t('auth.otp.resend');
  const resendProps = {
    disabled: code.busy !== null || code.resendIn > 0,
    loading: code.busy === 'resend',
    loadingText: t('auth.otp.sending'),
    onClick: () => void code.requestCode('resend'),
    type: 'button' as const,
  };
  return (
    <>
      <ResendStatus resendIn={code.resendIn} />
      <CodeSentTo email={email} />
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void code.verifyCode();
        }}
      >
        <AuthCodeField
          disabled={code.busy !== null || code.needsNewCode}
          error={code.codeError}
          hint={t('auth.otp.hint')}
          id="otp"
          inputRef={code.codeInput}
          label={t('auth.otp.label')}
          onChange={code.setOtp}
          onComplete={(value) => void code.verifyCode(value)}
          value={code.otp}
        />
        <TermsNotice />
        {code.needsNewCode ? (
          <Button className="mt-1 w-full" {...resendProps}>
            {resendLabel}
          </Button>
        ) : (
          <Button
            className="mt-1 w-full"
            disabled={code.busy !== null}
            loading={code.busy === 'verify'}
            loadingText={t('auth.otp.verifying')}
            type="submit"
          >
            {submitLabel}
          </Button>
        )}
        <div className="flex items-center justify-between">
          <Button onClick={code.back} size="sm" type="button" variant="ghost">
            <ArrowLeft className="size-4 rtl:-scale-x-100" /> {backLabel}
          </Button>
          {code.needsNewCode ? null : (
            <Button size="sm" variant="ghost" {...resendProps}>
              {resendLabel}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
