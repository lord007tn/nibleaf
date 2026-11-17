import { useLayoutEffect, useRef } from 'react';
import { useGitSettingsWebhookRotate } from '../api/git-settings-webhook-rotate';

type Outcome = {
  /** The new secret is stored and the site's settings read back: reveal it. */
  rotated: () => void;
  /** The rotation failed; the error is sanitized (status, a known code and a numeric Retry-After only). */
  failed: (error: unknown) => void;
};

/**
 * Settings → Git → Deploy on push → Generate / Rotate, for `projectId`: one rotation per press.
 *
 * A press belongs to the card that made it, for the site it showed when pressed, in that session. Leaving (a keyed
 * remount, a new session) or the same card showing another site while the rotation runs retires it: its answer then
 * reports nowhere, so a reveal or a toast never reaches another site's or account's screen. The request itself is
 * never cancelled or retried, and still re-reads the site it was sent for.
 *
 * `busy` holds while a rotation of the site is in flight in this session, from this card or one mounted before it,
 * until its request and the read after a success end; a press meanwhile sends nothing.
 *
 * The outcome used is the one passed by the latest render (its language, its state).
 */
export function useGitSettingsWebhookRotateCommand(projectId: string, outcome: Outcome) {
  const { rotate, pending } = useGitSettingsWebhookRotate(projectId);
  const latest = useRef(outcome);
  useLayoutEffect(() => {
    latest.current = outcome;
  });

  // The card as committed for a site: a new object each time it shows another site or mounts.
  const owner = useRef<{ projectId: string } | null>(null);
  useLayoutEffect(() => {
    const committed = { projectId };
    owner.current = committed;
    return () => {
      if (owner.current === committed) owner.current = null;
    };
  }, [projectId]);

  const press = async () => {
    const pressedBy = owner.current;
    if (pressedBy?.projectId !== projectId) return;
    let rotated: boolean;
    try {
      rotated = await rotate(pressedBy.projectId);
    } catch (error) {
      if (owner.current === pressedBy) latest.current.failed(error);
      return;
    }
    if (rotated && owner.current === pressedBy) latest.current.rotated();
  };

  return { busy: pending, press };
}
