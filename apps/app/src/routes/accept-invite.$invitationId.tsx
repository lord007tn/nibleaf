import { Button } from '@nibleaf/design-system/components/ui/button';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AuthProviders } from '@/components/auth-providers';
import { AuthLayout } from '@/layouts/auth';
import { authClient, useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';
import { clearPendingInvitation, fetchInvitationInfo, type InvitationInfo, setPendingInvitation } from '@/lib/invitations';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  // Not under the (auth) layout, so noindex it directly: the URL carries a live
  // invitation token that must never be crawled or indexed.
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AcceptInvitePage,
});

/** Top-level so it resolves whether or not the user is authenticated. */
function AcceptInvitePage() {
  return (
    <AuthProviders>
      <AcceptInviteContent />
    </AuthProviders>
  );
}

function AcceptInviteContent() {
  const t = useT();
  const { invitationId } = Route.useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [infoLoaded, setInfoLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetchInvitationInfo(invitationId).then((result) => {
      if (active) {
        setInfo(result);
        setInfoLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [invitationId]);

  // Stash the invitation so sign-in/up can route back here afterwards.
  useEffect(() => {
    if (!isPending && !session) {
      setPendingInvitation(invitationId);
    }
  }, [isPending, session, invitationId]);

  const accept = async () => {
    setError(null);
    setAccepting(true);
    const { error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    setAccepting(false);
    if (acceptError) {
      const blob = `${acceptError.code ?? ''} ${acceptError.message ?? ''}`.toUpperCase();
      if (blob.includes('RECIPIENT') && info) {
        setError(t('auth.invite.wrongAccount', { email: info.email }));
      } else if (blob.includes('EXPIRED')) {
        setError(t('auth.invite.expiredError'));
      } else {
        setError(acceptError.message ?? t('auth.invite.error'));
      }
      return;
    }
    clearPendingInvitation();
    toast.success(t('auth.invite.acceptedToast'));
    navigate({ to: '/app' });
  };

  const subtitle = info?.organizationName ? t('auth.invite.joinPrompt', { org: info.organizationName }) : t('auth.invite.subtitle');

  if (isPending || !infoLoaded) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="text-center text-muted-foreground text-sm">{t('common.loading')}</p>
      </AuthLayout>
    );
  }

  if (!info) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {t('auth.invite.notFound')}
        </p>
      </AuthLayout>
    );
  }

  if (info.expired) {
    return (
      <AuthLayout subtitle={subtitle}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {t('auth.invite.expiredError')}
        </p>
      </AuthLayout>
    );
  }

  if (!session) {
    const search = { invite: invitationId, email: info.email };
    return (
      <AuthLayout subtitle={subtitle}>
        <div className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.invitedAs', { email: info.email })}</p>
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.signInPrompt')}</p>
          <Button className="w-full" nativeButton={false} render={<Link search={search} to="/sign-up" />}>
            {t('auth.invite.createAccountToJoin')}
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            {t('auth.signUp.haveAccount')}{' '}
            <Link className="text-primary hover:underline" search={search} to="/sign-in">
              {t('auth.invite.signInToJoin')}
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  // Signed in, but with a different address than the invite was sent to.
  const mismatch = session.user.email.toLowerCase() !== info.email.toLowerCase();

  return (
    <AuthLayout subtitle={subtitle}>
      <div className="flex flex-col gap-4">
        <p className="text-center text-muted-foreground text-sm">{t('auth.invite.invitedAs', { email: info.email })}</p>
        {mismatch ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
            {t('auth.invite.wrongAccount', { email: info.email })}
          </p>
        ) : (
          <p className="text-center text-muted-foreground text-sm">{t('auth.invite.acceptPrompt')}</p>
        )}
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <Button className="w-full" disabled={accepting || mismatch} onClick={accept} type="button">
          {accepting ? t('auth.invite.accepting') : t('auth.invite.accept')}
        </Button>
        <Link className="text-center text-muted-foreground text-sm hover:underline" to="/app">
          {t('auth.invite.skip')}
        </Link>
      </div>
    </AuthLayout>
  );
}
