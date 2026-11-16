import type { GitConnectionBody } from '@nibleaf/validators';
import { useLayoutEffect, useRef } from 'react';
import { type GitFirstConnectResult, useGitFirstConnect } from '../api/git-first-connect';

type Outcome = {
  /** The first connection is stored and the site's status read back. `sent` is the body pressed. */
  connected: (result: GitFirstConnectResult, sent: GitConnectionBody) => void;
  /** The Connect failed; the error is sanitized (status and a numeric Retry-After only). */
  failed: (error: unknown) => void;
};

/**
 * Step 3 of the connect wizard, Connect: the first connection of `projectId`,
 * sent once per press with the body as pressed.
 *
 * A press belongs to the GitWorkflow that made it, for the site it showed, in
 * that session. Its own success reads the status back, which shows the
 * connected screen in place of the wizard: that is the same GitWorkflow, so
 * the success still reports there (the one-time webhook secret and
 * `onConnected`). A language change keeps it too. Leaving (a keyed remount, a
 * new session) or the same instance showing another site retires it: its
 * answer then reports nowhere, so the secret and a toast never reach another
 * site's or account's screen. The request itself is never cancelled or
 * retried, and still refreshes the site it was sent for.
 *
 * `busy` holds while a write of the site's connection is in flight in this
 * session, from this GitWorkflow or one mounted before it, until its request
 * and the read after a success end; a press meanwhile sends nothing.
 *
 * The outcome reported is the one passed by the latest render (its language,
 * its state), never the token or the answer kept beyond the call.
 */
export function useGitFirstConnectCommand(projectId: string, outcome: Outcome) {
  const { connect, pending } = useGitFirstConnect(projectId);
  const latest = useRef(outcome);
  useLayoutEffect(() => {
    latest.current = outcome;
  });

  // The GitWorkflow as committed for a site: a new object each time it shows another site or mounts.
  const owner = useRef<{ projectId: string } | null>(null);
  useLayoutEffect(() => {
    const committed = { projectId };
    owner.current = committed;
    return () => {
      if (owner.current === committed) owner.current = null;
    };
  }, [projectId]);

  const press = (body: GitConnectionBody) => {
    const pressedBy = owner.current;
    if (pressedBy?.projectId !== projectId) return;
    connect(projectId, body).then(
      (result) => {
        if (result && owner.current === pressedBy) latest.current.connected(result, body);
      },
      (error: unknown) => {
        if (owner.current === pressedBy) latest.current.failed(error);
      },
    );
  };

  return { busy: pending, press };
}
