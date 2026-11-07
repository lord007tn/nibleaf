import { useT } from '@nibleaf/i18n/react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAiDraft } from '@/hooks/api';

type AiMode = 'continue' | 'rephrase' | 'outline' | 'summarize';
export type AiAction = AiMode | 'instruction';
type Preview = { mode: AiMode; text: string };
type SessionState = { request: { pageId: string; action: AiAction } | null; previews: Readonly<Record<string, Preview>> };

/** The editor on screen, if any: where a finished draft can be written right away. */
interface MountedEditor {
  pageId: string | null;
  pageTitle: string;
  content: string;
  onContentChange: (next: string) => void;
  /** Opens a page in the editor (a deep link, so it works after the editor was closed too). */
  openPage: (pageId: string) => void;
  /** The AI card is on screen, so a preview there is seen without a toast. */
  cardVisible: boolean;
}

/**
 * One AI session per project. It outlives the editor route, so a draft that
 * lands after the writer has left the editor (or switched page or tab) is kept
 * as a preview for its page instead of being written into an unmounted editor.
 */
class AiAssistSessionStore {
  state: SessionState = { request: null, previews: {} };
  editor: MountedEditor | null = null;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  update(next: Partial<SessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  setPreview(pageId: string, preview: Preview | null) {
    const previews = { ...this.state.previews };
    if (preview) previews[pageId] = preview;
    else delete previews[pageId];
    this.update({ previews });
  }
}

// Keyed by the app's QueryClient (one per app, fresh per test) and project.
const sessions = new WeakMap<QueryClient, Map<string, AiAssistSessionStore>>();
const sessionFor = (queryClient: QueryClient, projectId: string): AiAssistSessionStore => {
  let byProject = sessions.get(queryClient);
  if (!byProject) {
    byProject = new Map();
    sessions.set(queryClient, byProject);
  }
  let store = byProject.get(projectId);
  if (!store) {
    store = new AiAssistSessionStore();
    byProject.set(projectId, store);
  }
  return store;
};

/**
 * The page the AI card works on: none while a page switch is in progress or
 * the open page's content hasn't been hydrated yet, so a draft can never be
 * written into a page other than the one it was asked for.
 */
export const aiAssistPageId = ({
  switching,
  activeId,
  loadedPageId,
  syncedPageId,
}: {
  switching: boolean;
  activeId: string | null;
  loadedPageId: string | undefined;
  syncedPageId: string | undefined;
}): string | null => (!switching && activeId && loadedPageId === activeId && syncedPageId === activeId ? activeId : null);

interface SessionOptions {
  projectId: string;
  /** Null while a page is switching or its content has not been hydrated. See `aiAssistPageId`. */
  pageId: string | null;
  pageTitle: string;
  content: string;
  onContentChange: (next: string) => void;
  openPage: (pageId: string) => void;
}

/** Called by the editor route; the card is a view over the returned session. */
export function useAiAssistSession({ projectId, pageId, pageTitle, content, onContentChange, openPage }: SessionOptions) {
  const t = useT();
  const ai = useAiDraft(projectId);
  const store = sessionFor(useQueryClient(), projectId);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useLayoutEffect(() => {
    store.editor = { pageId, pageTitle, content, onContentChange, openPage, cardVisible: store.editor?.cardVisible ?? false };
  }, [store, pageId, pageTitle, content, onContentChange, openPage]);
  // Leaving the editor: late drafts become previews and are announced, never "added" to nothing.
  useEffect(
    () => () => {
      store.editor = null;
    },
    [store],
  );

  const appendTo = (editor: MountedEditor, text: string) => {
    const trimmed = editor.content.trimEnd();
    editor.onContentChange(trimmed ? `${trimmed}\n\n${text.trim()}` : text.trim());
  };

  const run = async (action: AiAction, instruction?: string) => {
    const editor = store.editor;
    if (!editor?.pageId || store.state.request) return;
    const requestedPageId = editor.pageId;
    const requestedTitle = editor.pageTitle;
    const open = editor.openPage;
    const mode: AiMode = action === 'instruction' ? 'continue' : action;
    store.update({ request: { pageId: requestedPageId, action } });
    let result: Awaited<ReturnType<typeof ai.mutateAsync>>;
    try {
      // Promise continuations survive the card and the route unmounting, unlike mutate's per-call callbacks.
      result = await ai.mutateAsync({ mode, content: editor.content, ...(instruction ? { instruction } : {}) });
    } catch {
      // useAiDraft's meta.errorMessage reports each failure once.
      return;
    } finally {
      store.update({ request: null });
    }
    if (!result.text?.trim()) {
      toast.message(t('editor.ai.empty'));
      return;
    }
    const current = store.editor;
    if ((mode === 'continue' || mode === 'outline') && current?.pageId === requestedPageId) {
      appendTo(current, result.text);
      toast.success(mode === 'outline' ? t('editor.ai.outlineAdded') : t('editor.ai.sectionDrafted'));
      return;
    }
    store.setPreview(requestedPageId, { mode, text: result.text });
    if (current?.pageId === requestedPageId) {
      // Same page, AI card hidden (Comments tab, closed rail or sheet): point to the panel.
      if (!current.cardVisible) toast.message(t('editor.ai.readyInPanel'));
      return;
    }
    // Another page, or the editor was closed: the draft waits on its page.
    toast.message(t('editor.ai.readyOnPage', { title: requestedTitle }), {
      action: {
        label: t('editor.ai.openPage'),
        onClick: () => open(requestedPageId),
      },
    });
  };

  const applyPreview = (replace: boolean) => {
    const editor = store.editor;
    const preview = editor?.pageId ? store.state.previews[editor.pageId] : undefined;
    // A request in flight was asked from the current text; applying an older preview now would undo it.
    if (!editor?.pageId || !preview || store.state.request) return;
    if (replace) editor.onContentChange(preview.text.trim());
    else appendTo(editor, preview.text);
    store.setPreview(editor.pageId, null);
    toast.success(t(replace ? 'editor.ai.replaced' : 'editor.ai.inserted'));
  };

  /** The AI card reports while it's on screen, so previews it shows aren't announced twice. */
  const trackCard = useCallback(() => {
    if (store.editor) store.editor.cardVisible = true;
    return () => {
      if (store.editor) store.editor.cardVisible = false;
    };
  }, [store]);

  const { request, previews } = state;
  return {
    pending: request !== null || pageId === null,
    running: request?.pageId === pageId ? request?.action : null,
    /** A draft for another page is still running, so this page's actions wait. */
    busyElsewhere: request !== null && pageId !== null && request.pageId !== pageId,
    preview: pageId ? (previews[pageId] ?? null) : null,
    run,
    insert: () => applyPreview(false),
    replace: () => applyPreview(true),
    trackCard,
  };
}

export type AiAssistSession = ReturnType<typeof useAiAssistSession>;
