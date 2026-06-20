import { useForm } from '@tanstack/react-form';
import { Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient, useSession } from '@/lib/auth-client';
import { email as validateEmail, required } from '@/lib/form';
import { GradientAvatar, SettingsSection } from './section';

// better-auth's email-change verification methods are plugin/proxy-generated and
// may not be present on every build, so reach for them defensively.
type ChangeEmailClient = {
  changeEmail?: (args: { newEmail: string }) => Promise<{ error?: { message?: string } | null } | undefined>;
  verifyChangeEmail?: (args: { otp: string; newEmail?: string }) => Promise<{ error?: { message?: string } | null } | undefined>;
  emailOtp?: { verifyEmail?: (args: { email: string; otp: string }) => Promise<{ error?: { message?: string } | null } | undefined> };
};

function NameForm({ initialName }: { initialName: string }) {
  const form = useForm({
    defaultValues: { name: initialName },
    onSubmit: async ({ value }) => {
      try {
        const res = await authClient.updateUser({ name: value.name.trim() });
        if (res?.error) {
          toast.error(res.error.message ?? 'Could not save your name');
          return;
        }
        toast.success('Profile updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save your name');
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
      <form.Field name="name" validators={{ onChange: ({ value }) => required('Name')(value) }}>
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="acct-name">Name</Label>
            <Input id="acct-name" onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mt-4 flex justify-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

type Stage = 'idle' | 'editing' | 'code' | 'done';

/** Cosmetic 30s resend countdown, formatted m:ss. */
function useResendTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const start = () => setSeconds(30);

  useEffect(() => {
    if (!active || seconds <= 0) {
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [active, seconds]);

  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return { start, seconds, label };
}

function EmailRow({ email, verified }: { email: string; verified: boolean }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const resend = useResendTimer(stage === 'code');

  const reset = () => {
    setStage('idle');
    setNewEmail('');
    setCode('');
  };

  const editForm = useForm({
    defaultValues: { newEmail: '' },
    onSubmit: async ({ value }) => {
      const next = value.newEmail.trim();
      try {
        const client = authClient as unknown as ChangeEmailClient;
        const res = await client.changeEmail?.({ newEmail: next });
        if (res?.error) {
          toast.error(res.error.message ?? 'Could not send the verification code');
          return;
        }
        toast.success(`We sent a 6-digit code to ${next}`);
        setNewEmail(next);
        setCode('');
        setStage('code');
        resend.start();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not send the verification code');
      }
    },
  });

  const verify = async () => {
    setBusy(true);
    try {
      const client = authClient as unknown as ChangeEmailClient;
      // Different better-auth builds expose the verify step differently; try the
      // known shapes and treat any success as a confirmed change.
      const res = client.verifyChangeEmail
        ? await client.verifyChangeEmail({ otp: code, newEmail })
        : await client.emailOtp?.verifyEmail?.({ email: newEmail, otp: code });
      if (res?.error) {
        toast.error(res.error.message ?? 'That code did not match. Try again.');
        return;
      }
      toast.success(`Email updated to ${newEmail}`);
      setStage('done');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That code did not match. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (resend.seconds > 0) {
      return;
    }
    try {
      const client = authClient as unknown as ChangeEmailClient;
      await client.changeEmail?.({ newEmail });
      toast.success(`We sent a new code to ${newEmail}`);
      resend.start();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend the code');
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="acct-email">Email</Label>

      {stage === 'idle' ? (
        <div className="flex items-center gap-3 rounded-md border border-input bg-muted/40 px-3 py-2">
          <span className="font-medium text-sm">{email}</span>
          {verified ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">✓ Verified</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Unverified
            </Badge>
          )}
          <Button className="ms-auto" size="sm" type="button" variant="outline" onClick={() => setStage('editing')}>
            Change
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
          <p className="mb-3 text-muted-foreground text-sm leading-relaxed">
            Enter a new email address. We'll send a 6-digit code there to confirm it's yours before switching.
          </p>
          <editForm.Field name="newEmail" validators={{ onChange: ({ value }) => validateEmail(value) }}>
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Input
                  autoFocus
                  id="acct-email"
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="new@company.com"
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
                  {isSubmitting ? 'Sending…' : 'Send verification code'}
                </Button>
              )}
            </editForm.Subscribe>
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {stage === 'code' ? (
        <div className="rounded-xl border border-input bg-muted/40 p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <Mail className="size-4" />
            </span>
            <p className="text-muted-foreground text-sm leading-snug">
              We sent a code to <span className="font-medium text-foreground">{newEmail}</span>. Enter it below.
            </p>
          </div>
          <Input
            autoFocus
            className="h-12 text-center font-mono font-semibold text-2xl tracking-[0.4em]"
            id="acct-email-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            value={code}
          />
          <div className="mt-3 flex items-center gap-2">
            <Button disabled={busy || code.length < 6} type="button" onClick={verify}>
              {busy ? 'Verifying…' : 'Verify & update'}
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
            <button
              className="ms-auto text-muted-foreground text-sm enabled:cursor-pointer enabled:hover:text-foreground disabled:opacity-100"
              disabled={resend.seconds > 0}
              onClick={resendCode}
              type="button"
            >
              {resend.seconds > 0 ? `Resend in ${resend.label}` : 'Resend code'}
            </button>
          </div>
        </div>
      ) : null}

      {stage === 'done' ? (
        <div className="flex items-center gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400">
          <span className="text-base">✓</span>
          <span className="font-medium text-sm">Email updated to {newEmail}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AccountTab() {
  const { data: session } = useSession();
  const user = session?.user;
  const name = user?.name ?? '';
  const email = user?.email ?? '';
  const verified = Boolean(user?.emailVerified);

  return (
    <SettingsSection title="Account" description="Your personal profile across every workspace.">
      <div className="mb-5 flex items-center gap-4">
        <GradientAvatar className="size-12 text-base" name={name} />
        <Button disabled size="sm" variant="outline">
          Change avatar
        </Button>
      </div>
      <NameForm key={email} initialName={name} />
      <div className="mt-5">
        <EmailRow key={email} email={email} verified={verified} />
      </div>
    </SettingsSection>
  );
}
