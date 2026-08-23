import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { AuthLayout } from '@/layouts/auth';

export const Route = createFileRoute('/(auth)/reset-password')({ component: ResetPasswordPage });

function ResetPasswordPage() {
  const t = useT();
  return (
    <AuthLayout subtitle={t('auth.passwordless.subtitle')}>
      <div className="flex flex-col items-center rounded-xl border border-border bg-muted/40 px-5 py-6 text-center">
        <span className="mb-3 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('auth.passwordless.oldLink')}</p>
        <Link
          className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-foreground text-sm shadow-xs hover:bg-primary/90"
          to="/sign-in"
        >
          {t('auth.passwordless.continue')}
        </Link>
      </div>
    </AuthLayout>
  );
}
