import type { MessageKey } from '@nibleaf/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentImportSummary } from '@/hooks/api';
import { useGhostImport } from '../api/ghost-import';
import { ghostImportRefusal, ghostImportRequestBody } from '../model/ghost-import';

/** How one press is reported. Each is called at most once, and only into the view the press started in. */
export type GhostImportReport = {
  /** Refused before anything was sent: the URL, the size, a file that could not be read, or one that is not a JSON object. */
  refused: (message: MessageKey) => void;
  succeeded: (summary: ContentImportSummary) => void;
  failed: (error: unknown) => void;
};

/** One press of Import, from reading the file until its request settles. `reader` is null once the file is read. */
type Owner = { projectId: string; intent: object; reader: FileReader | null };

const detach = (reader: FileReader) => {
  reader.onload = null;
  reader.onerror = null;
  reader.onabort = null;
};

/**
 * Imports the chosen Ghost export into the site. One press owns everything
 * from reading the file to the request settling: another press, in the same
 * tick or later, does nothing until then, and the site's import stays busy
 * while a request for it runs, from any instance.
 *
 * What the press imports (the site, the open Ghost panel, the file and the
 * trimmed URL) is captured when it starts. Changing any of them, or leaving,
 * before the request is sent retires the press: the read is abandoned and
 * nothing is sent. Once sent, the request is never cancelled or retried; its
 * site's pages are refreshed, and its answer is reported only while the Ghost
 * panel it started in still shows (A → B → A is a new panel).
 */
export function useGhostImportCommand({
  projectId,
  open,
  file,
  ghostUrl,
}: {
  projectId: string;
  open: boolean;
  file: File | null;
  ghostUrl: string;
}) {
  const ghost = useGhostImport(projectId);
  const url = ghostUrl.trim();
  const owner = useRef<Owner | null>(null);
  const [ownedFor, setOwnedFor] = useState<string | null>(null);

  // Releases the owner only for the press that holds it.
  const release = useCallback((current: Owner) => {
    if (owner.current !== current) return;
    owner.current = null;
    setOwnedFor(null);
  }, []);

  // The Ghost panel as shown: a new object each time it opens for a site, null while it is closed or the tab is gone.
  const panel = useRef<object | null>(null);
  useEffect(() => {
    if (!open) return;
    const current = { projectId };
    panel.current = current;
    return () => {
      if (panel.current === current) panel.current = null;
    };
  }, [projectId, open]);

  // What a press would import now. A press still reading when this changes is retired.
  const intent = useRef<object | null>(null);
  useEffect(() => {
    if (!open) return;
    const current = { projectId, file, url };
    intent.current = current;
    return () => {
      if (intent.current === current) intent.current = null;
      const preparing = owner.current;
      const reader = preparing?.intent === current ? preparing.reader : null;
      if (!preparing || !reader) return;
      detach(reader);
      preparing.reader = null;
      release(preparing);
      reader.abort();
    };
  }, [projectId, open, file, url, release]);

  const start = (report: GhostImportReport) => {
    if (owner.current?.projectId === projectId || ghost.isPending()) return;
    const startedIn = intent.current;
    const startedPanel = panel.current;
    if (!startedIn || !startedPanel || !file) return;
    const refusal = ghostImportRefusal({ fileSize: file.size, ghostUrl: url });
    if (refusal) {
      report.refused(refusal);
      return;
    }
    const reader = new FileReader();
    const current: Owner = { projectId, intent: startedIn, reader };
    owner.current = current;
    setOwnedFor(projectId);

    // A read that fails or is aborted proves nothing about the file's JSON.
    const readFailed = () => {
      detach(reader);
      current.reader = null;
      release(current);
      if (intent.current === startedIn) report.refused('settings.import.error');
    };
    reader.onerror = readFailed;
    reader.onabort = readFailed;
    reader.onload = () => {
      detach(reader);
      current.reader = null;
      if (intent.current !== startedIn) {
        release(current);
        return;
      }
      const body = ghostImportRequestBody(String(reader.result ?? ''), url);
      if (!body) {
        release(current);
        report.refused('settings.import.ghost.invalidJson');
        return;
      }
      ghost.send({ projectId, body }).then(
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
    reader.readAsText(file);
  };

  return { busy: ownedFor === projectId || ghost.pending, start };
}
