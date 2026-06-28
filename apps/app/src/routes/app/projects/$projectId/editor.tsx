import { useDebouncedCallback } from '@tanstack/react-pacer';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Check,
  ChevronLeft,
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
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import { AiAssist } from '@/components/editor/ai-assist';
import { BranchSwitcher } from '@/components/editor/branch-switcher';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { LanguageSettingsDialog } from '@/components/editor/language-settings-dialog';
import { PageSettingsDialog } from '@/components/editor/page-settings-dialog';
import { ConfigSection, type ConfigSectionId, ConfigSectionList } from '@/components/editor/site-config-panel';
import { SortablePageTree } from '@/components/editor/sortable-page-tree';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/app/projects/$projectId/editor')({
  component: EditorPage,
});

function EditorPage() {
  const t = useT();
  const { projectId } = Route.useParams();
  const { data: project } = useProject(projectId);

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const firstPageId = useMemo(() => (allPages ?? []).find((p) => p.kind === 'PAGE')?.id ?? null, [allPages]);
  const activeId = selectedId ?? firstPageId;

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
  // How the page body is edited: WYSIWYG, raw Markdown/MDX, or a rendered preview.
  // Content is Markdown end-to-end, so all three share the one `content` string.
  const [editorMode, setEditorMode] = useState<'visual' | 'markdown' | 'preview'>(() => {
    if (typeof window === 'undefined') {
      return 'visual';
    }
    const stored = window.localStorage.getItem('plume.editor.contentMode');
    return stored === 'markdown' || stored === 'preview' ? stored : 'visual';
  });
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

  // Resizable left sidebar (persisted). Clamp to a sensible range.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return 260;
    }
    const stored = Number(window.localStorage.getItem('plume.editor.sidebarWidth'));
    return stored >= 200 && stored <= 520 ? stored : 260;
  });
  useEffect(() => {
    window.localStorage.setItem('plume.editor.sidebarWidth', String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    try {
      window.localStorage.setItem('plume.editor.contentMode', editorMode);
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, [editorMode]);
  // Collapse the page-tree sidebar to give the canvas full width (Mintlify-style;
  // the toggle lives in the editor toolbar, not a breadcrumb). Persisted.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem('plume.editor.sidebarCollapsed') === '1';
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('plume.editor.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  }, [sidebarCollapsed]);

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
      setTitle(page.title);
      setContent(page.content);
      synced.current = { id: page.id, content: page.content, title: page.title };
      setStatus('idle');
    }
  }, [page, content, title]);

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
    if (!page || synced.current?.id !== page.id) {
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

  const branchScope = activeBranchId ? { branchId: activeBranchId } : {};
  const addPage = (parentId: string | null, languageId: string) =>
    createPage.mutate(
      { title: 'Untitled', parentId, languageId, ...branchScope },
      { onSuccess: (created) => setSelectedId(created.id), onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.createFailed')) },
    );
  const addGroup = (languageId: string) =>
    createPage.mutate(
      { title: 'New group', kind: 'GROUP', languageId, ...branchScope },
      { onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.createFailed')) },
    );

  const showRail = view === 'content' && railOpen && Boolean(activeId && page);

  // Comments on the active page — anchored highlights in the editor + the rail.
  const { data: pageComments } = useComments(projectId, activeId ?? undefined);
  const commentMarkers = useMemo(
    () => (pageComments ?? []).filter((c) => c.anchor?.quote).map((c) => ({ id: c.id, quote: c.anchor?.quote ?? '', resolved: c.resolved })),
    [pageComments],
  );
  const toggleCommentMode = () => {
    setCommentMode((on) => {
      const next = !on;
      if (next) {
        setEditorMode('visual');
        setRailOpen(true);
        setRailTab('comments');
      } else {
        setPendingAnchor(null);
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar — workspace controls (Mintlify-style): back + branch on the left,
          configure / preview / publish on the right. No breadcrumb. */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-border border-b bg-background px-3">
        <Link
          to="/app/projects/$projectId"
          params={{ projectId }}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('editor.backToDashboard')}
        >
          <ChevronLeft className="size-4" />
          <span className="max-w-[200px] truncate font-medium text-foreground text-sm">{project?.name ?? ''}</span>
        </Link>
        <span className="h-5 w-px bg-border" />
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
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
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
        <div className="ms-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={view === 'config' ? 'secondary' : 'ghost'}
            className="cursor-pointer"
            onClick={() => setView((v) => (v === 'config' ? 'content' : 'config'))}
          >
            <SlidersHorizontal className="size-3.5" /> {t('editor.mode.configuration')}
          </Button>
          <Button
            render={
              // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
              <a aria-label={t('project.preview')} href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
            }
            size="sm"
            variant="outline"
            className="cursor-pointer"
          >
            <Eye className="size-3.5" /> {t('project.preview')}
          </Button>
          {project ? <PublishControl project={project} /> : null}
        </div>
      </header>

      {/* Editor grid: page-tree sidebar + canvas (+ comments rail) */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--editor-sidebar)_1fr]',
          showRail && 'xl:grid-cols-[var(--editor-sidebar)_1fr_300px]',
        )}
        style={{ '--editor-sidebar': sidebarCollapsed ? '0px' : `${sidebarWidth}px` } as CSSProperties}
      >
        <aside
          className={cn('relative flex min-h-0 flex-col overflow-hidden border-border border-e bg-sidebar/40', sidebarCollapsed && 'border-e-0')}
          aria-hidden={sidebarCollapsed}
        >
          {!sidebarCollapsed ? <SidebarResizer onResize={setSidebarWidth} /> : null}
          {/* Sidebar header: section label + the collapse control (lives ON the sidebar). */}
          <div className="flex h-11 shrink-0 items-center justify-between border-border border-b ps-3 pe-1.5">
            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {view === 'config' ? t('editor.config.heading') : t('editor.pages')}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              className="cursor-pointer"
              onClick={() => setSidebarCollapsed(true)}
              title={t('editor.hideSidebar')}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {view === 'config' ? (
              <ConfigSectionList active={configSection} onSelect={setConfigSection} />
            ) : isPending ? (
              <p className="px-2 text-muted-foreground text-sm">{t('common.loading')}</p>
            ) : (
              <>
                {orderedLanguages.map((lang) => {
                  const dir = lang.direction === 'RTL' ? 'rtl' : 'ltr';
                  const langPages = pagesByLanguage.get(lang.id) ?? [];
                  return (
                    <div key={lang.id} className="mb-2">
                      {/* Language section header */}
                      <div className="group flex items-center justify-between px-2 py-1.5">
                        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[12.5px] text-foreground" dir={dir}>
                          <Languages className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{lang.label}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">({lang.code})</span>
                          {lang.isDefault ? (
                            <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-[9px] text-accent-foreground">
                              {t('editor.default')}
                            </span>
                          ) : null}
                        </span>
                        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="cursor-pointer"
                            onClick={() => setLangSettings(lang)}
                            title={t('editor.langSettings.settings')}
                          >
                            <Settings2 className="size-3" />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="cursor-pointer"
                            onClick={() => addGroup(lang.id)}
                            title={t('editor.newGroup')}
                          >
                            <FolderPlus className="size-3" />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="cursor-pointer"
                            onClick={() => addPage(null, lang.id)}
                            title={t('editor.newPage')}
                          >
                            <Plus className="size-3" />
                          </Button>
                        </div>
                      </div>

                      {/* This language's page tree — Notion-style drag-and-drop */}
                      <div className="space-y-0.5" dir={dir}>
                        {langPages.length === 0 ? (
                          <p className="px-2 py-1 text-[12px] text-muted-foreground/70">{t('editor.noPagesYet')}</p>
                        ) : (
                          <SortablePageTree
                            pages={langPages}
                            activeId={activeId}
                            onSelect={setSelectedId}
                            onAddChild={(parentId) => addPage(parentId, lang.id)}
                            onSettings={(id) => setSettingsForId(id)}
                            onMove={(items) => reorderPages.mutate({ items })}
                          />
                        )}
                      </div>
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
          <section className="min-w-0 overflow-y-auto">
            {/* A muted overline so it reads as "Site configuration › <section>"
              rather than competing with each section's own heading. */}
            <div className="border-border border-b px-6 py-3">
              <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">{t('editor.config.heading')}</span>
            </div>
            <div className="mx-auto max-w-[660px] px-8 pt-7 pb-32">
              {project ? (
                <ConfigSection project={project} section={configSection} />
              ) : (
                <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
              )}
            </div>
          </section>
        ) : activeId && !page ? (
          <section className="grid place-items-center text-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </section>
        ) : activeId && page ? (
          /* Main area: page editor */
          <section className="flex min-w-0 flex-col">
            {/* Editor toolbar: re-expand affordance (when the sidebar is collapsed) + the
              document mode/view controls. */}
            <div className="flex h-12 items-center gap-2 border-border border-b px-4">
              {sidebarCollapsed ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => setSidebarCollapsed(false)}
                  title={t('editor.showSidebar')}
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              ) : null}
              <div className="ms-auto flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                <SegButton active={editorMode === 'visual'} onClick={() => setEditorMode('visual')} icon={<Pencil className="size-3.5" />}>
                  {t('editor.mode.visual')}
                </SegButton>
                <SegButton active={editorMode === 'markdown'} onClick={() => setEditorMode('markdown')} icon={<Code2 className="size-3.5" />}>
                  {t('editor.mode.markdown')}
                </SegButton>
                <SegButton active={editorMode === 'preview'} onClick={() => setEditorMode('preview')} icon={<Eye className="size-3.5" />}>
                  {t('editor.mode.preview')}
                </SegButton>
              </div>
              <Button
                size="icon-sm"
                variant={commentMode ? 'secondary' : 'ghost'}
                aria-pressed={commentMode}
                className="cursor-pointer"
                onClick={toggleCommentMode}
                title={t('editor.comments.mode')}
              >
                <MessageSquare className="size-4" />
              </Button>
              <Button
                render={
                  // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
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
                title={t('editor.pageSettings.title')}
              >
                <Settings2 className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="cursor-pointer"
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
              <Button
                aria-pressed={railOpen}
                className="hidden cursor-pointer xl:inline-flex"
                onClick={() => setRailOpen((v) => !v)}
                size="icon-sm"
                title={railOpen ? t('editor.hideRail') : t('editor.showRail')}
                variant={railOpen ? 'secondary' : 'ghost'}
              >
                <PanelRight className="size-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-8">
              {/* Title rendered as the first line of the document column (Mintlify-style),
                aligned to the same 720px measure as the body. */}
              <div className="mx-auto max-w-[720px]">
                {editorMode === 'preview' ? (
                  <h1 className="font-semibold text-[2.1rem] leading-[1.15] tracking-tight" dir={activeLangDir}>
                    {title || t('editor.pageTitlePlaceholder')}
                  </h1>
                ) : (
                  <input
                    className="w-full border-0 bg-transparent font-semibold text-[2.1rem] leading-[1.15] tracking-tight outline-none placeholder:text-muted-foreground/40"
                    dir={activeLangDir}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('editor.pageTitlePlaceholder')}
                    value={title}
                  />
                )}
              </div>
              {editorMode === 'visual' ? (
                // .ProseMirror self-centers at the 720px measure (tiptap.css), leaving a
                // gutter for the block handle — so it is NOT wrapped in a narrow box.
                <TiptapEditor
                  value={content}
                  onChange={setContent}
                  dir={activeLangDir}
                  onUpload={onUploadImage}
                  comments={commentMarkers}
                  activeCommentId={activeCommentId}
                  commentMode={commentMode}
                  onAddComment={(anchor) => {
                    setPendingAnchor(anchor);
                    setRailOpen(true);
                    setRailTab('comments');
                  }}
                />
              ) : editorMode === 'markdown' ? (
                <textarea
                  dir={activeLangDir}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  spellCheck={false}
                  placeholder={t('editor.markdownPlaceholder')}
                  className="mx-auto mt-4 block min-h-[60vh] w-full max-w-[720px] resize-none bg-transparent font-mono text-[13.5px] text-foreground leading-relaxed outline-none placeholder:text-muted-foreground"
                />
              ) : (
                // Live preview: the draft rendered through the exact live-site renderer.
                <div className="mx-auto mt-4 max-w-[720px]" dir={activeLangDir}>
                  <Markdown content={content} />
                </div>
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
            <Tabs value={railTab} onValueChange={(v) => setRailTab(v as 'comments' | 'ai')} className="flex min-h-0 flex-1 flex-col">
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

/** A segmented-control button used for the editor mode toggle (Visual / Markdown / Preview). */
function SegButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-[13px] transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {children}
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
