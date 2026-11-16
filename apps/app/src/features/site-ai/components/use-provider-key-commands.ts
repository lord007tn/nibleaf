import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody } from '@nibleaf/validators';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { type ProviderKeyModels, ProviderKeyObsolete, useProviderKeyRequests } from '../api/provider-key';

type Requests = ReturnType<typeof useProviderKeyRequests>;

/**
 * Whether the caller is still committed for the site, the provider and the
 * session's requests it rendered with. `retire` (stable) runs when it no
 * longer is: another site, provider or query client, or an unmount.
 */
function useCommitted(projectId: string, providerId: string, requests: Requests, retire: () => void) {
  const committed = useRef<{ projectId: string; providerId: string; requests: Requests } | null>(null);
  useLayoutEffect(() => {
    const panel = { projectId, providerId, requests };
    committed.current = panel;
    return () => {
      if (committed.current === panel) committed.current = null;
      retire();
    };
  }, [projectId, providerId, requests, retire]);
  return () => committed.current?.projectId === projectId && committed.current.providerId === providerId && committed.current.requests === requests;
}

/**
 * The key panel's Save, for a site and provider. It lives with the panel, not
 * with the form inside it, so the form being replaced by the revision its own
 * Save published doesn't end it: `saved` still runs once the Save (and its
 * readback) is done. Another site or provider, another query client or the
 * panel closing retires it; its outcome still updates the site it was sent
 * for, and its failure is still reported while the session lasts, as before.
 *
 * `isSaving()` is read by a press in the same tick; only `saving` is kept,
 * never a body or an error.
 */
export function useProviderKeySave({ projectId, providerId }: { projectId: string; providerId: string }) {
  const requests = useProviderKeyRequests();
  const current = useRef<object | null>(null);
  const [saving, setSaving] = useState(false);
  const retire = useCallback(() => {
    current.current = null;
    setSaving(false);
  }, []);
  const shown = useCommitted(projectId, providerId, requests, retire);

  const save = (body: SaveWorkspaceAiConnectionBody, saved: () => void, failed: (error: unknown) => void) => {
    if (current.current || !shown()) return;
    const attempt = {};
    current.current = attempt;
    setSaving(true);
    requests.save(projectId, body).then(
      () => {
        if (current.current !== attempt) return;
        current.current = null;
        setSaving(false);
        saved();
      },
      (error: unknown) => {
        if (current.current === attempt) {
          current.current = null;
          setSaving(false);
        }
        if (!(error instanceof ProviderKeyObsolete)) failed(error);
      },
    );
  };

  return { saving, save, isSaving: () => current.current !== null };
}

/**
 * The key form's Check. A press is accepted only while the form is committed
 * for the site and provider it shows, no Check of it runs and `busy()` (a Save)
 * is false, so presses in the same tick send one request.
 *
 * A Check's models belong to the key they were checked with. Editing the key
 * (`retire`, even back to the same value), another site or provider, another
 * query client or the form unmounting retires the Check: its answer then sets
 * no models and reports no failure. A language change keeps it. The request
 * itself is never cancelled or retried; a check of the saved key still
 * refreshes the site it was sent for.
 *
 * `edits()` counts key edits, so a Save's success can tell whether the field
 * still holds what it sent. Only `checking` and the checked models are kept:
 * never the key, a body or an error.
 */
export function useProviderKeyCheck({ projectId, providerId, busy }: { projectId: string; providerId: string; busy: () => boolean }) {
  const requests = useProviderKeyRequests();
  const current = useRef<object | null>(null);
  const edits = useRef(0);
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<ProviderKeyModels['models'] | null>(null);
  const retire = useCallback(() => {
    edits.current += 1;
    current.current = null;
    setChecking(false);
    setModels(null);
  }, []);
  const shown = useCommitted(projectId, providerId, requests, retire);

  const check = (body: WorkspaceAiModelsBody, failed: (error: unknown) => void) => {
    if (current.current || busy() || !shown()) return;
    const attempt = {};
    current.current = attempt;
    setChecking(true);
    setModels(null);
    requests.check(projectId, body).then(
      (answer) => {
        if (current.current !== attempt) return;
        current.current = null;
        setChecking(false);
        setModels(answer.models);
      },
      (error: unknown) => {
        if (current.current !== attempt) return;
        current.current = null;
        setChecking(false);
        if (!(error instanceof ProviderKeyObsolete)) failed(error);
      },
    );
  };

  return { checking, models, check, retire, isChecking: () => current.current !== null, edits: () => edits.current };
}
