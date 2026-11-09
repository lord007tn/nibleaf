import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Mail } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { DirtyStateReporter, SettingsFormSkeleton } from '@/components/project-settings/shared';
import { friendlyEmailChangeError, isSameEmail } from '@/lib/auth-errors';
import { required, email as validateEmail } from '@/lib/form';
import { authClient, useSession } from '@/services/auth-client';
import { GradientAvatar, SettingsSection } from './section';

const subscribeToHydration = () => () => undefined;

function NameForm({ initialName }: { initialName: string }) {
  const t = useT();
  const form = useForm({
    defaultValues: { name: initialName },
    onSubmit: async ({ value }) => {
      try {
        const res = await authClient.updateUser({ name: value.name.trim() });
        if (res?.error) {
          toast.error(t('settings.account.name.error'));
          return;
        }
        const currentName = form.state.values.name;
        form.reset({ name: value.name.trim() });
        if (currentName !== value.name) form.setFieldValue('name', currentName);
        toast.success(t('settings.account.profileUpdated'));
      } catch {
        toast.error(t('settings.account.name.error'));
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => !state.isDefaultValue}>{(dirty) => <DirtyStateReporter dirty={dirty} />}</form.Subscribe>
      <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.account.name.label'), t)(value) }}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acct-name">{t('settings.account.name.label')}</Label>
            <Input
              id="acct-name"
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? 'acct-name-error' : undefined}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
            <FieldError id="acct-name-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mt-4 flex justify-end">
        <form.Subscribe selector={(state) => [state.isSubmitting, !state.isDefaultValue] as const}>
          {([isSubmitting, isDirty]) => (
            <Button disabled={!isDirty} loading={isSubmitting} type="submit" loadingText={t('common.saving')}>
              {t('common.save')}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

type Stage = 'idle' | 'editing' | 'verify-current' | 'pending';

function EmailRow({ email, verified }: { email: string; verified: boolean }) {
  const t = useT();
  const [stage, setStage] = useState<Stage>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  // One number per attempt. Cancel and "Change email" start a new one, so a
  // request still in flight from an abandoned attempt can't bring it back.
  const attempt = useRef(0);
  const changeButton = useRef<HTMLButtonElement>(null);
  // Which attempt's code request is in flight. The form's own isSubmitting is
  // shared by every attempt, so a cancelled request finishing late would clear
  // it while a newer one is still sending; this belongs to one attempt only.
  const [sendingRun, setSendingRun] = useState<number | null>(null);
  const sending = sendingRun !== null && sendingRun === attempt.current;

  const reset = () => {
    setStage('idle');
    setNewEmail('');
    setOtp('');
  };

  const start = () => {
    attempt.current += 1;
    setStage('editing');
  };

  const cancel = () => {
    attempt.current += 1;
    flushSync(() => {
      reset();
      setIsVerifying(false);
      editForm.reset();
    });
    changeButton.current?.focus();
  };

  const editForm = useForm({
    defaultValues: { newEmail: '' },
    onSubmit: async ({ value }) => {
      const next = value.newEmail.trim();
      if (isSameEmail(email, next)) {
        toast.error(t('settings.account.email.sameAsCurrent'));
        return;
      }
      const run = attempt.current;
      // Enter while this attempt's request is on its way must not send a second one.
      if (sendingRun === run) return;
      setSendingRun(run);
      try {
        const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
        if (run !== attempt.current) return;
        if (res.error) {
          toast.error(emailChangeError(res.error, t, t('settings.account.email.sendError')));
          return;
        }
        toast.success(t('settings.account.email.currentVerificationSent'));
        setNewEmail(next);
        setStage('verify-current');
      } catch {
        // The request never reached the server.
        if (run === attempt.current) toast.error(t('auth.error.tryAgain'));
      } finally {
        setSendingRun((current) => (current === run ? null : current));
      }
    },
  });

  const verifyCurrentEmail = async () => {
    const run = attempt.current;
    setIsVerifying(true);
    try {
      const res = await authClient.emailOtp.requestEmailChange({ newEmail, otp: otp.trim() });
      if (run !== attempt.current) return;
      if (res.error) {
        toast.error(emailChangeError(res.error, t, t('settings.account.email.verifyError')));
        return;
      }
      toast.success(t('settings.account.email.verificationSent', { email: newEmail }));
      setOtp('');
      setStage('pending');
    } catch {
      if (run === attempt.current) toast.error(t('auth.error.tryAgain'));
    } finally {
      if (run === attempt.current) setIsVerifying(false);
    }
  };

  const verifyEmailChange = async () => {
    const run = attempt.current;
    setIsVerifying(true);
    try {
      const res = await authClient.emailOtp.changeEmail({ newEmail, otp: otp.trim() });
      if (run !== attempt.current) return;
      if (res.error) {
        // Never Better Auth's English text ("Email already in use").
        toast.error(emailChangeError(res.error, t, t('settings.account.email.verifyError')));
        return;
      }
      toast.success(t('settings.account.email.changed'));
      flushSync(reset);
      window.location.reload();
    } catch {
      if (run === attempt.current) toast.error(t('auth.error.tryAgain'));
    } finally {
      if (run === attempt.current) setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <editForm.Subscribe selector={(state) => !state.isDefaultValue}>
        {(dirty) => <DirtyStateReporter dirty={stage !== 'idle' && (dirty || Boolean(newEmail) || Boolean(otp))} />}
      </editForm.Subscribe>
      <Label htmlFor="acct-email">{t('settings.account.email.label')}</Label>

      {stage === 'idle' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
          <span className="max-w-full break-all font-medium text-sm" dir="ltr">
            {email}
          </span>
          {verified ? (
            <Badge className="bg-success/15 text-success">✓ {t('settings.account.email.verified')}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t('settings.account.email.unverified')}
            </Badge>
          )}
          <Button className="ms-auto" onClick={start} ref={changeButton} size="sm" type="button" variant="outline">
            {t('settings.account.email.change')}
          </Button>
        </div>
      ) : null}

      {stage === 'editing' ? (
        <form
          className="rounded-xl border border-input bg-muted/40 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            editForm.handleSubmit();
          }}
        >
          <p className="mb-3 text-muted-foreground text-sm leading-relaxed">{t('settings.account.email.changeIntro')}</p>
          <editForm.Field
            name="newEmail"
            validators={{
              onChange: ({ value }) => validateEmail(value, t) ?? (isSameEmail(email, value) ? t('settings.account.email.sameAsCurrent') : undefined),
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Input
                  autoFocus
                  dir="ltr"
                  id="acct-email"
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={field.state.meta.errors.length ? 'acct-email-error' : undefined}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t('settings.account.email.placeholder')}
                  type="email"
                  value={field.state.value}
                />
                <FieldError id="acct-email-error" errors={field.state.meta.errors} />
              </div>
            )}
          </editForm.Field>
          <div className="mt-3 flex gap-2">
            <Button loading={sending} type="submit" loadingText={t('settings.account.email.sending')}>
              {t('settings.account.email.sendVerification')}
            </Button>
            <Button onClick={cancel} type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'verify-current' ? (
        <form
          className="rounded-xl border border-primary/30 bg-primary/10 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCurrentEmail();
          }}
        >
          <div className="mb-3 flex items-center gap-3 text-primary">
            <Mail className="size-4 shrink-0" />
            <span className="font-medium text-sm">{t('settings.account.email.currentVerification', { email })}</span>
          </div>
          <Label htmlFor="acct-current-email-otp">{t('auth.otp.label')}</Label>
          <div dir="ltr">
            <InputOTP
              autoComplete="one-time-code"
              autoFocus
              containerClassName="mt-1.5"
              disabled={isVerifying}
              id="acct-current-email-otp"
              inputMode="numeric"
              maxLength={6}
              onChange={setOtp}
              onComplete={verifyCurrentEmail}
              value={otp}
            >
              <InputOTPGroup>
                <InputOTPSlot className="bg-background" index={0} />
                <InputOTPSlot className="bg-background" index={1} />
                <InputOTPSlot className="bg-background" index={2} />
                <InputOTPSlot className="bg-background" index={3} />
                <InputOTPSlot className="bg-background" index={4} />
                <InputOTPSlot className="bg-background" index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={otp.length !== 6} loading={isVerifying} type="submit" loadingText={t('auth.otp.verifying')}>
              {t('settings.account.email.verifyCurrent')}
            </Button>
            <Button onClick={cancel} type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'pending' ? (
        <form
          className="rounded-xl border border-primary/30 bg-primary/10 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyEmailChange();
          }}
        >
          <div className="mb-3 flex items-center gap-3 text-primary">
            <Mail className="size-4 shrink-0" />
            <span className="font-medium text-sm">{t('settings.account.email.pendingVerification', { email: newEmail })}</span>
          </div>
          <Label htmlFor="acct-email-otp">{t('auth.otp.label')}</Label>
          <div dir="ltr">
            <InputOTP
              autoComplete="one-time-code"
              autoFocus
              containerClassName="mt-1.5"
              disabled={isVerifying}
              id="acct-email-otp"
              inputMode="numeric"
              maxLength={6}
              onChange={setOtp}
              onComplete={verifyEmailChange}
              value={otp}
            >
              <InputOTPGroup>
                <InputOTPSlot className="bg-background" index={0} />
                <InputOTPSlot className="bg-background" index={1} />
                <InputOTPSlot className="bg-background" index={2} />
                <InputOTPSlot className="bg-background" index={3} />
                <InputOTPSlot className="bg-background" index={4} />
                <InputOTPSlot className="bg-background" index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={otp.length !== 6} loading={isVerifying} type="submit" loadingText={t('auth.otp.verifying')}>
              {t('settings.account.email.confirm')}
            </Button>
            {/* Once the final confirmation is on its way the address may already have changed: no cancelling it then. */}
            <Button disabled={isVerifying} onClick={cancel} type="button" variant="outline">
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function AccountTab() {
  const t = useT();
  const { data: session, isPending } = useSession();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  // Auth can resolve before this streamed route hydrates. Keep its first render
  // identical to the server and mount profile drafts only for a loaded account.
  if (!hydrated || isPending || !session?.user) {
    return (
      <SettingsSection title={t('settings.account.title')} description={t('settings.account.description')}>
        <SettingsFormSkeleton />
      </SettingsSection>
    );
  }
  const user = session?.user;
  const name = user?.name ?? '';
  const email = user?.email ?? '';
  const verified = Boolean(user?.emailVerified);

  return (
    <SettingsSection title={t('settings.account.title')} description={t('settings.account.description')}>
      <div className="mb-5 flex items-center gap-4">
        <GradientAvatar className="size-12 text-base" name={name} />
        <Button disabled size="sm" variant="outline">
          {t('settings.account.changeAvatar')}
        </Button>
      </div>
      <NameForm key={email} initialName={name} />
      <div className="mt-5">
        <EmailRow key={email} email={email} verified={verified} />
      </div>
    </SettingsSection>
  );
}

/** Email-change failures: an undeliverable address gets the delivery message;
 *  everything else goes through the shared plain-language auth policy. */
function emailChangeError(error: Parameters<typeof friendlyEmailChangeError>[0], t: ReturnType<typeof useT>, fallback: string): string {
  return error?.code === 'AUTH_EMAIL_UNAVAILABLE' ? t('settings.account.email.sendError') : friendlyEmailChangeError(error, t, fallback);
}
