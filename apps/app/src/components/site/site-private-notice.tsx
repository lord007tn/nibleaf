import { siteAccessT } from '@nibleaf/i18n/site-access';

/** The private-site screen's copy and sign-in path. It loads on demand, so its
 *  strings never reach readers of public sites. Invited readers arrive through
 *  their email link; workspace members sign in to Nibleaf, whose session reaches
 *  the site only on the app origin (`showSignIn`), not on a custom domain. */
export default function SitePrivateNotice({ lang, showSignIn }: { lang?: string; showSignIn: boolean }) {
  const t = siteAccessT(lang);
  return (
    <>
      <p className="mt-2 text-muted-foreground text-sm">{t('privateBody')}</p>
      {showSignIn ? (
        <>
          <p className="mt-1 text-muted-foreground text-sm">{t('privateMembers')}</p>
          <a
            href="/sign-in"
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-medium text-primary-foreground text-sm shadow-sm transition-opacity hover:opacity-90"
          >
            {t('privateSignIn')}
          </a>
        </>
      ) : null}
    </>
  );
}
