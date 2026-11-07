import { useT } from '@nibleaf/i18n/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAiDraft } from '@/hooks/api';

type AiMode = 'continue' | 'rephrase' | 'outline' | 'summarize';
export type AiAction = AiMode | 'instruction';
type Preview = { mode: AiMode; text: string };

interface SessionOptions {
  projectId: string;
  /** Null while a page is switching or its content has not been hydrated. */
  pageId: string | null;
  content: string;
  onContentChange: (next: string) => void;
}

/** Owned by the editor route so closing the card never discards a paid draft. */
export function useAiAssistSession({ projectId, pageId, content, onContentChange }: SessionOptions) {
  const t = useT();
  const ai = useAiDraft(projectId);
  const [request, setRequest] = useState<{ pageId: string; action: AiAction } | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const inFlight = useRef(false);
  const latest = useRef({ pageId, content, onContentChange });
  useLayoutEffect(() => {
    latest.current = { pageId, content, onContentChange };
  }, [pageId, content, onContentChange]);

  const appendToDoc = (text: string) => {
    const current = latest.current;
    const trimmed = current.content.trimEnd();
    current.onContentChange(trimmed ? `${trimmed}\n\n${text.trim()}` : text.trim());
  };

  const run = async (action: AiAction, instruction?: string) => {
    const current = latest.current;
    if (!current.pageId || inFlight.current) return;
    const requestedPageId = current.pageId;
    const mode: AiMode = action === 'instruction' ? 'continue' : action;
    inFlight.current = true;
    setRequest({ pageId: requestedPageId, action });
    let result: Awaited<ReturnType<typeof ai.mutateAsync>>;
    try {
      // Promise continuations survive card unmounts, unlike mutate's per-call callbacks.
      result = await ai.mutateAsync({ mode, content: current.content, ...(instruction ? { instruction } : {}) });
    } catch {
      // useAiDraft's meta.errorMessage reports each failure once.
      return;
    } finally {
      inFlight.current = false;
      setRequest(null);
    }
    if (!result.text?.trim()) {
      toast.message(t('editor.ai.empty'));
      return;
    }
    if ((mode === 'continue' || mode === 'outline') && latest.current.pageId === requestedPageId) {
      appendToDoc(result.text);
      toast.success(mode === 'outline' ? t('editor.ai.outlineAdded') : t('editor.ai.sectionDrafted'));
    } else {
      setPreviews((current) => ({ ...current, [requestedPageId]: { mode, text: result.text } }));
    }
  };

  const applyPreview = (replace: boolean) => {
    const currentPageId = latest.current.pageId;
    const preview = currentPageId ? previews[currentPageId] : undefined;
    if (!currentPageId || !preview) return;
    if (replace) latest.current.onContentChange(preview.text.trim());
    else appendToDoc(preview.text);
    setPreviews((current) => {
      const next = { ...current };
      delete next[currentPageId];
      return next;
    });
    toast.success(t(replace ? 'editor.ai.replaced' : 'editor.ai.inserted'));
  };

  return {
    pending: request !== null || pageId === null,
    running: request?.pageId === pageId ? request?.action : null,
    /** A draft for another page is still running, so this page's actions wait. */
    busyElsewhere: request !== null && pageId !== null && request.pageId !== pageId,
    preview: pageId ? (previews[pageId] ?? null) : null,
    run,
    insert: () => applyPreview(false),
    replace: () => applyPreview(true),
  };
}

export type AiAssistSession = ReturnType<typeof useAiAssistSession>;
