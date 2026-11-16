import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody } from '@nibleaf/validators';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { type ProviderKeyModels, ProviderKeyObsolete, useProviderKeyRequests } from '../api/provider-key';

/** The key form as committed for a site, a provider and the session's requests: a new object each time any changes. */
type Panel = { projectId: string; providerId: string; requests: ReturnType<typeof useProviderKeyRequests> };

/**
 * The key form's Check and Save. One of them runs at a time: a press is
 * accepted only while the form is committed for the site and provider it
 * shows and nothing of it is running, so presses in the same tick send one
 * request.
 *
 * A Check's models belong to the key they were checked with. Editing the key
 * (`retire`, even back to the same value), another site or provider, another
 * query client or the form unmounting retires the Check: its answer then sets
 * no models and reports no failure. A language change keeps it. The request
 * itself is never cancelled or retried; a check of the saved key still
 * refreshes the site it was sent for.
 *
 * A Save is retired only by another site or provider, another query client or
 * the form unmounting; its outcome still updates the site it was sent for, and
 * its failure is still reported while the session lasts, as before. A success
 * clears the key only if it hasn't been edited since the press.
 *
 * Only `checking`, `saving` and the checked models are kept: never the key,
 * a body or an error.
 */
export function useProviderKeyCommands({ projectId, providerId }: { projectId: string; providerId: string }) {
  const requests = useProviderKeyRequests();
  const check = useRef<object | null>(null);
  const save = useRef<object | null>(null);
  /** Counts key edits, so a Save's success can tell whether the field still holds what it sent. */
  const edits = useRef(0);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ProviderKeyModels['models'] | null>(null);

  const retire = useCallback(() => {
    edits.current += 1;
    check.current = null;
    setChecking(false);
    setModels(null);
  }, []);

  const panel = useRef<Panel | null>(null);
  useLayoutEffect(() => {
    const committed = { projectId, providerId, requests };
    panel.current = committed;
    return () => {
      if (panel.current === committed) panel.current = null;
      check.current = null;
      save.current = null;
      setChecking(false);
      setSaving(false);
      setModels(null);
    };
  }, [projectId, providerId, requests]);

  const shown = () => panel.current?.projectId === projectId && panel.current.providerId === providerId && panel.current.requests === requests;

  const runCheck = (body: WorkspaceAiModelsBody, failed: (error: unknown) => void) => {
    if (check.current || save.current || !shown()) return;
    const attempt = {};
    check.current = attempt;
    setChecking(true);
    setModels(null);
    requests.check(projectId, body).then(
      (answer) => {
        if (check.current !== attempt) return;
        check.current = null;
        setChecking(false);
        setModels(answer.models);
      },
      (error: unknown) => {
        if (check.current !== attempt) return;
        check.current = null;
        setChecking(false);
        if (!(error instanceof ProviderKeyObsolete)) failed(error);
      },
    );
  };

  const runSave = (body: SaveWorkspaceAiConnectionBody, saved: (keyUnchanged: boolean) => void, failed: (error: unknown) => void) => {
    if (check.current || save.current || !shown()) return;
    const attempt = {};
    const pressedAt = edits.current;
    save.current = attempt;
    setSaving(true);
    requests.save(projectId, body).then(
      () => {
        if (save.current !== attempt) return;
        save.current = null;
        setSaving(false);
        saved(edits.current === pressedAt);
      },
      (error: unknown) => {
        if (save.current === attempt) {
          save.current = null;
          setSaving(false);
        }
        if (!(error instanceof ProviderKeyObsolete)) failed(error);
      },
    );
  };

  return { checking, saving, models, check: runCheck, save: runSave, retire };
}
