import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { type GitIdentity, useGitAuthorization } from '../api/git-authorization';

/** The connect wizard as committed for a site: a new object each time it shows. */
type Wizard = { projectId: string };

/**
 * Step 1 of the connect wizard, Authorize GitHub: the identity check of the
 * typed token. Each wizard has one current check. A press is accepted only
 * while the wizard shows and no check of it is current, so presses in the same
 * tick send one request. Other wizards, mounted or departed, never make it wait.
 *
 * A press sends the token as typed for the site shown. Editing the token
 * (`retire`, even back to the same value), another site, or the wizard giving
 * way to the loading, error or connected screen retires the check: its answer
 * then neither reports a failure nor goes on with the account. The wizard's
 * retirement happens in the commit that hides it, before any answer can run.
 * A language change keeps the check. The request itself is never cancelled or
 * retried, and a success refreshes the site it was sent for.
 *
 * Only `busy` and `failed` are kept: never the token, the answer's body or the
 * error, so a refusal that echoes the token is reported without it.
 *
 * `shown`: whether the wizard shows.
 */
export function useGitAuthorizationCommand({ projectId, shown }: { projectId: string; shown: boolean }) {
  const send = useGitAuthorization();
  const current = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const retire = useCallback(() => {
    current.current = null;
    setBusy(false);
    setFailed(false);
  }, []);

  const wizard = useRef<Wizard | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const committed = { projectId };
    wizard.current = committed;
    return () => {
      if (wizard.current === committed) wizard.current = null;
      retire();
    };
  }, [projectId, shown, retire]);

  const verify = (token: string, verified: (identity: GitIdentity) => void) => {
    if (current.current || wizard.current?.projectId !== projectId) return;
    const attempt = {};
    current.current = attempt;
    setBusy(true);
    setFailed(false);
    const settled = (outcome: () => void) => {
      if (current.current !== attempt) return;
      current.current = null;
      setBusy(false);
      outcome();
    };
    send(projectId, token).then(
      (identity) => settled(() => (identity ? verified(identity) : undefined)),
      () => settled(() => setFailed(true)),
    );
  };

  return { busy, failed, verify, retire };
}
