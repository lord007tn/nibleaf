import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { getSessionGeneration } from '@/integrations/tanstack-query/session-generation';
import { copyToClipboard } from '@/lib/invitations';
import { onSessionCleared } from '@/lib/session-cleared';
import { useGitSettingsWebhookRotate } from '../api/git-settings-webhook-rotate';

type Outcome = {
  /** Rotation succeeded; deliver its one-time answer after the metadata readback attempt. */
  rotated: () => void;
  /** The rotation failed; the error is sanitized (status, a known code and a numeric Retry-After only). */
  failed: (error: unknown) => void;
  copied: (ok: boolean) => void;
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
  const client = useQueryClient();
  const generation = getSessionGeneration(client);
  const { rotate, pending } = useGitSettingsWebhookRotate(projectId);
  const [answer, setAnswer] = useState<{ webhookSecret: string | null; owner: object } | null>(null);
  const [copying, setCopying] = useState(false);
  const latest = useRef(outcome);
  useLayoutEffect(() => {
    latest.current = outcome;
  });

  // The card as committed for a site: a new object each time it shows another site or mounts.
  const owner = useRef<{ projectId: string; client: typeof client; generation: number } | null>(null);
  useLayoutEffect(() => {
    const committed = { projectId, client, generation };
    owner.current = committed;
    setAnswer(null);
    setCopying(false);
    // The listener retains only setters/ownership, never a secret value. State belongs to this panel.
    const unsubscribe = onSessionCleared(() => {
      owner.current = null;
      setAnswer(null);
      setCopying(false);
    });
    return () => {
      unsubscribe();
      if (owner.current === committed) owner.current = null;
    };
  }, [projectId, client, generation]);

  const press = async () => {
    const pressedBy = owner.current;
    if (pressedBy?.projectId !== projectId) return;
    if (!pending) setAnswer((previous) => (previous ? { ...previous, webhookSecret: null } : null));
    const current = () => owner.current === pressedBy && getSessionGeneration(client) === generation;
    let rotated: { webhookSecret: string | null } | null;
    try {
      rotated = await rotate(pressedBy.projectId, current);
    } catch (error) {
      if (current()) latest.current.failed(error);
      return;
    }
    if (rotated && current()) {
      setAnswer({ webhookSecret: rotated.webhookSecret, owner: pressedBy });
      latest.current.rotated();
    }
  };

  const copy = async (text: string) => {
    const pressedBy = owner.current;
    if (pressedBy?.projectId !== projectId) return;
    setCopying(true);
    const ok = await copyToClipboard(text);
    if (owner.current !== pressedBy || getSessionGeneration(client) !== generation) return;
    setCopying(false);
    latest.current.copied(ok);
  };

  const ownsPanel = owner.current?.projectId === projectId && owner.current.client === client && owner.current.generation === generation;
  const ownsAnswer = ownsPanel && answer !== null && answer.owner === owner.current;
  return { busy: pending, press, copy, copying, configured: ownsAnswer, secret: ownsAnswer ? answer.webhookSecret : null };
}
