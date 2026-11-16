import { useLayoutEffect, useRef } from 'react';
import { useGitWebhookRotate } from '../api/git-webhook-rotate';

type Outcome = {
  /** Asks before rotating (the destructive confirmation); true to rotate. */
  confirm: () => Promise<boolean>;
  /** The new secret is stored and the site's status read back: show the secret once. */
  rotated: (webhookSecret: string | null) => void;
  /** The rotation failed; the error is sanitized (status, a known code and a numeric Retry-After only). */
  failed: (error: unknown) => void;
};

/**
 * Connection → Webhook → Rotate webhook secret, for `projectId`: asks, then sends one rotation per confirmed press.
 *
 * A press belongs to the GitWorkflow that made it, for the site it showed when pressed, in that session. Leaving (a
 * keyed remount, a new session) or the same instance showing another site, before the confirmation or while the
 * rotation runs, retires it: a confirmation then sends nothing, and an answer reports nowhere, so the secret and a
 * toast never reach another site's or account's screen. The request itself is never cancelled or retried, and still
 * refreshes the site it was sent for.
 *
 * `busy` holds while a rotation of the site is in flight in this session, from this GitWorkflow or one mounted before
 * it, until its request and the read after a success end; a confirmed press meanwhile sends nothing.
 *
 * The outcome used is the one passed by the latest render (its language, its state); the secret is passed on, never
 * kept.
 */
export function useGitWebhookRotateCommand(projectId: string, outcome: Outcome) {
  const { rotate, pending } = useGitWebhookRotate(projectId);
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

  const press = async () => {
    const pressedBy = owner.current;
    if (pressedBy?.projectId !== projectId) return;
    const approved = await latest.current.confirm();
    if (!approved || owner.current !== pressedBy) return;
    let rotation: Awaited<ReturnType<typeof rotate>>;
    try {
      rotation = await rotate(pressedBy.projectId);
    } catch (error) {
      if (owner.current === pressedBy) latest.current.failed(error);
      return;
    }
    if (rotation && owner.current === pressedBy) latest.current.rotated(rotation.webhookSecret);
  };

  return { busy: pending, press };
}
