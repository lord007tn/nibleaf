import { siteT } from '@nibleaf/i18n/site';
import { useState } from 'react';

/**
 * Sign out of a private site for someone signed in on the site itself (a
 * reader, or a team member on a custom domain). The page reloads only once the
 * server has ended the session; a failure says so, so nobody walks away from a
 * shared device believing they signed out.
 */
export function SiteSignOut({
  lang,
  projectId,
  onSignedOut = () => window.location.reload(),
}: {
  lang?: string;
  projectId: string;
  onSignedOut?: () => void;
}) {
  const t = siteT(lang);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const signOut = async () => {
    setState('busy');
    try {
      const response = await fetch(`/api/public/reader-access/logout/${encodeURIComponent(projectId)}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Sign-out failed with ${response.status}`);
      onSignedOut();
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="mx-auto flex max-w-[90rem] flex-col items-center gap-1 px-6 pb-5">
      <button
        className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
        disabled={state === 'busy'}
        onClick={() => void signOut()}
        type="button"
      >
        {t('signOut')}
      </button>
      {state === 'failed' ? (
        <p className="text-destructive text-xs" role="alert">
          {t('signOutFailed')}
        </p>
      ) : null}
    </div>
  );
}
