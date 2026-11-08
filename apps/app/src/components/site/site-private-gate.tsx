import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { isRtl, resolveLocale } from '@nibleaf/i18n/locales';
import { siteAccessT } from '@nibleaf/i18n/site-access';
import { Lock } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import type { ProjectConfig } from '@/hooks/api/types';
import { publishedSiteLogo } from '@/lib/site-branding';
import { projectThemeStyle, projectThemeVariables } from '@/lib/site-theme';

/** What the API tells a visitor who can't read a private site yet (see
 *  `privateSiteGate` in apps/server/src/actions/sites.ts): branding only, no content. */
export interface PrivateSiteGate {
  projectId: string;
  name: string;
  mode: 'WORKSPACE' | 'READERS';
  language: { code: string; direction: 'LTR' | 'RTL' } | null;
  config: Pick<ProjectConfig, 'branding' | 'styling'> | null;
}

type Step = { kind: 'email'; notice?: 'inviteUsed' } | { kind: 'code'; email: string } | { kind: 'invite'; token: string };
type Problem = 'privateInvalidCode' | 'privateTooMany' | 'privateFailed';

/** The invitation token rides in the URL fragment, which never reaches a server. */
const INVITE_FRAGMENT = /(?:^#|&)reader-invite=([^&]+)/;

const post = (path: string, body: unknown) =>
  fetch(`/api/public/reader-access/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const problemFor = (status: number): Problem => (status === 429 ? 'privateTooMany' : status === 400 ? 'privateInvalidCode' : 'privateFailed');

/**
 * The sign-in screen of a private published site, in the site's own name, logo
 * and colours. Invited readers and the site's team ask for a one-time email
 * code; a reader who opens an invitation link accepts it with a click. Signing
 * in reloads the same URL, so the visitor lands on the page they asked for.
 */
export default function SitePrivateGate({
  gate,
  lang,
  projectId,
  onSignedIn = () => window.location.reload(),
}: {
  gate?: PrivateSiteGate;
  lang?: string;
  projectId: string;
  /** Runs once signed in; reloading the same URL lands on the page asked for. */
  onSignedIn?: () => void;
}) {
  const locale = resolveLocale(lang ?? gate?.language?.code) ?? 'en';
  const t = siteAccessT(locale);
  const ids = useId();
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>();

  useEffect(() => {
    const token = INVITE_FRAGMENT.exec(window.location.hash)?.[1];
    if (!token) return;
    // Drop the one-time token from the address bar and history.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    try {
      setStep({ kind: 'invite', token: decodeURIComponent(token) });
    } catch {
      // A damaged link: offer the email code instead.
      setStep({ kind: 'email', notice: 'inviteUsed' });
    }
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await action();
    } catch {
      setProblem('privateFailed');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (address: string) =>
    run(async () => {
      const response = await post(`sign-in/${encodeURIComponent(projectId)}/start`, { email: address, lang: locale });
      if (!response.ok) return setProblem(response.status === 429 ? 'privateTooMany' : 'privateFailed');
      setCode('');
      setStep({ kind: 'code', email: address });
    });

  const verify = (address: string) =>
    run(async () => {
      const response = await post(`sign-in/${encodeURIComponent(projectId)}/verify`, { email: address, code });
      if (!response.ok) return setProblem(problemFor(response.status));
      onSignedIn();
    });

  const accept = (token: string) =>
    run(async () => {
      const response = await post('accept', { token });
      if (response.ok) return onSignedIn();
      if (response.status === 429) return setProblem('privateTooMany');
      // A server failure keeps the invitation so the reader can try again; only
      // a refused invitation (used, expired, revoked) falls back to the email code.
      if (response.status >= 500) return setProblem('privateFailed');
      setStep({ kind: 'email', notice: 'inviteUsed' });
    });

  const config = (gate?.config ?? null) as ProjectConfig | null;
  const logo = publishedSiteLogo(config?.branding?.logoLight || null, 'light');
  const name = gate?.name ?? '';
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step.kind === 'email') void sendCode(email.trim());
    else if (step.kind === 'code') void verify(step.email);
    else void accept(step.token);
  };

  return (
    <div
      className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground"
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
      lang={locale}
      style={{ ...projectThemeVariables(config, 'light'), ...projectThemeStyle(config) }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          {logo ? (
            <img alt={name} className="h-9 max-w-[220px] object-contain" src={logo.src} />
          ) : (
            <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
              <Lock aria-hidden className="size-5" />
            </span>
          )}
          <h1 className="mt-6 text-balance font-semibold text-2xl tracking-tight" dir="auto">
            {step.kind === 'invite' ? t('privateInviteTitle', { name }) : t('privateSignInTitle', { name })}
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            {step.kind === 'invite'
              ? t('privateInviteBody')
              : step.kind === 'code'
                ? t('privateCodeSent', { email: step.email })
                : gate?.mode === 'WORKSPACE'
                  ? t('privateTeamBody')
                  : t('privateReadersBody')}
          </p>
        </div>

        <form className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm" onSubmit={onSubmit}>
          {step.kind === 'email' && step.notice === 'inviteUsed' ? (
            <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm" role="status">
              {t('privateInviteUsed')}
            </p>
          ) : null}
          {step.kind === 'email' ? (
            <>
              <Label htmlFor={`${ids}-email`}>{t('privateEmailLabel')}</Label>
              <Input
                autoComplete="email"
                autoFocus
                dir="ltr"
                id={`${ids}-email`}
                inputMode="email"
                maxLength={320}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
              <Button className="mt-1 w-full" disabled={!email.trim()} loading={busy} type="submit">
                {t('privateSendCode')}
              </Button>
            </>
          ) : step.kind === 'code' ? (
            <>
              <Label htmlFor={`${ids}-code`}>{t('privateCodeLabel')}</Label>
              <Input
                autoComplete="one-time-code"
                autoFocus
                className="text-center font-mono text-lg tracking-[0.4em]"
                dir="ltr"
                id={`${ids}-code`}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="\d{6}"
                required
                value={code}
              />
              <Button className="mt-1 w-full" disabled={code.length !== 6} loading={busy} type="submit">
                {t('privateSignIn')}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <button
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  onClick={() => {
                    setProblem(undefined);
                    setStep({ kind: 'email' });
                  }}
                  type="button"
                >
                  {t('privateOtherEmail')}
                </button>
                <button
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void sendCode(step.email)}
                  type="button"
                >
                  {t('privateResend')}
                </button>
              </div>
            </>
          ) : (
            <Button className="w-full" loading={busy} type="submit">
              {t('privateInviteAccept')}
            </Button>
          )}
          {problem ? (
            <p className="text-destructive text-sm" role="alert">
              {t(problem)}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
