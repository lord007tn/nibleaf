import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { Button } from '@/components/ui/button';
import { authClient, useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  component: AcceptInvitePage,
});

/** Top-level so it resolves whether or not the user is authenticated. */
function AcceptInvitePage() {
  const { invitationId } = Route.useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setError(null);
    setAccepting(true);
    const { error: acceptError } = await authClient.organization.acceptInvitation({ invitationId });
    setAccepting(false);
    if (acceptError) {
      setError(acceptError.message ?? 'Could not accept this invitation. It may have expired.');
      return;
    }
    toast.success('Invitation accepted');
    navigate({ to: '/app' });
  };

  if (isPending) {
    return (
      <AuthLayout subtitle="You've been invited to a workspace">
        <p className="text-center text-muted-foreground text-sm">Loading…</p>
      </AuthLayout>
    );
  }

  if (!session) {
    // Stash the invitation so it can be picked up after the user signs in/up.
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('plume.pendingInvitation', invitationId);
    }
    return (
      <AuthLayout subtitle="You've been invited to a workspace">
        <div className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">Sign in or create an account to accept this invitation.</p>
          <Button className="w-full" render={<Link to="/sign-up" />}>
            Create an account
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            Already have an account?{' '}
            <Link className="text-primary hover:underline" to="/sign-in">
              Sign in
            </Link>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="You've been invited to a workspace">
      <div className="flex flex-col gap-4">
        <p className="text-center text-muted-foreground text-sm">Accept the invitation to join the workspace.</p>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <Button className="w-full" disabled={accepting} onClick={accept} type="button">
          {accepting ? 'Accepting…' : 'Accept invitation'}
        </Button>
        <Link className="text-center text-muted-foreground text-sm hover:underline" to="/app">
          Skip for now
        </Link>
      </div>
    </AuthLayout>
  );
}
