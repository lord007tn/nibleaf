import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@nibleaf/design-system/components/ui/input-otp';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { required, email as validateEmail } from '@/lib/form';
import { authClient, useSession } from '@/services/auth-client';
import { GradientAvatar, SettingsSection } from './section';

function NameForm({ initialName }: { initialName: string }) {
  const t = useT();
  const form = useForm({
    defaultValues: { name: initialName },
    onSubmit: async ({ value }) => {
      try {
        const res = await authClient.updateUser({ name: value.name.trim() });
        if (res?.error) {
          toast.error(res.error.message ?? t('settings.account.name.error'));
          return;
        }
        toast.success(t('settings.account.profileUpdated'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.account.name.error'));
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
      <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.account.name.label'), t)(value) }}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acct-name">{t('settings.account.name.label')}</Label>
            <Input id="acct-name" onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mt-4 flex justify-end">
        <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
          {([isSubmitting, isDirty]) => (
            <Button disabled={isSubmitting || !isDirty} type="submit">
              {isSubmitting ? t('common.saving') : t('common.save')}
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

  const reset = () => {
    setStage('idle');
    setNewEmail('');
    setOtp('');
  };

  const editForm = useForm({
    defaultValues: { newEmail: '' },
    onSubmit: async ({ value }) => {
      const next = value.newEmail.trim();
      try {
        const res = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
        if (res.error) {
          toast.error(res.error.message ?? t('settings.account.email.sendError'));
          return;
        }
        toast.success(t('settings.account.email.currentVerificationSent'));
        setNewEmail(next);
        setStage('verify-current');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.account.email.sendError'));
      }
    },
  });

  const verifyCurrentEmail = async () => {
    setIsVerifying(true);
    try {
      const res = await authClient.emailOtp.requestEmailChange({ newEmail, otp: otp.trim() });
      if (res.error) {
        toast.error(res.error.message ?? t('settings.account.email.verifyError'));
        return;
      }
      toast.success(t('settings.account.email.verificationSent', { email: newEmail }));
      setOtp('');
      setStage('pending');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.account.email.verifyError'));
    } finally {
      setIsVerifying(false);
    }
  };

  const verifyEmailChange = async () => {
    setIsVerifying(true);
    try {
      const res = await authClient.emailOtp.changeEmail({ newEmail, otp: otp.trim() });
      if (res.error) {
        toast.error(res.error.message ?? t('settings.account.email.verifyError'));
        return;
      }
      toast.success(t('settings.account.email.changed'));
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.account.email.verifyError'));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="acct-email">{t('settings.account.email.label')}</Label>

      {stage === 'idle' ? (
        <div className="flex items-center gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
          <span className="font-medium text-sm" dir="ltr">
            {email}
          </span>
          {verified ? (
            <Badge className="bg-success/15 text-success">✓ {t('settings.account.email.verified')}</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {t('settings.account.email.unverified')}
            </Badge>
          )}
          <Button className="ms-auto" size="sm" type="button" variant="outline" onClick={() => setStage('editing')}>
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
          <editForm.Field name="newEmail" validators={{ onChange: ({ value }) => validateEmail(value, t) }}>
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Input
                  autoFocus
                  dir="ltr"
                  id="acct-email"
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t('settings.account.email.placeholder')}
                  type="email"
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </editForm.Field>
          <div className="mt-3 flex gap-2">
            <editForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? t('settings.account.email.sending') : t('settings.account.email.sendVerification')}
                </Button>
              )}
            </editForm.Subscribe>
            <Button type="button" variant="outline" onClick={reset}>
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
            <Button disabled={isVerifying || otp.length !== 6} type="submit">
              {isVerifying ? t('auth.otp.verifying') : t('settings.account.email.verifyCurrent')}
            </Button>
            <Button onClick={reset} type="button" variant="outline">
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
            <Button disabled={isVerifying || otp.length !== 6} type="submit">
              {isVerifying ? t('auth.otp.verifying') : t('settings.account.email.confirm')}
            </Button>
            <Button onClick={reset} type="button" variant="outline">
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
  const { data: session } = useSession();
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
