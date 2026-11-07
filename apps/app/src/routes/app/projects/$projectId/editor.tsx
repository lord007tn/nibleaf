import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { cn } from '@nibleaf/design-system/lib/utils';
import { isRtl } from '@nibleaf/i18n';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { useDebouncer } from '@tanstack/react-pacer';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  FolderPlus,
  Languages,
  Layers,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ActiveBranchContext } from '@/components/editor/active-branch-context';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import { AiAssist } from '@/components/editor/ai-assist';
import { BranchSwitcher } from '@/components/editor/branch-switcher';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { deepLinkBranchDecision, publishedVersionSlugFor } from '@/components/editor/docs-version';
import { ConfigCanvas, EmptyCanvas, GroupCanvas, PageCanvasSkeleton, PageLoadFailedCanvas } from '@/components/editor/editor-canvas-states';
import { nextHydration, type ServerSnapshot, shouldAutosave, shouldFlushDraft } from '@/components/editor/editor-draft';
import { resolveEditorLayout } from '@/components/editor/editor-layout';
import { createEditorSaveQueue, type PageDraft } from '@/components/editor/editor-save-queue';
import { LanguageSettingsDialog } from '@/components/editor/language-settings-dialog';
import { MarkdownSourceEditor } from '@/components/editor/markdown-source-editor';
import { PageSettingsDialog } from '@/components/editor/page-settings-dialog';
import { focusBodyStart, PageTitleField } from '@/components/editor/page-title-field';
import { isSwitchSettled, messageInLanguage, type PendingSwitch, subtreeIds, titleSlugToFollow } from '@/components/editor/page-tree-utils';
import { NeverPublishedBanner, PagePublishStateBar, SaveStatus } from '@/components/editor/save-status';
import { type ConfigSectionId, ConfigSectionList } from '@/components/editor/site-config-panel';
import { SortablePageTree } from '@/components/editor/sortable-page-tree';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { detectUnsupportedMdxTags } from '@/components/editor/unsupported-mdx';
import { aiAssistPageId, useAiAssistSession } from '@/components/editor/use-ai-assist-session';
import { useDeletePageFlow } from '@/components/editor/use-delete-page';
import { useMediaQuery } from '@/components/editor/use-media-query';
import type { Deployment, Language, PageNode } from '@/hooks/api';
import {
  addressMayFollowTitle,
  friendlyErrorMessage,
  pageNeverPublished,
  pagePublishState,
  queryKeys,
  useAiDraftCapability,
  useBranches,
  useComments,
  useCreatePage,
  useLanguages,
  usePage,
  usePages,
  usePendingChanges,
  useProject,
  useProjectMembers,
  useReorderPages,
  useUpdatePage,
  useUploadAsset,
} from '@/hooks/api';
import { aiDraftCapabilityQueryOptions, commentsQueryOptions, pageQueryOptions, projectMembersQueryOptions } from '@/hooks/api/query-options';
import { prefetchScopedPages } from '@/hooks/api/route-prefetch';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { PublishControl } from '@/layouts/project';
import { draftPreviewHref } from '@/lib/draft-preview';
import { recordFirstPublishStage } from '@/lib/first-publish-activation';
import { typographyVars } from '@/lib/typography';
import { useSession } from '@/services/auth-client';

export const Route = createFileRoute('/app/projects/$projectId/editor')({
  // Deep links from the dashboard: `?page=<id>` opens a specific page (e.g. a
  // publish-check issue), `?publish=true` opens the publish flow directly.
  validateSearch: (search) =>
    z
      .object({
        firstPublish: z.preprocess((value) => (value === true || value === 'true' || value === '1' ? true : undefined), z.literal(true).optional()),
        page: z.string().min(1).optional().catch(undefined),
        publish: z.preprocess((value) => (value === true || value === 'true' || value === '1' ? true : undefined), z.literal(true).optional()),
      })
      .parse(search),
  loaderDeps: ({ search: { page } }) => ({ page }),
  // The parent route prefetches the site, languages, branches and publishes. This
  // adds the page tree (every language, default branch), the site's AI drafting
  // capability and, for a deep link, the page and its comments. The pending-changes
  // check is left to the component: it is always stale, so a prefetch would only
  // fetch it twice.
  loader: ({ context: { queryClient }, params: { projectId }, deps: { page } }) => {
    prefetchScopedPages(queryClient, projectId, { languageId: 'all' });
    prefetchRouteData(queryClient, aiDraftCapabilityQueryOptions(projectId));
    prefetchRouteData(queryClient, projectMembersQueryOptions(projectId));
    if (page) {
      prefetchRouteData(queryClient, pageQueryOptions(projectId, page));
      prefetchRouteData(queryClient, commentsQueryOptions(projectId, page));
    }
  },
  component: EditorPage,
});

function EditorPage() {
  const t = useT();
  const { projectId } = Route.useParams();
  const { firstPublish, page: pageParam, publish: publishParam } = Route.useSearch();
  const { data: project } = useProject(projectId);
  const { data: memberData, isPending: membersPending } = useProjectMembers(projectId);
  const { data: session, isPending: sessionPending } = useSession();
  const currentMember = memberData?.members.find((member) => member.user.id === session?.user.id);
  const permissionsPending = membersPending || sessionPending;
  const canManageSettings = !permissionsPending && canAdminister(currentMember?.role ?? '');
  // AI assist follows this site's own drafting capability (its Smart AI
  // connection or the instance key), not the instance-wide public flag. Disabled
  // and quota states keep the tab: the panel explains them when a draft is
  // refused. Only a site with no way to draft hides it. While the capability
  // loads, the tab keeps its place as a placeholder: unknown is not "no".
  const aiCapability = useAiDraftCapability(projectId);
  const aiAssist = aiCapability.isPending ? 'loading' : aiCapability.data && aiCapability.data.reason !== 'not_configured' ? 'shown' : 'hidden';
  const aiDraft = aiAssist === 'shown';
  const aiTabs = aiAssist !== 'hidden';

  useEffect(() => {
    if (firstPublish && project) void recordFirstPublishStage('editor_entered');
  }, [firstPublish, project]);

  // Top-level editor view: writing content vs. configuring the whole site.
  const [view, setView] = useState<'content' | 'config'>('content');
  const [configSection, setConfigSection] = useState<ConfigSectionId>('branding');

  // ─── Branches: the editor works on one branch at a time (default 'main') ─────
  const { data: branches } = useBranches(projectId);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  useEffect(() => {
    if (!branches || branches.length === 0 || activeBranchId) {
      return;
    }
    const fallback = branches.find((b) => b.isDefault) ?? branches[0];
    if (fallback) {
      setActiveBranchId(fallback.id);
    }
  }, [branches, activeBranchId]);

  // ─── Data: all languages + all pages on the active branch (every language) ───
  const { data: languages } = useLanguages(projectId);
  const { data: allPages, isPending } = usePages(projectId, undefined, activeBranchId ?? undefined);
  const createPage = useCreatePage(projectId);
  const updatePage = useUpdatePage(projectId);
  const uploadAsset = useUploadAsset(projectId);
  const reorderPages = useReorderPages(projectId);
  const deletePageFlow = useDeletePageFlow(projectId, allPages);
  // What the next publish would change. Shared with the Publish button (same
  // query); autosave, create, delete and reorder invalidate it.
  const { data: pendingChanges } = usePendingChanges(projectId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { locale } = useLocale();
  const uiDir = isRtl(locale) ? 'rtl' : 'ltr';
  // The comments/AI rail is a column at xl; below that it opens as a sheet.
  const wideLayout = useMediaQuery('(min-width: 1280px)');
  const [railSheetOpen, setRailSheetOpen] = useState(false);
  const configDirtySources = useRef(new Set<string>());
  const reportConfigDirty = useCallback((source: string, dirty: boolean) => {
    if (dirty) configDirtySources.current.add(source);
    else configDirtySources.current.delete(source);
  }, []);
  const guardConfigChanges = async () => {
    if (configDirtySources.current.size === 0) return true;
    return confirm({
      title: t('settings.chrome.scope.discardTitle'),
      description: t('settings.config.discardDescription'),
      confirmLabel: t('settings.chrome.scope.discardConfirm'),
      destructive: true,
    });
  };

  // Upload an image (paste/drop/pick) and return its hosted URL for the editor.
  const onUploadImage = async (
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
    onFinishing?: () => void,
  ): Promise<string | null> => (await uploadAsset.mutateAsync({ file, onProgress, signal, onFinishing })).url;

  // Languages ordered default-first, then by position; pages grouped per language.
  const orderedLanguages = useMemo<Language[]>(
    () => [...(languages ?? [])].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.position - b.position),
    [languages],
  );
  const pagesByLanguage = useMemo(() => {
    const map = new Map<string, PageNode[]>();
    for (const page of allPages ?? []) {
      const list = map.get(page.languageId) ?? [];
      list.push(page);
      map.set(page.languageId, list);
    }
    return map;
  }, [allPages]);
  const defaultLanguageId = orderedLanguages[0]?.id ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(pageParam ?? null);
  // A page switch or creation in progress. Until the target is on screen the
  // canvas shows a loading state instead of the page being left, so nothing
  // typed during a slow switch can land in the wrong article.
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  // A freshly created page whose title should receive focus once it renders.
  const [focusTitleFor, setFocusTitleFor] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const firstPageId = useMemo(() => (allPages ?? []).find((p) => p.kind === 'PAGE')?.id ?? null, [allPages]);
  const selectedNode = useMemo(() => (allPages ?? []).find((p) => p.id === selectedId) ?? null, [allPages, selectedId]);
  const selectedGroup = selectedNode?.kind === 'GROUP' ? selectedNode : null;
  const activeId = selectedGroup ? null : (selectedId ?? firstPageId);
  const activeTreeId = selectedId ?? activeId;

  const pageQuery = usePage(projectId, activeId ?? undefined);
  const page = pageQuery.data;
  // The switch is over once its target is selected and on screen.
  if (pendingSwitch && isSwitchSettled(pendingSwitch, { selectedId, groupId: selectedGroup?.id ?? null, pageId: page?.id ?? null })) {
    setPendingSwitch(null);
  }
  // The page on screen failed to load (deleted elsewhere, a stale link or
  // bookmark, offline…). This covers the first page of a visit and deep links as
  // well as a switch: the canvas says so, with Retry and the page list, instead
  // of spinning (or staying locked) forever.
  const pageLoadFailed = Boolean(activeId) && !page && pageQuery.isError;
  if (pageLoadFailed && pendingSwitch?.kind === 'open' && pendingSwitch.id === activeId) {
    setPendingSwitch(null);
  }
  const switching = pendingSwitch !== null;

  // Is the open page live as it is now? Unknown (no state shown) until the
  // pending-changes answer arrives, including right after a publish went live.
  const siteNeverPublished = pendingChanges?.hasBaseline === false;
  const pageState = page ? pagePublishState(page.id, pendingChanges) : null;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [requestedRailTab, setRailTab] = useState<'comments' | 'ai'>('comments');
  const railTab = aiDraft ? requestedRailTab : 'comments';
  // The comments/AI rail starts closed (an empty "No comments yet" panel would
  // otherwise claim 300px on the first visit); the author's toggle is persisted.
  const [railOpen, setRailOpen] = useState(false);
  const railLabel = (wideLayout ? railOpen : railSheetOpen)
    ? t(aiTabs ? 'editor.hideRail' : 'editor.hideComments')
    : t(aiTabs ? 'editor.showRail' : 'editor.showComments');
  useEffect(() => {
    try {
      setRailOpen(window.localStorage.getItem('nibleaf.editor.railOpen') === '1');
    } catch {
      // Keep the default layout when storage is unavailable.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('nibleaf.editor.railOpen', railOpen ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  }, [railOpen]);
  // Figma-style comment mode: click a block to anchor a comment; the rail shows the
  // threads. Comment mode is review-only (the editor goes non-editable).
  const [commentMode, setCommentMode] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<{ quote: string; from: number; to: number } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // How the page body is edited. The visual editor is the default; "wysiwyg" is
  // the same editor with a fixed formatting toolbar (a remembered preference),
  // and Markdown source is an advanced, per-visit choice from the "…" menu —
  // never remembered, so one accidental click doesn't stick across sessions.
  // Preview is deliberately an action, not an editing mode: it opens the current
  // unpublished draft in its own tab through the authenticated preview route.
  const [editorMode, setEditorMode] = useState<'visual' | 'wysiwyg' | 'markdown'>('visual');
  // Leaving source mode returns to the writer's remembered visual preference.
  const [visualMode, setVisualMode] = useState<'visual' | 'wysiwyg'>('visual');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('nibleaf.editor.contentMode') === 'wysiwyg' ? 'wysiwyg' : 'visual';
      setEditorMode(stored);
      setVisualMode(stored);
    } catch {
      // Keep the default content mode when storage is unavailable.
    }
  }, []);
  // Unknown JSX components are represented by local opaque nodes. Inventory
  // them for the explanatory banner without locking the rest of the page.
  const unsupportedTags = useMemo(() => detectUnsupportedMdxTags(content), [content]);
  const effectiveMode = editorMode;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [addLangOpen, setAddLangOpen] = useState(false);
  // The page whose settings dialog is open — independent of the active editor
  // page, so opening a page's settings from the tree does NOT switch what you're
  // editing.
  const [settingsForId, setSettingsForId] = useState<string | null>(null);
  const [langSettings, setLangSettings] = useState<Language | null>(null);
  // What's currently in sync with the server for the open page: its id + the
  // exact title/content we last loaded (or saved) and its revision stamp. Drives
  // re-seeding so the editor recovers when the server copy changes — without
  // clobbering edits — and pins autosaves to the page the draft was loaded from.
  const [synced, setSynced] = useState<ServerSnapshot | null>(null);

  // Resizable left sidebar (persisted). Clamp to a sensible range.
  const [sidebarWidth, setSidebarWidth] = useState(260);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem('nibleaf.editor.sidebarWidth'));
      setSidebarWidth(stored >= 200 && stored <= 520 ? stored : 260);
    } catch {
      // Keep the default width when storage is unavailable.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('nibleaf.editor.sidebarWidth', String(sidebarWidth));
    } catch {
      // Layout persistence is optional.
    }
  }, [sidebarWidth]);
  useEffect(() => {
    if (editorMode === 'markdown') return;
    try {
      window.localStorage.setItem('nibleaf.editor.contentMode', editorMode);
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, [editorMode]);
  // Collapse the page-tree sidebar to give the canvas full width (Mintlify-style;
  // the toggle lives in the editor toolbar, not a breadcrumb). Persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem('nibleaf.editor.sidebarCollapsed') === '1');
    } catch {
      // Keep navigation visible when storage is unavailable.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem('nibleaf.editor.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  }, [sidebarCollapsed]);
  // On narrow viewports the page tree behaves as an on-demand drawer instead
  // of permanently consuming the editor canvas.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Which per-language sections are collapsed in the page tree. Persisted.
  const [collapsedLangs, setCollapsedLangs] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') {
      return new Set();
    }
    try {
      const raw = window.localStorage.getItem('nibleaf.editor.collapsedLangs');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const persistLangs = (set: Set<string>) => {
    try {
      window.localStorage.setItem('nibleaf.editor.collapsedLangs', JSON.stringify([...set]));
    } catch {
      // ignore storage failures
    }
  };
  const toggleLang = (id: string) => {
    const next = new Set(collapsedLangs);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCollapsedLangs(next);
    persistLangs(next);
  };
  // Adding a page/group to a collapsed language auto-expands it so the new node shows.
  const expandLang = (id: string) => {
    if (!collapsedLangs.has(id)) {
      return;
    }
    const next = new Set(collapsedLangs);
    next.delete(id);
    setCollapsedLangs(next);
    persistLangs(next);
  };

  // The active page's language drives the editor/preview text direction.
  const activeLanguage = useMemo(() => languages?.find((l) => l.id === page?.languageId), [languages, page?.languageId]);
  const activeLangDir: 'ltr' | 'rtl' = activeLanguage?.direction === 'RTL' ? 'rtl' : 'ltr';

  // Load the selected page into the local draft. Re-seed when switching pages, OR
  // when a NEWER server copy arrives while the draft is still clean (matches what
  // we last loaded/saved) — so an external update, a branch reload, or a
  // stale→fresh cache transition refreshes the editor without ever clobbering
  // unsaved edits. This runs during render (React's "adjust state while
  // rendering" pattern) rather than in an effect so no frame is ever committed
  // with a draft that belongs to a different page than `page`: the editor below
  // is keyed by page id and mounts straight onto the right document, and the
  // autosave effect can never observe the previous page's body under the new id.
  const hydration = nextHydration({ synced, draft: { title, content } }, page);
  if (hydration) {
    setSynced(hydration);
    setTitle(hydration.title);
    setContent(hydration.content);
    setStatus('idle');
  }

  const navigate = Route.useNavigate();
  // A deep link, so the "Open page" action on a finished draft also works after the editor was closed.
  const openPageForAi = useCallback(
    (id: string) => void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { page: id } }),
    [navigate, projectId],
  );
  const aiAssistSession = useAiAssistSession({
    projectId,
    pageId: aiAssistPageId({ switching, activeId, loadedPageId: page?.id, syncedPageId: synced?.id }),
    pageTitle: title,
    content,
    onContentChange: setContent,
    openPage: openPageForAi,
  });
  const draftRef = useRef({ synced, draft: { title, content }, page });
  const updatePageRef = useRef(updatePage);
  // Read the publish state straight from the query cache at save time: a publish
  // that just went live (or is still running) must stop the address from following
  // the title even before this component re-renders with the new answer.
  const addressFollowsTitleRef = useRef<(pageId: string) => boolean>(() => false);
  // The freshest server copy we know of (a save response can be newer than the
  // detail query, which refetches after it).
  const lastSavedRef = useRef<PageNode | null>(null);
  useLayoutEffect(() => {
    draftRef.current = { synced, draft: { title, content }, page };
    updatePageRef.current = updatePage;
    addressFollowsTitleRef.current = (pageId: string) => addressFollowsTitle(queryClient, projectId, pageId);
  }, [synced, title, content, page, updatePage, queryClient, projectId]);
  const saveQueue = useMemo(
    () =>
      createEditorSaveQueue(async (draft: PageDraft) => {
        try {
          // An unpublished page's address keeps following its title.
          const server = freshestServerCopy(draft.id, draftRef.current.page, lastSavedRef.current);
          const slug = server
            ? titleSlugToFollow({
                slug: server.slug,
                serverTitle: server.title,
                nextTitle: draft.title,
                unpublished: addressFollowsTitleRef.current(draft.id),
              })
            : undefined;
          const saved = await updatePageRef.current.mutateAsync({
            pageId: draft.id,
            body: { title: draft.title, content: draft.content, ...(slug ? { slug } : {}) },
          });
          lastSavedRef.current = saved;
          setSynced((current) => (current?.id === draft.id ? { ...draft, updatedAt: saved.updatedAt } : current));
          const latest = draftRef.current;
          if (latest.synced?.id === draft.id) {
            setStatus(latest.draft.title === draft.title && latest.draft.content === draft.content ? 'saved' : 'saving');
          }
          return saved;
        } catch (error) {
          if (draftRef.current.synced?.id === draft.id) setStatus('error');
          throw error;
        }
      }),
    [],
  );
  const saveDraft = useDebouncer(
    (draft: PageDraft) => {
      void saveQueue.save(draft).catch(() => undefined);
    },
    { wait: 700, onUnmount: (debouncer) => debouncer.flush() },
  );

  // Hydration pins every draft to its page, including intentional empty bodies.
  useEffect(() => {
    if (!page || !shouldAutosave({ synced, draft: { title, content } }, page)) {
      // Undoing back to the server copy must cancel an older queued draft.
      saveDraft.cancel();
      return;
    }
    setStatus('saving');
    saveDraft.maybeExecute({ id: page.id, title, content });
  }, [title, content, page, synced, saveDraft]);

  const flushCurrentDraft = async () => {
    saveDraft.cancel();
    let current = draftRef.current;
    if (!current.page || current.synced?.id !== current.page.id) {
      await saveQueue.settled();
      return;
    }
    // The author can undo to the original value while an older save is still
    // in flight. Persist that final value after the request, even though it
    // currently compares clean with the old hydration snapshot.
    if (!shouldFlushDraft(current, current.page, saveQueue.hasPending(), status === 'error')) {
      await saveQueue.settled();
      return;
    }
    const pageId = current.page.id;
    // Typing while a slow request runs must also reach the server before a
    // navigation or publish can proceed.
    for (;;) {
      const snapshot: PageDraft = { id: pageId, ...current.draft };
      setStatus('saving');
      await saveQueue.save(snapshot);
      current = draftRef.current;
      if (current.page?.id !== snapshot.id || (current.draft.title === snapshot.title && current.draft.content === snapshot.content)) return;
      saveDraft.cancel();
    }
  };

  const transitionInFlight = useRef(false);
  const runAfterSavingDraft = async ({ action, onError }: { action: () => void; onError?: () => void }) => {
    if (transitionInFlight.current) return;
    transitionInFlight.current = true;
    try {
      await flushCurrentDraft();
      action();
    } catch {
      toast.error(t('editor.saveError'));
      onError?.();
    } finally {
      transitionInFlight.current = false;
    }
  };

  useBlocker({
    shouldBlockFn: async () => {
      try {
        await flushCurrentDraft();
        return !(await guardConfigChanges());
      } catch {
        toast.error(t('editor.saveError'));
        return true;
      }
    },
    enableBeforeUnload: () => shouldAutosave(draftRef.current, draftRef.current.page) || status === 'saving' || configDirtySources.current.size > 0,
  });

  const configIsSaved = () => {
    if (configDirtySources.current.size === 0) return true;
    toast.error(t('editor.saveConfigFirst'));
    return false;
  };
  const preparePublish = async () => {
    if (!configIsSaved()) return false;
    await flushCurrentDraft();
    return configIsSaved();
  };

  const openDraftPreview = async () => {
    if (!configIsSaved()) return;
    // Open synchronously so browsers treat this as a user-initiated popup. We
    // navigate it only after the current draft is safely stored server-side.
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow) {
      toast.error(t('editor.previewPopupBlocked'));
      return;
    }
    previewWindow.opener = null;

    const previewUrl = draftPreviewHref(projectId, {
      branchId: activeBranchId ?? undefined,
      languageId: page?.languageId,
      pageId: page?.id,
    });

    try {
      await flushCurrentDraft();
      if (!configIsSaved()) {
        previewWindow.close();
        return;
      }
      previewWindow.location.replace(previewUrl);
    } catch {
      previewWindow.close();
      toast.error(t('editor.previewSaveError'));
    }
  };

  const branchScope = activeBranchId ? { branchId: activeBranchId } : {};
  // React Query's pending state only appears on the next render. The ref closes
  // the same-frame double-click window immediately, so a slow request can never
  // create two pages or groups from repeated clicks.
  const creationInFlight = useRef(false);
  const languageCodeOf = (languageId: string) => orderedLanguages.find((lang) => lang.id === languageId)?.code;
  /** Lock the canvas, save the page being left, then run the switch. */
  const beginSwitch = (next: PendingSwitch, action: () => void) => {
    if (transitionInFlight.current) return;
    setPendingSwitch(next);
    void runAfterSavingDraft({ action, onError: () => setPendingSwitch(null) });
  };
  // True while a new page (not a group) is being created and its title will take focus.
  const bufferTitleKeys = useRef(false);
  const createAndOpen = (body: Parameters<typeof createPage.mutate>[0], options?: { focusTitle?: boolean }) => {
    if (creationInFlight.current || transitionInFlight.current) return;
    bufferTitleKeys.current = options?.focusTitle === true;
    beginSwitch({ kind: 'create' }, () => {
      creationInFlight.current = true;
      createPage.mutate(body, {
        onSuccess: (created) => {
          setPendingSwitch({ kind: 'open', id: created.id });
          setSelectedId(created.id);
          if (options?.focusTitle) setFocusTitleFor(created.id);
        },
        onError: (error) => {
          setPendingSwitch(null);
          toast.error(friendlyErrorMessage(t, error, 'editor.createFailed'));
        },
        onSettled: () => {
          creationInFlight.current = false;
        },
      });
    });
  };
  const addPage = (parentId: string | null, languageId: string) =>
    createAndOpen(
      // Placeholder title in the PAGE's language with a pinned 'untitled' slug: the
      // address then follows the real title until the page is first published.
      {
        title: messageInLanguage('editor.untitled', languageCodeOf(languageId), t),
        slug: 'untitled',
        parentId,
        languageId,
        ...branchScope,
      },
      { focusTitle: true },
    );
  // A group only needs a name, so ask for it instead of opening every page setting.
  const addGroup = async (languageId: string) => {
    if (creationInFlight.current || transitionInFlight.current) return;
    const name = await prompt({
      title: t('editor.newGroup'),
      description: t('editor.groupNameHint'),
      label: t('editor.groupName'),
      initialValue: messageInLanguage('editor.newGroup', languageCodeOf(languageId), t),
      confirmLabel: t('editor.createGroup'),
    });
    if (!name) return;
    createAndOpen({ title: name.slice(0, 200), kind: 'GROUP', languageId, ...branchScope });
  };
  const openNode = (id: string) => {
    if (id === activeTreeId) return;
    beginSwitch({ kind: 'open', id }, () => setSelectedId(id));
  };
  // Follow ?page= deep links (command palette, overview, publish issues) even when
  // the editor is already mounted. The first value seeds the selection; later
  // changes go through the same locked switch as a click in the page list, so the
  // page being left is saved first and can't receive keystrokes meant for the next.
  const handledPageParam = useRef(pageParam);
  // The page a deep link asked for, until it has loaded. The palette and overview
  // list default-version pages, so the link can point into another docs version
  // than the one on screen; follow the page's version then. Normal tree navigation
  // never sets this, so a page left over from the previous version can't flip back.
  const deepLinkedPageId = useRef<string | null>(pageParam ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to the URL param only; openNode is recreated every render.
  useEffect(() => {
    if (!pageParam || pageParam === handledPageParam.current) return;
    handledPageParam.current = pageParam;
    deepLinkedPageId.current = pageParam;
    openNode(pageParam);
  }, [pageParam]);
  useEffect(() => {
    const decision = deepLinkBranchDecision({ deepLinkedPageId: deepLinkedPageId.current, page, activeBranchId, branches });
    if (decision.kind === 'wait') return;
    deepLinkedPageId.current = null;
    if (decision.kind === 'switch') setActiveBranchId(decision.branchId);
  }, [page, activeBranchId, branches]);
  const renameNode = (id: string, nextTitle: string, field: 'title' | 'sidebarTitle' = 'title') => {
    const node = (allPages ?? []).find((p) => p.id === id);
    // A page with its own sidebar title shows that name in the list, so renaming
    // the row changes that name (the page title stays as it is).
    if (field === 'sidebarTitle') {
      if (!node) return;
      updatePage.mutate(
        { pageId: id, body: { config: { ...node.config, sidebarTitle: nextTitle } } },
        { onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.renameFailed')) },
      );
      return;
    }
    // The open page renames through its draft, so the editor and autosave agree.
    if (id === activeId && synced?.id === id) {
      setTitle(nextTitle);
      return;
    }
    if (!node) return;
    const slug = titleSlugToFollow({
      slug: node.slug,
      serverTitle: node.title,
      nextTitle,
      unpublished: addressFollowsTitle(queryClient, projectId, id),
    });
    updatePage.mutate(
      { pageId: id, body: { title: nextTitle, ...(slug ? { slug } : {}) } },
      { onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.renameFailed')) },
    );
  };
  const renameGroup = async (group: PageNode) => {
    const name = await prompt({
      title: t('editor.rename'),
      label: t('editor.groupName'),
      initialValue: group.title,
      confirmLabel: t('editor.pageSettings.save'),
    });
    if (name && name !== group.title) renameNode(group.id, name.slice(0, 200));
  };
  const deleteNode = (id: string) => {
    const node = (allPages ?? []).find((p) => p.id === id);
    if (!node) return;
    const removed = subtreeIds(allPages ?? [], id);
    void deletePageFlow(node, {
      beforeDelete: flushCurrentDraft,
      onDeleted: () => {
        // Leave a deleted page (or a page inside a deleted group) for the first page.
        if (activeTreeId && removed.has(activeTreeId)) {
          setSelectedId(null);
          setSynced(null);
        }
      },
    });
  };

  // Raw Markdown is a focused workspace: the source editor gets the entire
  // application canvas while the page tree and comments/AI rail temporarily
  // disappear. Their persisted open/collapsed state is left untouched so the
  // previous layout returns when the author switches back to a visual mode.
  // The tree stays reachable through a toolbar button that floats it over the
  // canvas as a temporary overlay (never persisted; closed on page pick).
  const [focusedTreeOpen, setFocusedTreeOpen] = useState(false);
  const showPagesTrigger = useRef<HTMLButtonElement>(null);
  const restorePageTreeFocus = useRef(false);
  const closeFocusedTree = useCallback(() => {
    // Move focus before the tree becomes inert/aria-hidden. A page selected
    // below may briefly replace the toolbar with its loading state.
    showPagesTrigger.current?.focus();
    restorePageTreeFocus.current = true;
    setFocusedTreeOpen(false);
  }, []);
  const { markdownFocused, navigationCollapsed, treeOverlay, navigationHidden, showRail } = resolveEditorLayout({
    view,
    mode: effectiveMode,
    hasPage: Boolean(activeId && page),
    sidebarCollapsed,
    railOpen,
    focusedTreeOpen,
  });
  useEffect(() => {
    if (!markdownFocused) {
      setFocusedTreeOpen(false);
    }
  }, [markdownFocused]);
  useEffect(() => {
    if (restorePageTreeFocus.current && !treeOverlay && page && showPagesTrigger.current) {
      showPagesTrigger.current.focus();
      restorePageTreeFocus.current = false;
    }
  }, [treeOverlay, page]);
  useEffect(() => {
    if (!treeOverlay) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog opened from the tree (page settings) handles its own Escape.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        closeFocusedTree();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [treeOverlay, closeFocusedTree]);

  // Comments on the active page — anchored highlights in the editor + the rail.
  const { data: pageComments } = useComments(projectId, activeId ?? undefined);
  const commentMarkers = useMemo(
    () => (pageComments ?? []).filter((c) => c.anchor?.quote).map((c) => ({ id: c.id, quote: c.anchor?.quote ?? '', resolved: c.resolved })),
    [pageComments],
  );
  const toggleCommentMode = () => {
    const next = !commentMode;
    if (next) {
      setEditorMode('visual');
      // Below xl the rail is a sheet; it opens once a passage is picked, so the
      // page stays clickable while choosing what to comment on.
      if (wideLayout) setRailOpen(true);
      setRailTab('comments');
    } else {
      setPendingAnchor(null);
    }
    setCommentMode(next);
  };

  const pageTitleInput = (
    <PageTitleField
      label={t('editor.pageTitlePlaceholder')}
      lang={activeLanguage?.code}
      onChange={setTitle}
      onEnter={() => focusBodyStart(canvasRef.current)}
      textareaRef={titleRef}
      value={title}
    />
  );
  // Writers start typing the title right after clicking "New page". While the page
  // is being created the canvas is locked, so keep those keystrokes and hand them to
  // the new title instead of dropping them.
  const typedWhileCreating = useRef('');
  const creatingPage = pendingSwitch?.kind === 'create';
  useEffect(() => {
    if (!creatingPage) return;
    typedWhileCreating.current = '';
    const onKeyDown = (event: KeyboardEvent) => {
      // Only for a new page whose title will take focus, and never for keys meant for
      // another control (command palette search, a rename field, a comment, a dialog).
      if (!bufferTitleKeys.current) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="combobox"]')) return;
      if (event.key === 'Backspace') typedWhileCreating.current = typedWhileCreating.current.slice(0, -1);
      else if (event.key.length === 1) typedWhileCreating.current += event.key;
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [creatingPage]);

  // A new page opens with its placeholder title selected, so typing replaces it.
  useEffect(() => {
    if (!focusTitleFor || switching || page?.id !== focusTitleFor) return;
    const element = titleRef.current;
    if (!element) return;
    element.focus();
    const typed = typedWhileCreating.current.trimStart();
    typedWhileCreating.current = '';
    if (typed) {
      // Write the DOM value and caret synchronously so keys typed from now on land
      // after the buffered text; React then renders the same value.
      element.value = typed;
      element.setSelectionRange(typed.length, typed.length);
      setTitle(typed);
    } else {
      element.select();
    }
    setFocusTitleFor(null);
  }, [focusTitleFor, switching, page?.id]);

  const openRail = () => {
    if (wideLayout) setRailOpen(true);
    else setRailSheetOpen(true);
  };
  const railPanel = activeId ? (
    <Tabs value={railTab} onValueChange={(value) => setRailTab(value === 'ai' ? 'ai' : 'comments')} className="flex min-h-0 flex-1 flex-col">
      {aiTabs ? (
        <TabsList aria-busy={aiDraft ? undefined : true} className="m-2 self-start">
          <TabsTrigger value="comments">{t('editor.comments')}</TabsTrigger>
          {aiDraft ? (
            <TabsTrigger value="ai">{t('editor.ai')}</TabsTrigger>
          ) : (
            <Skeleton aria-hidden className="mx-2 h-5 w-12" data-testid="ai-tab-placeholder" />
          )}
        </TabsList>
      ) : null}
      <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', aiTabs && 'pt-0')}>
        {railTab === 'comments' ? (
          <CommentsPanel
            pageId={activeId}
            projectId={projectId}
            pendingAnchor={pendingAnchor}
            onClearPending={() => setPendingAnchor(null)}
            activeCommentId={activeCommentId}
            onSelectComment={setActiveCommentId}
            commentMode={commentMode}
          />
        ) : (
          <AiAssist session={aiAssistSession} />
        )}
      </div>
    </Tabs>
  ) : null;
  const showBranchSwitcher = (branches?.length ?? 0) > 1;
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const newPageLanguageId = page?.languageId ?? selectedGroup?.languageId ?? defaultLanguageId;
  const newPageLanguage = orderedLanguages.find((lang) => lang.id === newPageLanguageId);

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar — workspace controls (Mintlify-style): back + branch on the left,
          configure / preview / publish on the right. No breadcrumb. */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-border border-b bg-background px-2 sm:gap-2.5 sm:px-3">
        <Link
          to="/app/projects/$projectId"
          params={{ projectId }}
          aria-label={t('editor.backToDashboard')}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:min-h-10 pointer-coarse:min-w-10 pointer-coarse:justify-center"
          title={t('editor.backToDashboard')}
        >
          <ChevronLeft className="size-4 rtl:-scale-x-100" />
          {project?.name ? <span className="hidden max-w-[200px] truncate font-medium text-foreground text-sm sm:inline">{project.name}</span> : null}
        </Link>
        {/* Divider only once the project name is loaded — otherwise it dangles next to the chevron. */}
        {project?.name ? <span className="hidden h-5 w-px bg-border sm:block" /> : null}
        {/* Versions only matter once a site has more than one; until then the
            switcher stays out of the way ("New version" lives in the … menu). */}
        <BranchSwitcher
          projectId={projectId}
          branches={branches ?? []}
          activeBranchId={activeBranchId}
          beforeChange={flushCurrentDraft}
          hideTrigger={!showBranchSwitcher}
          createOpen={newVersionOpen}
          onCreateOpenChange={setNewVersionOpen}
          onSwitch={(id) => {
            void runAfterSavingDraft({
              action: () => {
                deepLinkedPageId.current = null;
                setActiveBranchId(id);
                setSelectedId(null);
                setSynced(null);
              },
            });
          }}
        />
        {view === 'content' && page && !switching ? (
          <SaveStatus state={status} publishState={pageState} unpublishedCount={pendingChanges?.changes.length ?? 0} />
        ) : null}
        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          {canManageSettings ? (
            <Button
              aria-label={t('editor.mode.configuration')}
              size="sm"
              variant={view === 'config' ? 'secondary' : 'ghost'}
              className="cursor-pointer"
              onClick={async () => {
                const nextView = view === 'config' ? 'content' : 'config';
                if (view === 'config' && !(await guardConfigChanges())) return;
                setView(nextView);
                if (nextView === 'config') {
                  setSidebarCollapsed(false);
                  setMobileSidebarOpen(true);
                }
              }}
            >
              <SlidersHorizontal className="size-3.5" /> <span className="hidden md:inline">{t('editor.mode.configuration')}</span>
            </Button>
          ) : null}
          <Button aria-label={t('project.preview')} onClick={() => void openDraftPreview()} size="sm" variant="outline" className="cursor-pointer">
            <Eye className="size-3.5" /> <span>{t('project.preview')}</span>
          </Button>
          {project ? (
            <PublishControl
              beforePublish={preparePublish}
              currentPage={
                page
                  ? {
                      path: page.path,
                      title: page.title,
                      languageCode: activeLanguage?.code,
                      versionSlug: publishedVersionSlugFor(branches, page.branchId ?? activeBranchId),
                    }
                  : undefined
              }
              initialPublishOpen={publishParam}
              project={project}
            />
          ) : null}
        </div>
      </header>
      {siteNeverPublished && view === 'content' ? (
        <NeverPublishedBanner />
      ) : view === 'content' && page && !switching && pageState ? (
        <PagePublishStateBar state={pageState} />
      ) : null}

      {/* Editor grid: page-tree sidebar + canvas (+ comments rail). The single row is
          pinned to the container height (minmax(0,1fr)) so each column is bounded and
          its own overflow-y-auto scrolls — an implicit `auto` row would grow to the
          tallest column's content and break scrolling. */}
      <div
        className={cn(
          'relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)]',
          // The overlay leaves the grid (absolute), so the canvas must own the only column.
          !treeOverlay && 'lg:grid-cols-[var(--editor-sidebar)_1fr]',
          showRail && 'xl:grid-cols-[var(--editor-sidebar)_1fr_300px]',
        )}
        style={{ '--editor-sidebar': navigationCollapsed ? '0px' : `${sidebarWidth}px` } as CSSProperties}
      >
        {treeOverlay ? (
          <button
            type="button"
            aria-label={t('editor.hidePages')}
            className="absolute inset-0 z-20 cursor-default bg-background/40"
            onClick={closeFocusedTree}
          />
        ) : mobileSidebarOpen && !navigationHidden ? (
          <button
            type="button"
            aria-label={t('editor.hideSidebar')}
            className="absolute inset-0 z-20 cursor-default bg-background/60 lg:hidden"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            'relative flex min-h-0 flex-col overflow-hidden border-border border-e bg-sidebar',
            // Below lg the tree is an on-demand drawer; in the focused Markdown layout
            // it is a drawer at every size (the grid column stays collapsed).
            treeOverlay
              ? 'absolute inset-y-0 start-0 z-30 w-[min(85vw,320px)] shadow-xl'
              : 'max-lg:absolute max-lg:inset-y-0 max-lg:start-0 max-lg:z-30 max-lg:w-[min(85vw,320px)] max-lg:shadow-xl lg:bg-sidebar/40',
            !mobileSidebarOpen && !treeOverlay && 'max-lg:hidden',
            navigationHidden && 'invisible pointer-events-none border-e-0',
          )}
          aria-hidden={navigationHidden}
          inert={navigationHidden}
        >
          {!navigationCollapsed ? <SidebarResizer onResize={setSidebarWidth} /> : null}
          {/* Sidebar header: section label + the collapse control (lives ON the sidebar). */}
          <div className="flex h-12 shrink-0 items-center justify-between border-border border-b ps-3 pe-1.5">
            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {view === 'config' ? t('editor.config.heading') : t('editor.pages')}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="cursor-pointer"
              onClick={() => {
                if (treeOverlay) {
                  closeFocusedTree();
                } else if (window.matchMedia('(max-width: 1023px)').matches) {
                  setMobileSidebarOpen(false);
                } else {
                  setSidebarCollapsed(true);
                }
              }}
              aria-label={treeOverlay ? t('editor.hidePages') : t('editor.hideSidebar')}
              title={treeOverlay ? t('editor.hidePages') : t('editor.hideSidebar')}
            >
              <PanelLeftClose className="size-3.5 rtl:-scale-x-100" />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 px-2 py-2">
              {view === 'config' ? (
                canManageSettings ? (
                  <ConfigSectionList
                    active={configSection}
                    onSelect={async (section) => {
                      if (!canManageSettings || section === configSection || !(await guardConfigChanges())) return;
                      setConfigSection(section);
                      setMobileSidebarOpen(false);
                    }}
                  />
                ) : null
              ) : isPending ? (
                // The page canvas announces the loading status; this mirrors the tree.
                <div aria-busy="true" className="space-y-1.5 px-1 py-1.5">
                  <Skeleton aria-hidden className="mb-3 h-8 w-full" />
                  {TREE_SKELETON_WIDTHS.map((width) => (
                    <Skeleton aria-hidden className={cn('h-6', width)} key={width} />
                  ))}
                </div>
              ) : (
                <>
                  {newPageLanguage ? (
                    <Button
                      className="mb-2 w-full cursor-pointer justify-start"
                      disabled={createPage.isPending || switching}
                      onClick={() => {
                        expandLang(newPageLanguage.id);
                        addPage(null, newPageLanguage.id);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Plus className="size-4" />
                      <span className="truncate">
                        {orderedLanguages.length > 1 ? t('editor.newPageIn', { language: newPageLanguage.label }) : t('editor.newPage')}
                      </span>
                    </Button>
                  ) : null}
                  {orderedLanguages.map((lang) => {
                    const dir = lang.direction === 'RTL' ? 'rtl' : 'ltr';
                    const langPages = pagesByLanguage.get(lang.id) ?? [];
                    const langCollapsed = collapsedLangs.has(lang.id);
                    return (
                      <div key={lang.id} className="mb-2">
                        {/* Language section header — click the label to collapse/expand */}
                        <div className="group flex items-center justify-between rounded-md px-1 py-1.5 hover:bg-muted/40">
                          <button
                            type="button"
                            onClick={() => toggleLang(lang.id)}
                            aria-expanded={!langCollapsed}
                            title={langCollapsed ? t('editor.expand') : t('editor.collapse')}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-start font-semibold text-[12.5px] text-foreground"
                          >
                            <ChevronRight
                              className={cn(
                                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                langCollapsed ? 'rtl:rotate-180' : 'rotate-90',
                              )}
                            />
                            <Languages className="size-3.5 shrink-0 text-muted-foreground" />
                            {/* The label owns the row's flexible space: the code lives in its
                              tooltip and the badge never shrinks, so "English" only truncates
                              when the sidebar is genuinely too narrow for it. */}
                            {/* Only the name takes the language's direction, so an Arabic row
                                stays aligned with the rest of an English sidebar (and vice versa). */}
                            <span className="min-w-0 truncate" dir={dir} title={`${lang.label} (${lang.code})`}>
                              {lang.label}
                            </span>
                            {lang.isDefault ? (
                              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 font-medium text-[9px] text-accent-foreground">
                                {t('editor.default')}
                              </span>
                            ) : null}
                          </button>
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="cursor-pointer"
                              onClick={() => setLangSettings(lang)}
                              aria-label={t('editor.langSettings.settings')}
                              title={t('editor.langSettings.settings')}
                            >
                              <Settings2 className="size-3" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="cursor-pointer"
                              onClick={() => {
                                expandLang(lang.id);
                                void addGroup(lang.id);
                              }}
                              aria-label={t('editor.newGroup')}
                              title={t('editor.newGroup')}
                              disabled={createPage.isPending || switching}
                            >
                              <FolderPlus className="size-3" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="cursor-pointer"
                              onClick={() => {
                                expandLang(lang.id);
                                addPage(null, lang.id);
                              }}
                              aria-label={t('editor.newPageIn', { language: lang.label })}
                              title={t('editor.newPageIn', { language: lang.label })}
                              disabled={createPage.isPending || switching}
                            >
                              <Plus className="size-3" />
                            </Button>
                          </div>
                        </div>

                        {/* This language's page tree — Notion-style drag-and-drop */}
                        {langCollapsed ? null : (
                          <div className="space-y-0.5" dir={dir}>
                            {langPages.length === 0 ? (
                              <p className="px-2 py-1 text-[12px] text-muted-foreground/70">{t('editor.noPagesYet')}</p>
                            ) : (
                              <SortablePageTree
                                pages={langPages}
                                activeId={activeTreeId}
                                treeKey={lang.id}
                                dir={dir}
                                onSelect={(id) => {
                                  if (treeOverlay) closeFocusedTree();
                                  setMobileSidebarOpen(false);
                                  setFocusedTreeOpen(false);
                                  openNode(id);
                                }}
                                onAddChild={(parentId) => addPage(parentId, lang.id)}
                                onSettings={(id) => void runAfterSavingDraft({ action: () => setSettingsForId(id) })}
                                onMove={(items) =>
                                  reorderPages.mutate(
                                    { items },
                                    { onError: (error) => toast.error(friendlyErrorMessage(t, error, 'editor.reorderFailed')) },
                                  )
                                }
                                onRename={renameNode}
                                onDelete={deleteNode}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Add a language */}
                  <button
                    type="button"
                    onClick={() => setAddLangOpen(true)}
                    className="mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="size-3.5" /> {t('editor.addLanguage')}
                  </button>
                </>
              )}
            </div>
          </ScrollArea>
          <AddLanguageDialog projectId={projectId} open={addLangOpen} onOpenChange={setAddLangOpen} onCreated={() => setAddLangOpen(false)} />
          {langSettings ? (
            <LanguageSettingsDialog
              projectId={projectId}
              language={langSettings}
              open={Boolean(langSettings)}
              onOpenChange={(o) => !o && setLangSettings(null)}
            />
          ) : null}
          {settingsForId
            ? (() => {
                const target = (allPages ?? []).find((p) => p.id === settingsForId);
                // A save can finish before the tree refetch. Use its current
                // title so saving settings cannot restore the stale tree title.
                const settingsPage = target && synced?.id === target.id ? { ...target, title: synced.title } : target;
                return settingsPage ? (
                  <PageSettingsDialog
                    projectId={projectId}
                    page={settingsPage}
                    // While publish state is unknown, assume the page may be live, so changing its address still warns.
                    published={!pageNeverPublished(settingsPage.id, pendingChanges)}
                    open
                    onOpenChange={(o) => !o && setSettingsForId(null)}
                  />
                ) : null;
              })()
            : null}
        </aside>

        {/* The one main landmark, for every canvas state (configuration, loading,
            group, page, empty): "Skip to main content" lands here. */}
        <main className="flex min-h-0 min-w-0 flex-col outline-none" id="main-content" tabIndex={-1}>
          {/* Main area: site configuration */}
          {view === 'config' ? (
            <ConfigCanvas
              canManage={canManageSettings}
              permissionsPending={permissionsPending}
              onBackToWriting={() => setView('content')}
              project={project}
              reportDirty={reportConfigDirty}
              section={configSection}
            />
          ) : switching ? (
            // Locked while switching or creating: the page being left is gone from
            // the screen, so nothing typed now can end up in it.
            <PageCanvasSkeleton status={pendingSwitch?.kind === 'create' ? t('editor.creatingPage') : t('editor.openingPage')} />
          ) : isPending ? (
            // The page tree is still loading: don't offer "No page selected" yet.
            <PageCanvasSkeleton status={t('common.loading')} />
          ) : selectedGroup ? (
            <GroupCanvas
              addingPage={createPage.isPending}
              group={selectedGroup}
              onAddPage={() => selectedGroup.languageId && addPage(selectedGroup.id, selectedGroup.languageId)}
              onDelete={() => deleteNode(selectedGroup.id)}
              onOpenSettings={() => void runAfterSavingDraft({ action: () => setSettingsForId(selectedGroup.id) })}
              onRename={() => void renameGroup(selectedGroup)}
            />
          ) : pageLoadFailed ? (
            <PageLoadFailedCanvas
              error={pageQuery.error}
              onRetry={() => void pageQuery.refetch()}
              onShowPages={() => {
                setSidebarCollapsed(false);
                setMobileSidebarOpen(true);
              }}
              retrying={pageQuery.isFetching}
              sidebarCollapsed={sidebarCollapsed}
            />
          ) : activeId && !page ? (
            <PageCanvasSkeleton status={t('editor.openingPage')} />
          ) : activeId && page ? (
            /* Main area: page editor */
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              {status === 'error' ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 border-destructive/30 border-b bg-destructive/5 px-4 py-3 text-destructive text-sm"
                >
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{t('editor.saveError')}</span>
                  <Button size="sm" variant="outline" onClick={() => void runAfterSavingDraft({ action: () => undefined })}>
                    {t('editor.retrySave')}
                  </Button>
                </div>
              ) : null}
              {/* Editor toolbar: re-expand affordance (when the sidebar is collapsed) + the
              document mode/view controls. */}
              <div className="flex min-h-12 flex-wrap items-center gap-1 border-border border-b px-2 py-1.5 sm:gap-2 sm:px-4 sm:py-0">
                {markdownFocused ? (
                  // The focused layout hides the tree; this floats it over the canvas so
                  // the author can still switch pages without leaving Markdown mode.
                  <Button
                    ref={showPagesTrigger}
                    size="icon-sm"
                    variant="ghost"
                    className="cursor-pointer"
                    onClick={() => setFocusedTreeOpen(true)}
                    aria-expanded={treeOverlay}
                    aria-label={t('editor.showPages')}
                    title={t('editor.showPages')}
                  >
                    <PanelLeftOpen className="size-4 rtl:-scale-x-100" />
                  </Button>
                ) : !mobileSidebarOpen ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className={cn('cursor-pointer', !sidebarCollapsed && 'lg:hidden')}
                    onClick={() => {
                      setSidebarCollapsed(false);
                      setMobileSidebarOpen(true);
                    }}
                    aria-label={t('editor.showSidebar')}
                    title={t('editor.showSidebar')}
                  >
                    <PanelLeftOpen className="size-4 rtl:-scale-x-100" />
                  </Button>
                ) : null}
                {effectiveMode === 'markdown' ? (
                  <Button size="sm" variant="secondary" className="ms-auto cursor-pointer" onClick={() => setEditorMode(visualMode)}>
                    <Pencil className="size-3.5" /> {t('editor.backToVisual')}
                  </Button>
                ) : (
                  <span className="ms-auto" />
                )}
                <Button
                  size="sm"
                  variant={commentMode ? 'secondary' : 'ghost'}
                  aria-pressed={commentMode}
                  aria-label={commentMode ? t('editor.comments.commenting') : t('editor.comments.mode')}
                  className={cn('cursor-pointer', commentMode && 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/35 dark:text-amber-300')}
                  onClick={toggleCommentMode}
                  title={t('editor.comments.modeHint')}
                >
                  <MessageSquare className="size-4" />
                  <span className="hidden md:inline">{commentMode ? t('editor.comments.commenting') : t('editor.comments.mode')}</span>
                </Button>
                {!markdownFocused ? (
                  <Button
                    aria-label={railLabel}
                    aria-pressed={wideLayout ? railOpen : railSheetOpen}
                    className="cursor-pointer"
                    onClick={() => (wideLayout ? setRailOpen((v) => !v) : setRailSheetOpen((v) => !v))}
                    size="icon-sm"
                    title={railLabel}
                    variant={(wideLayout ? railOpen : railSheetOpen) ? 'secondary' : 'ghost'}
                  >
                    <PanelRight className="size-4 rtl:-scale-x-100" />
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => activeId && void runAfterSavingDraft({ action: () => setSettingsForId(activeId) })}
                  aria-label={t('editor.pageSettings.title')}
                  title={t('editor.pageSettings.title')}
                >
                  <Settings2 className="size-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="cursor-pointer"
                        aria-label={t('editor.moreActions')}
                        title={t('editor.moreActions')}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuCheckboxItem
                      checked={effectiveMode === 'wysiwyg'}
                      disabled={effectiveMode === 'markdown'}
                      onCheckedChange={(checked) => {
                        const next = checked ? 'wysiwyg' : 'visual';
                        setVisualMode(next);
                        setEditorMode(next);
                      }}
                    >
                      {t('editor.showToolbar')}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuItem
                      onClick={() => {
                        if (commentMode) toggleCommentMode();
                        setEditorMode(effectiveMode === 'markdown' ? visualMode : 'markdown');
                      }}
                    >
                      <Code2 />
                      <span className="flex min-w-0 flex-col">
                        <span>{effectiveMode === 'markdown' ? t('editor.backToVisual') : t('editor.editSource')}</span>
                        {effectiveMode === 'markdown' ? null : <span className="text-muted-foreground text-xs">{t('editor.editSourceHint')}</span>}
                      </span>
                    </DropdownMenuItem>
                    {!showBranchSwitcher ? (
                      <DropdownMenuItem onClick={() => setNewVersionOpen(true)}>
                        <Layers /> {t('editor.branch.new')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => deleteNode(page.id)}>
                      <Trash2 /> {t('editor.deletePage')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div
                ref={canvasRef}
                className={cn(
                  'min-h-0 flex-1',
                  effectiveMode === 'markdown'
                    ? 'flex flex-col overflow-hidden'
                    : effectiveMode === 'wysiwyg'
                      ? 'flex flex-col overflow-hidden'
                      : 'overflow-y-auto px-4 py-6 sm:px-7 sm:py-8',
                )}
              >
                {unsupportedTags.length > 0 && effectiveMode !== 'markdown' ? (
                  <div
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-700 leading-snug dark:text-amber-300',
                      effectiveMode === 'wysiwyg' ? 'mx-4 mt-4 sm:mx-7' : 'mx-auto mb-5 max-w-[720px]',
                    )}
                    role="status"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <p>{t('editor.unsupportedMdx.banner', { tags: unsupportedTags.join(', ') })}</p>
                  </div>
                ) : null}
                {/* Visual mode keeps its reading measure. Rich Text and Markdown
                render their toolbar and title inside their full-height canvas. */}
                {effectiveMode === 'visual' ? <div className="mx-auto max-w-[720px]">{pageTitleInput}</div> : null}
                {effectiveMode === 'visual' || effectiveMode === 'wysiwyg' ? (
                  // .ProseMirror self-centers at the 720px measure (tiptap.css), leaving a
                  // gutter for the block handle — so it is NOT wrapped in a narrow box.
                  // Keyed by page id: every page gets its own TipTap instance, so a
                  // document can never linger across a page switch.
                  // The link picker searches the version this page belongs to.
                  <ActiveBranchContext.Provider value={page.branchId ?? activeBranchId ?? undefined}>
                    <TiptapEditor
                      key={page.id}
                      value={content}
                      onChange={setContent}
                      className={effectiveMode === 'wysiwyg' ? 'min-h-0 flex-1' : undefined}
                      dir={activeLangDir}
                      lang={activeLanguage?.code}
                      style={typographyVars(project?.config?.typography)}
                      onUpload={onUploadImage}
                      comments={commentMarkers}
                      activeCommentId={activeCommentId}
                      commentMode={commentMode}
                      onAddComment={(anchor) => {
                        setPendingAnchor(anchor);
                        openRail();
                        setRailTab('comments');
                      }}
                      titleSlot={effectiveMode === 'wysiwyg' ? pageTitleInput : undefined}
                      variant={effectiveMode === 'wysiwyg' ? 'wysiwyg' : 'visual'}
                    />
                  </ActiveBranchContext.Provider>
                ) : (
                  <MarkdownSourceEditor
                    key={page.id}
                    dir={activeLangDir}
                    label={t('editor.markdownPlaceholder')}
                    value={content}
                    onChange={setContent}
                    placeholder={t('editor.markdownPlaceholder')}
                    titleSlot={pageTitleInput}
                  />
                )}
              </div>
            </section>
          ) : (
            <EmptyCanvas
              canCreate={Boolean(defaultLanguageId)}
              creating={createPage.isPending || switching}
              onNewPage={() => defaultLanguageId && addPage(null, defaultLanguageId)}
            />
          )}
        </main>

        {/* Right rail: Figma-style tabbed panel — Comments / AI. A column at xl… */}
        {showRail && wideLayout && railPanel ? (
          <aside className="hidden min-h-0 flex-col overflow-hidden border-border border-s bg-sidebar/40 xl:flex">{railPanel}</aside>
        ) : null}
      </div>
      {/* …and a sheet on smaller screens, so comments work on laptops and phones. */}
      <Sheet open={!wideLayout && railSheetOpen && Boolean(railPanel)} onOpenChange={setRailSheetOpen}>
        <SheetContent side={uiDir === 'rtl' ? 'left' : 'right'} className="w-[min(92vw,380px)] gap-0 p-0">
          <SheetHeader className="border-border border-b px-4 py-3">
            <SheetTitle>{t('editor.comments')}</SheetTitle>
            <SheetDescription className="sr-only">{t('editor.comments.modeHint')}</SheetDescription>
          </SheetHeader>
          {railPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const TREE_SKELETON_WIDTHS = ['w-1/2', 'w-4/5', 'w-3/4', 'w-2/3', 'w-4/5 ms-4', 'w-3/5 ms-4'];

type PendingChangesData = ReturnType<typeof usePendingChanges>['data'];

/** Whether a page's address may still follow its title, from the freshest cached
 *  publish state (see addressMayFollowTitle). */
function addressFollowsTitle(queryClient: QueryClient, projectId: string, pageId: string): boolean {
  return addressMayFollowTitle(
    pageId,
    queryClient.getQueryData<PendingChangesData>(queryKeys.deployments.changes(projectId)),
    queryClient.getQueryData<Deployment[]>(queryKeys.deployments.all(projectId)),
  );
}

/** The newer of two server copies of the same page (by revision stamp). */
function freshestServerCopy(id: string, a: PageNode | null | undefined, b: PageNode | null | undefined): PageNode | null {
  const candidates = [a, b].filter((copy): copy is PageNode => copy?.id === id);
  return candidates.sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt))[0] ?? null;
}

/** Drag handle on the sidebar's inline-end edge to resize it (200–520px). Width
 *  is derived from the aside's box so it's correct in both LTR and RTL. */
function SidebarResizer({ onResize }: { onResize: (width: number) => void }) {
  const dragging = useRef(false);
  return (
    <div
      aria-hidden
      onPointerDown={(event) => {
        event.preventDefault();
        dragging.current = true;
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) {
          return;
        }
        const aside = (event.currentTarget as HTMLElement).closest('aside');
        if (!aside) {
          return;
        }
        const rect = aside.getBoundingClientRect();
        const rtl = getComputedStyle(aside).direction === 'rtl';
        const width = rtl ? rect.right - event.clientX : event.clientX - rect.left;
        onResize(Math.min(520, Math.max(200, Math.round(width))));
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      }}
      className="absolute inset-y-0 end-0 z-20 hidden w-1.5 translate-x-1/2 cursor-col-resize lg:block rtl:-translate-x-1/2"
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors hover:bg-primary/50" />
    </div>
  );
}
