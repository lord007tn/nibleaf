import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useDebouncedCallback } from '@tanstack/react-pacer';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  Languages,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Plus,
  Settings2,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Type as TypeIcon,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import { AiAssist } from '@/components/editor/ai-assist';
import { BranchSwitcher } from '@/components/editor/branch-switcher';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { LanguageSettingsDialog } from '@/components/editor/language-settings-dialog';
import { MarkdownSourceEditor } from '@/components/editor/markdown-source-editor';
import { PageSettingsDialog } from '@/components/editor/page-settings-dialog';
import { ConfigSection, type ConfigSectionId, ConfigSectionList } from '@/components/editor/site-config-panel';
import { SortablePageTree } from '@/components/editor/sortable-page-tree';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { detectUnsupportedMdxTags } from '@/components/editor/unsupported-mdx';
import type { Language, PageNode } from '@/hooks/api';
import {
  useBranches,
  useComments,
  useCreatePage,
  useDeletePage,
  useLanguages,
  usePage,
  usePages,
  useProject,
  useReorderPages,
  useUpdatePage,
  useUploadAsset,
} from '@/hooks/api';
import { PublishControl } from '@/layouts/project';
import { draftPreviewHref } from '@/lib/draft-preview';
import { recordFirstPublishStage } from '@/lib/first-publish-activation';
import { typographyVars } from '@/lib/typography';

export const Route = createFileRoute('/app/projects/$projectId/editor')({
  component: EditorPage,
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
});

function EditorPage() {
  const t = useT();
  const { projectId } = Route.useParams();
  const { firstPublish, page: pageParam, publish: publishParam } = Route.useSearch();
  const { data: project } = useProject(projectId);

  useEffect(() => {
    if (firstPublish) void recordFirstPublishStage('editor_entered');
  }, [firstPublish]);

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
  const deletePage = useDeletePage(projectId);
  const updatePage = useUpdatePage(projectId);
  const uploadAsset = useUploadAsset(projectId);
  const reorderPages = useReorderPages(projectId);
  const confirm = useConfirm();

  // Upload an image (paste/drop/pick) and return its hosted URL for the editor.
  const onUploadImage = async (file: File): Promise<string | null> => {
    try {
      return (await uploadAsset.mutateAsync(file)).url;
    } catch {
      toast.error(t('editor.imageUploadFailed'));
      return null;
    }
  };

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
  // Follow ?page= deep links even when the editor is already mounted (e.g. a
  // second publish-issue link). Only reacts to the param changing, so it never
  // overrides a page the user picked from the tree afterwards.
  useEffect(() => {
    if (pageParam) {
      setSelectedId(pageParam);
    }
  }, [pageParam]);
  const firstPageId = useMemo(() => (allPages ?? []).find((p) => p.kind === 'PAGE')?.id ?? null, [allPages]);
  const selectedNode = useMemo(() => (allPages ?? []).find((p) => p.id === selectedId) ?? null, [allPages, selectedId]);
  const selectedGroup = selectedNode?.kind === 'GROUP' ? selectedNode : null;
  const activeId = selectedGroup ? null : (selectedId ?? firstPageId);
  const activeTreeId = selectedId ?? activeId;

  const { data: page } = usePage(projectId, activeId ?? undefined);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [railTab, setRailTab] = useState<'comments' | 'ai'>('comments');
  const [railOpen, setRailOpen] = useState(true);
  // Figma-style comment mode: click a block to anchor a comment; the rail shows the
  // threads. Comment mode is review-only (the editor goes non-editable).
  const [commentMode, setCommentMode] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<{ quote: string; from: number; to: number } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // How the page body is edited: a visual canvas, rich text, or raw Markdown/MDX.
  // Preview is deliberately an action, not an editing mode: it opens the current
  // unpublished draft in its own tab through the authenticated preview route.
  const [editorMode, setEditorMode] = useState<'visual' | 'wysiwyg' | 'markdown'>('visual');
  useEffect(() => {
    const stored = window.localStorage.getItem('nibleaf.editor.contentMode');
    setEditorMode(stored === 'wysiwyg' || stored === 'markdown' ? stored : 'visual');
  }, []);
  // Unknown JSX components are represented by local opaque nodes. Inventory
  // them for the explanatory banner without locking the rest of the page.
  const unsupportedTags = useMemo(() => detectUnsupportedMdxTags(content), [content]);
  const effectiveMode = editorMode;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [addLangOpen, setAddLangOpen] = useState(false);
  // The page whose settings dialog is open — independent of the active editor
  // page, so opening a page's settings from the tree does NOT switch what you're
  // editing.
  const [settingsForId, setSettingsForId] = useState<string | null>(null);
  const [langSettings, setLangSettings] = useState<Language | null>(null);
  // What's currently in sync with the server for the open page: its id + the
  // exact title/content we last loaded (or saved). Drives re-seeding so the
  // editor recovers when the server copy changes — without clobbering edits.
  const synced = useRef<{ id: string; content: string; title: string } | null>(null);
  const hydrating = useRef<{ id: string; content: string; title: string } | null>(null);

  // Resizable left sidebar (persisted). Clamp to a sensible range.
  const [sidebarWidth, setSidebarWidth] = useState(260);
  useEffect(() => {
    const stored = Number(window.localStorage.getItem('nibleaf.editor.sidebarWidth'));
    setSidebarWidth(stored >= 200 && stored <= 520 ? stored : 260);
  }, []);
  useEffect(() => {
    window.localStorage.setItem('nibleaf.editor.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
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
    setSidebarCollapsed(window.localStorage.getItem('nibleaf.editor.sidebarCollapsed') === '1');
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
  // when the server's copy changed while the draft is still clean (matches what we
  // last loaded/saved) — so an external update, a branch reload, or a stale→fresh
  // cache transition refreshes the editor without ever clobbering unsaved edits.
  useEffect(() => {
    if (!page) {
      return;
    }
    const samePage = synced.current?.id === page.id;
    const clean = synced.current ? content === synced.current.content && title === synced.current.title : true;
    if (!samePage || (page.content !== synced.current?.content && clean)) {
      hydrating.current = { id: page.id, content: page.content, title: page.title };
      setTitle(page.title);
      setContent(page.content);
      setStatus('idle');
    }
  }, [page, content, title]);

  useEffect(() => {
    const pending = hydrating.current;
    if (!pending) {
      return;
    }
    if (page?.id === pending.id && title === pending.title && content === pending.content) {
      synced.current = pending;
      hydrating.current = null;
    }
  }, [page?.id, title, content]);

  // Debounced autosave: fire ~700ms after the user stops typing the title/content.
  // `onUnmount` flushes any pending save when the editor unmounts (route change /
  // tab close) so a keystroke made <700ms before leaving isn't dropped.
  const saveDraft = useDebouncedCallback(
    (pageId: string, draft: { title: string; content: string }) => {
      updatePage.mutate(
        { pageId, body: draft },
        {
          onSuccess: () => {
            setStatus('saved');
            // The saved draft is now the synced server state.
            if (synced.current?.id === pageId) {
              synced.current = { id: pageId, content: draft.content, title: draft.title };
            }
          },
          onError: () => setStatus('idle'),
        },
      );
    },
    { wait: 700, onUnmount: (d) => d.flush() },
  );

  useEffect(() => {
    if (!page || synced.current?.id !== page.id || hydrating.current) {
      return;
    }
    if (title === page.title && content === page.content) {
      return;
    }
    // Data-loss guard: never let an AUTOMATIC save replace a page that has content
    // with an empty body. Protects against a transient empty `content` state (e.g. a
    // hot-reload/Fast-Refresh reset, or a load race) silently wiping the page. A real
    // "clear the page" still persists the moment any character is typed.
    if (content.trim() === '' && page.content.trim() !== '') {
      return;
    }
    setStatus('saving');
    saveDraft(page.id, { title, content });
  }, [title, content, page, saveDraft]);

  const openDraftPreview = async () => {
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
      const draftIsCurrent = page && synced.current?.id === page.id && synced.current.title === title && synced.current.content === content;
      if (page && !draftIsCurrent) {
        setStatus('saving');
        await updatePage.mutateAsync({ pageId: page.id, body: { title, content } });
        synced.current = { id: page.id, title, content };
        setStatus('saved');
      }
      previewWindow.location.replace(previewUrl);
    } catch {
      previewWindow.close();
      setStatus('idle');
      toast.error(t('editor.previewSaveError'));
    }
  };

  const branchScope = activeBranchId ? { branchId: activeBranchId } : {};
  const addPage = (parentId: string | null, languageId: string) =>
    createPage.mutate(
      { title: 'Untitled', parentId, languageId, ...branchScope },
      { onSuccess: (created) => setSelectedId(created.id), onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.createFailed')) },
    );
  const addGroup = (languageId: string) =>
    createPage.mutate(
      // The display title is localized, but the slug is pinned: deriving it from
      // a non-Latin title (e.g. Arabic) would strip to a broken 'page' slug.
      { title: t('editor.newGroup'), kind: 'GROUP', slug: 'new-group', languageId, ...branchScope },
      {
        onSuccess: (created) => {
          setSelectedId(created.id);
          setSettingsForId(created.id);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.createFailed')),
      },
    );

  // Raw Markdown is a focused workspace: the source editor gets the entire
  // application canvas while the page tree and comments/AI rail temporarily
  // disappear. Their persisted open/collapsed state is left untouched so the
  // previous layout returns when the author switches back to a visual mode.
  const markdownFocused = view === 'content' && effectiveMode === 'markdown' && Boolean(activeId && page);
  const navigationCollapsed = sidebarCollapsed || markdownFocused;
  const showRail = view === 'content' && railOpen && !markdownFocused && Boolean(activeId && page);

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
      setRailOpen(true);
      setRailTab('comments');
    } else {
      setPendingAnchor(null);
    }
    setCommentMode(next);
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar — workspace controls (Mintlify-style): back + branch on the left,
          configure / preview / publish on the right. No breadcrumb. */}
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-border border-b bg-background px-2 sm:gap-2.5 sm:px-3">
        <Link
          to="/app/projects/$projectId"
          params={{ projectId }}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('editor.backToDashboard')}
        >
          <ChevronLeft className="size-4 rtl:-scale-x-100" />
          {project?.name ? <span className="hidden max-w-[200px] truncate font-medium text-foreground text-sm sm:inline">{project.name}</span> : null}
        </Link>
        {/* Divider only once the project name is loaded — otherwise it dangles next to the chevron. */}
        {project?.name ? <span className="hidden h-5 w-px bg-border sm:block" /> : null}
        <BranchSwitcher
          projectId={projectId}
          branches={branches ?? []}
          activeBranchId={activeBranchId}
          onSwitch={(id) => {
            setActiveBranchId(id);
            setSelectedId(null);
            synced.current = null;
          }}
        />
        <span className="hidden items-center gap-1.5 text-muted-foreground text-xs lg:flex">
          {status === 'saving' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> {t('editor.savingShort')}
            </>
          ) : status === 'saved' ? (
            <>
              <Check className="size-3 text-primary" /> {t('editor.savedShort')}
            </>
          ) : null}
        </span>
        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          <Button
            aria-label={t('editor.mode.configuration')}
            size="sm"
            variant={view === 'config' ? 'secondary' : 'ghost'}
            className="cursor-pointer"
            onClick={() => {
              const nextView = view === 'config' ? 'content' : 'config';
              setView(nextView);
              if (nextView === 'config') {
                setSidebarCollapsed(false);
                setMobileSidebarOpen(true);
              }
            }}
          >
            <SlidersHorizontal className="size-3.5" /> <span className="hidden md:inline">{t('editor.mode.configuration')}</span>
          </Button>
          <Button aria-label={t('project.preview')} onClick={() => void openDraftPreview()} size="sm" variant="outline" className="cursor-pointer">
            <Eye className="size-3.5" /> <span className="hidden md:inline">{t('project.preview')}</span>
          </Button>
          {project ? <PublishControl project={project} initialPublishOpen={publishParam} /> : null}
        </div>
      </header>

      {/* Editor grid: page-tree sidebar + canvas (+ comments rail). The single row is
          pinned to the container height (minmax(0,1fr)) so each column is bounded and
          its own overflow-y-auto scrolls — an implicit `auto` row would grow to the
          tallest column's content and break scrolling. */}
      <div
        className={cn(
          'relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[var(--editor-sidebar)_1fr]',
          showRail && 'xl:grid-cols-[var(--editor-sidebar)_1fr_300px]',
        )}
        style={{ '--editor-sidebar': navigationCollapsed ? '0px' : `${sidebarWidth}px` } as CSSProperties}
      >
        <aside
          className={cn(
            'relative flex min-h-0 flex-col overflow-hidden border-border border-e bg-sidebar/95 max-lg:absolute max-lg:inset-y-0 max-lg:start-0 max-lg:z-30 max-lg:w-[min(85vw,320px)] max-lg:shadow-xl lg:bg-sidebar/40',
            !mobileSidebarOpen && 'max-lg:hidden',
            navigationCollapsed && 'invisible pointer-events-none border-e-0',
          )}
          aria-hidden={navigationCollapsed}
          inert={navigationCollapsed}
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
                if (window.matchMedia('(max-width: 1023px)').matches) {
                  setMobileSidebarOpen(false);
                } else {
                  setSidebarCollapsed(true);
                }
              }}
              aria-label={t('editor.hideSidebar')}
              title={t('editor.hideSidebar')}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 px-2 py-2">
              {view === 'config' ? (
                <ConfigSectionList
                  active={configSection}
                  onSelect={(section) => {
                    setConfigSection(section);
                    setMobileSidebarOpen(false);
                  }}
                />
              ) : isPending ? (
                <p className="px-2 text-muted-foreground text-sm">{t('common.loading')}</p>
              ) : (
                <>
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
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 font-semibold text-[12.5px] text-foreground"
                            dir={dir}
                          >
                            <ChevronRight
                              className={cn(
                                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                langCollapsed ? 'rtl:rotate-180' : 'rotate-90',
                              )}
                            />
                            <Languages className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{lang.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">({lang.code})</span>
                            {lang.isDefault ? (
                              <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-[9px] text-accent-foreground">
                                {t('editor.default')}
                              </span>
                            ) : null}
                          </button>
                          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                                addGroup(lang.id);
                              }}
                              aria-label={t('editor.newGroup')}
                              title={t('editor.newGroup')}
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
                              aria-label={t('editor.newPage')}
                              title={t('editor.newPage')}
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
                                onSelect={(id) => {
                                  setSelectedId(id);
                                  setMobileSidebarOpen(false);
                                }}
                                onAddChild={(parentId) => addPage(parentId, lang.id)}
                                onSettings={(id) => setSettingsForId(id)}
                                onMove={(items) => reorderPages.mutate({ items })}
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
                return target ? (
                  <PageSettingsDialog projectId={projectId} page={target} open onOpenChange={(o) => !o && setSettingsForId(null)} />
                ) : null;
              })()
            : null}
        </aside>

        {/* Main area: site configuration */}
        {view === 'config' ? (
          <section className="min-h-0 min-w-0 overflow-y-auto">
            {/* A muted overline so it reads as "Site configuration › <section>"
              rather than competing with each section's own heading. */}
            <div className="border-border border-b px-6 py-3">
              <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">{t('editor.config.heading')}</span>
            </div>
            <div className="w-full px-8 pt-7 pb-32">
              {project ? (
                <ConfigSection project={project} section={configSection} />
              ) : (
                <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
              )}
            </div>
          </section>
        ) : selectedGroup ? (
          <section className="grid place-items-center px-6 text-center">
            <div className="max-w-sm">
              <FolderPlus className="mx-auto size-7 text-muted-foreground" />
              <h1 className="mt-3 font-semibold text-xl tracking-tight">{selectedGroup.title}</h1>
              <p className="mt-1 text-muted-foreground text-sm">{t('editor.groupSelectedHint')}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" onClick={() => setSettingsForId(selectedGroup.id)}>
                  <Settings2 className="size-4" /> {t('editor.pageSettings.title')}
                </Button>
                {selectedGroup.languageId ? (
                  <Button onClick={() => addPage(selectedGroup.id, selectedGroup.languageId)}>
                    <Plus className="size-4" /> {t('editor.newPage')}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ) : activeId && !page ? (
          <section className="grid place-items-center text-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </section>
        ) : activeId && page ? (
          /* Main area: page editor */
          <section className="flex min-h-0 min-w-0 flex-col">
            {/* Editor toolbar: re-expand affordance (when the sidebar is collapsed) + the
              document mode/view controls. */}
            <div className="flex min-h-12 items-center gap-1 overflow-x-auto border-border border-b px-2 py-1.5 sm:gap-2 sm:px-4 sm:py-0">
              {!markdownFocused && !mobileSidebarOpen ? (
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
                  <PanelLeftOpen className="size-4" />
                </Button>
              ) : null}
              <div className="ms-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                <SegButton active={effectiveMode === 'visual'} onClick={() => setEditorMode('visual')} icon={<Pencil className="size-3.5" />}>
                  {t('editor.mode.visual')}
                </SegButton>
                <SegButton active={effectiveMode === 'wysiwyg'} onClick={() => setEditorMode('wysiwyg')} icon={<TypeIcon className="size-3.5" />}>
                  {t('editor.mode.wysiwyg')}
                </SegButton>
                <SegButton active={effectiveMode === 'markdown'} onClick={() => setEditorMode('markdown')} icon={<Code2 className="size-3.5" />}>
                  {t('editor.mode.markdown')}
                </SegButton>
              </div>
              <Button
                size="sm"
                variant={commentMode ? 'secondary' : 'ghost'}
                aria-pressed={commentMode}
                className={cn('cursor-pointer', commentMode && 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/35 dark:text-amber-300')}
                onClick={toggleCommentMode}
                title={t('editor.comments.mode')}
              >
                <MessageSquare className="size-4" />
                <span className="hidden md:inline">{commentMode ? t('editor.comments.commenting') : t('editor.comments.mode')}</span>
              </Button>
              <Button
                nativeButton={false}
                render={
                  <a
                    aria-label={t('editor.viewOnSite')}
                    href={`/sites/${projectId}/${page.path}${activeLanguage && !activeLanguage.isDefault ? `?lang=${activeLanguage.code}` : ''}`}
                    rel="noreferrer"
                    target="_blank"
                  />
                }
                size="icon-sm"
                variant="ghost"
                className="cursor-pointer"
                title={t('editor.viewOnSite')}
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="cursor-pointer"
                onClick={() => activeId && setSettingsForId(activeId)}
                aria-label={t('editor.pageSettings.title')}
                title={t('editor.pageSettings.title')}
              >
                <Settings2 className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="cursor-pointer"
                aria-label={t('editor.deletePage')}
                title={t('editor.deletePage')}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('editor.deletePage'),
                    description: t('editor.deletePageConfirm'),
                    confirmLabel: t('editor.deletePage'),
                    destructive: true,
                  });
                  if (ok) {
                    deletePage.mutate(page.id, { onSuccess: () => setSelectedId(null) });
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
              {!markdownFocused ? (
                <Button
                  aria-label={railOpen ? t('editor.hideRail') : t('editor.showRail')}
                  aria-pressed={railOpen}
                  className="hidden cursor-pointer xl:inline-flex"
                  onClick={() => setRailOpen((v) => !v)}
                  size="icon-sm"
                  title={railOpen ? t('editor.hideRail') : t('editor.showRail')}
                  variant={railOpen ? 'secondary' : 'ghost'}
                >
                  <PanelRight className="size-4" />
                </Button>
              ) : null}
            </div>

            <div
              className={cn(
                'min-h-0 flex-1',
                effectiveMode === 'markdown' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto px-4 py-6 sm:px-7 sm:py-8',
              )}
            >
              {unsupportedTags.length > 0 && effectiveMode !== 'markdown' ? (
                <div
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-700 leading-snug dark:text-amber-300',
                    'mx-auto mb-5 max-w-[720px]',
                  )}
                  role="status"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <p>{t('editor.unsupportedMdx.banner', { tags: unsupportedTags.join(', ') })}</p>
                </div>
              ) : null}
              {/* Title rendered as the first line of the document column (Mintlify-style),
                aligned to the reading measure except in Markdown mode, where the
                title and source editor use the full canvas. */}
              <div className={cn(effectiveMode === 'markdown' ? 'w-full shrink-0 border-border border-b px-6 py-4' : 'mx-auto max-w-[720px]')}>
                <input
                  className="w-full rounded-sm border-0 bg-transparent font-semibold text-3xl leading-[1.15] tracking-tight outline-none placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-[2.1rem]"
                  dir={activeLangDir}
                  aria-label={t('editor.pageTitlePlaceholder')}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('editor.pageTitlePlaceholder')}
                  value={title}
                />
              </div>
              {effectiveMode === 'visual' || effectiveMode === 'wysiwyg' ? (
                // .ProseMirror self-centers at the 720px measure (tiptap.css), leaving a
                // gutter for the block handle — so it is NOT wrapped in a narrow box.
                <TiptapEditor
                  value={content}
                  onChange={setContent}
                  dir={activeLangDir}
                  style={typographyVars(project?.config?.typography)}
                  onUpload={onUploadImage}
                  comments={commentMarkers}
                  activeCommentId={activeCommentId}
                  commentMode={commentMode}
                  onAddComment={(anchor) => {
                    setPendingAnchor(anchor);
                    setRailOpen(true);
                    setRailTab('comments');
                  }}
                  variant={effectiveMode === 'wysiwyg' ? 'wysiwyg' : 'visual'}
                />
              ) : (
                <MarkdownSourceEditor
                  dir={activeLangDir}
                  label={t('editor.markdownPlaceholder')}
                  value={content}
                  onChange={setContent}
                  placeholder={t('editor.markdownPlaceholder')}
                />
              )}
            </div>
          </section>
        ) : (
          <section className="grid place-items-center text-center">
            <div>
              <FileText className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">{t('editor.noPageSelected')}</p>
              <p className="mt-1 text-muted-foreground text-sm">{t('editor.noPageSelectedHint')}</p>
              {defaultLanguageId ? (
                <Button className="mt-4 cursor-pointer" onClick={() => addPage(null, defaultLanguageId)}>
                  <Plus className="size-4" /> {t('editor.newPage')}
                </Button>
              ) : null}
            </div>
          </section>
        )}

        {/* Right rail: Figma-style tabbed panel — Comments / AI */}
        {showRail && activeId ? (
          <aside className="hidden min-h-0 flex-col overflow-hidden border-border border-s bg-sidebar/40 xl:flex">
            <Tabs value={railTab} onValueChange={(value) => setRailTab(value === 'ai' ? 'ai' : 'comments')} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="m-2 self-start">
                <TabsTrigger value="comments">{t('editor.comments')}</TabsTrigger>
                <TabsTrigger value="ai">{t('editor.ai')}</TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-0">
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
                  <AiAssist content={content} onContentChange={setContent} projectId={projectId} />
                )}
              </div>
            </Tabs>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A segmented-control button used for the editor mode toggle (Visual / Rich text / Markdown). */
function SegButton({
  active,
  onClick,
  icon,
  children,
  disabled = false,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      aria-label={typeof children === 'string' ? children : title}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-[13px] transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </button>
  );
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
