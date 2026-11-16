import type { MessageKey } from '@nibleaf/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentImportSummary } from '@/hooks/api';
import { useRepositoryImport } from '../api/repository-import';
import { type RepositoryImportFields, type RepositoryImportProvider, repositoryImportRequest } from '../model/repository-import';

/** How one press is reported. Each is called at most once, and only into the panel the press started in. */
export type RepositoryImportReport = {
  /** Refused before anything was sent: the repository or the source URL. */
  refused: (message: MessageKey) => void;
  succeeded: (summary: ContentImportSummary) => void;
  failed: (error: unknown) => void;
};

/** The provider's panel as shown for a site. */
type Panel = { projectId: string; provider: RepositoryImportProvider };

/**
 * Imports a Mintlify or GitBook repository into the site. One press owns the
 * request until it settles: another press, in the same tick or later, does
 * nothing until then, and the site's import stays busy while a request for it
 * runs, from any instance.
 *
 * What the press imports (the site, the provider and every field, including
 * replaceExisting) is captured when it is pressed. The request is never
 * cancelled or retried; its site is refreshed whatever shows by then, and its
 * answer is reported only while the provider's panel it started in still
 * shows (Mintlify → GitBook → Mintlify, or site A → B → A, is a new panel).
 */
export function useRepositoryImportCommand({ projectId, provider }: { projectId: string; provider: RepositoryImportProvider | null }) {
  const repository = useRepositoryImport(projectId);
  const owner = useRef<{ projectId: string } | null>(null);
  const [ownedFor, setOwnedFor] = useState<string | null>(null);

  // Releases the owner only for the press that holds it.
  const release = useCallback((current: { projectId: string }) => {
    if (owner.current !== current) return;
    owner.current = null;
    setOwnedFor(null);
  }, []);

  // The panel as committed: a new object each time a provider opens for a site, null while none is open or the tab is gone.
  const panel = useRef<Panel | null>(null);
  useEffect(() => {
    if (!provider) return;
    const current = { projectId, provider };
    panel.current = current;
    return () => {
      if (panel.current === current) panel.current = null;
    };
  }, [projectId, provider]);

  const start = (fields: Omit<RepositoryImportFields, 'provider'>, report: RepositoryImportReport) => {
    if (owner.current?.projectId === projectId || repository.isPending()) return;
    const startedPanel = panel.current;
    if (!provider || startedPanel?.projectId !== projectId || startedPanel.provider !== provider) return;
    const { request, refusal } = repositoryImportRequest(projectId, { ...fields, provider });
    if (refusal) {
      report.refused(refusal);
      return;
    }
    const current = { projectId };
    owner.current = current;
    setOwnedFor(projectId);
    repository.send(request).then(
      (summary) => {
        release(current);
        if (panel.current === startedPanel) report.succeeded(summary);
      },
      (error: unknown) => {
        release(current);
        if (panel.current === startedPanel) report.failed(error);
      },
    );
  };

  return { busy: ownedFor === projectId || repository.pending, start };
}
