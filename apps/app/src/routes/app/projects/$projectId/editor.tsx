import { useDebouncedCallback } from '@tanstack/react-pacer';
import { createFileRoute } from '@tanstack/react-router';
import { Check, FileText, FolderPlus, Languages, Loader2, PanelRight, Plus, Settings2, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import { AiAssist } from '@/components/editor/ai-assist';
import { BranchSwitcher } from '@/components/editor/branch-switcher';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { LanguageSettingsDialog } from '@/components/editor/language-settings-dialog';
import { PageSettingsDialog } from '@/components/editor/page-settings-dialog';
import { ConfigSection, type ConfigSectionId, ConfigSectionList } from '@/components/editor/site-config-panel';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Language, PageNode } from '@/hooks/api';
import {
  useBranches,
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
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/app/projects/$projectId/editor')({
  component: EditorPage,
});

function buildTree(pages: PageNode[]): { roots: PageNode[]; childrenOf: Map<string, PageNode[]> } {
  const childrenOf = new Map<string, PageNode[]>();
  for (const page of pages) {
    const key = page.parentId ?? '__root';
    const list = childrenOf.get(key) ?? [];
    list.push(page);
    childrenOf.set(key, list);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.position - b.position);
  }
  return { roots: childrenOf.get('__root') ?? [], childrenOf };
}

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

  // ─── Drag-to-reorder pages within a language's tree ──────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  /** Drop page `draggedId` just before `targetId` — joining the target's parent.
   *  Only reorders PAGES within the same language; renumbers the new sibling run. */
  const movePage = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }
    const pages = allPages ?? [];
    const dragged = pages.find((p) => p.id === draggedId);
    const target = pages.find((p) => p.id === targetId);
    if (!dragged || !target || dragged.kind !== 'PAGE' || dragged.languageId !== target.languageId) {
      return;
    }
    const newParent = target.parentId ?? null;
    const siblings = pages
      .filter((p) => p.languageId === target.languageId && (p.parentId ?? null) === newParent && p.id !== draggedId)
      .sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((p) => p.id === targetId);
    if (idx < 0) {
      return;
    }
    siblings.splice(idx, 0, dragged);
    reorderPages.mutate({ items: siblings.map((p, i) => ({ id: p.id, parentId: newParent, position: i })) });
  };

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
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [addLangOpen, setAddLangOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [langSettings, setLangSettings] = useState<Language | null>(null);
  const loadedFor = useRef<string | null>(null);

  // The active page's language drives the editor/preview text direction.
  const activeLanguage = useMemo(() => languages?.find((l) => l.id === page?.languageId), [languages, page?.languageId]);
  const activeLangDir: 'ltr' | 'rtl' = activeLanguage?.direction === 'RTL' ? 'rtl' : 'ltr';

  // Load the selected page into the local draft.
  useEffect(() => {
    if (page && loadedFor.current !== page.id) {
      setTitle(page.title);
      setContent(page.content);
      loadedFor.current = page.id;
      setStatus('idle');
    }
  }, [page]);

  // Debounced autosave: fire ~700ms after the user stops typing the title/content.
  const saveDraft = useDebouncedCallback(
    (pageId: string, draft: { title: string; content: string }) => {
      updatePage.mutate({ pageId, body: draft }, { onSuccess: () => setStatus('saved'), onError: () => setStatus('idle') });
    },
    { wait: 700 },
  );

  useEffect(() => {
    if (!page || loadedFor.current !== page.id) {
      return;
    }
    if (title === page.title && content === page.content) {
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

  const renderItem = (node: PageNode) => (
    <button
      key={node.id}
      type="button"
      draggable
      onClick={() => setSelectedId(node.id)}
      onDragStart={(event) => {
        setDraggingId(node.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        setDraggingId(null);
        setDragOverId(null);
      }}
      onDragOver={(event) => {
        if (draggingId && draggingId !== node.id) {
          event.preventDefault();
          setDragOverId(node.id);
        }
      }}
      onDragLeave={() => setDragOverId((cur) => (cur === node.id ? null : cur))}
      onDrop={(event) => {
        event.preventDefault();
        if (draggingId) {
          movePage(draggingId, node.id);
        }
        setDraggingId(null);
        setDragOverId(null);
      }}
      className={cn(
        'flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm active:cursor-grabbing',
        activeId === node.id ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-muted',
        draggingId === node.id && 'opacity-40',
        dragOverId === node.id && 'border-primary border-t-2',
      )}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.config?.sidebarTitle?.trim() || node.title}</span>
    </button>
  );

  const showRail = view === 'content' && railOpen && Boolean(activeId && page);
  const crumbSection = useMemo(() => {
    if (!page) {
      return null;
    }
    const parent = page.parentId ? (allPages ?? []).find((p) => p.id === page.parentId) : null;
    return parent?.title ?? null;
  }, [page, allPages]);

  return (
    <div className={cn('grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[260px_1fr]', showRail && 'xl:grid-cols-[260px_1fr_300px]')}>
      {/* Left rail: Content (page tree) or Configuration (site config sections) */}
      <aside className="flex min-h-0 flex-col border-border border-e bg-sidebar/40">
        <div className="px-2 pt-3 pb-2">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <SegButton active={view === 'content'} onClick={() => setView('content')} icon={<FileText className="size-3.5" />}>
              {t('editor.mode.content')}
            </SegButton>
            <SegButton active={view === 'config'} onClick={() => setView('config')} icon={<SlidersHorizontal className="size-3.5" />}>
              {t('editor.mode.configuration')}
            </SegButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {view === 'config' ? (
            <ConfigSectionList active={configSection} onSelect={setConfigSection} />
          ) : isPending ? (
            <p className="px-2 text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : (
            <>
              {orderedLanguages.map((lang) => {
                const dir = lang.direction === 'RTL' ? 'rtl' : 'ltr';
                const { roots, childrenOf } = buildTree(pagesByLanguage.get(lang.id) ?? []);
                return (
                  <div key={lang.id} className="mb-2">
                    {/* Language section header */}
                    <div className="group flex items-center justify-between px-2 py-1.5">
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[12.5px] text-foreground" dir={dir}>
                        <Languages className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{lang.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">({lang.code})</span>
                        {lang.isDefault ? (
                          <span className="rounded bg-accent px-1.5 py-0.5 font-medium text-[9px] text-accent-foreground">{t('editor.default')}</span>
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

                    {/* This language's page tree */}
                    <div className="space-y-0.5" dir={dir}>
                      {roots.length === 0 ? (
                        <p className="px-2 py-1 text-[12px] text-muted-foreground/70">{t('editor.noPagesYet')}</p>
                      ) : (
                        roots.map((node) =>
                          node.kind === 'GROUP' ? (
                            <div key={node.id} className="mt-2">
                              <div className="flex items-center justify-between px-2 py-1">
                                <span className="truncate font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">{node.title}</span>
                                <Button size="icon-xs" variant="ghost" className="cursor-pointer" onClick={() => addPage(node.id, lang.id)}>
                                  <Plus className="size-3" />
                                </Button>
                              </div>
                              {(childrenOf.get(node.id) ?? []).map(renderItem)}
                            </div>
                          ) : (
                            renderItem(node)
                          ),
                        )
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
      </aside>

      {/* Main area: site configuration */}
      {view === 'config' ? (
        <section className="min-w-0 overflow-y-auto">
          <div className="border-border border-b px-6 py-4">
            <h1 className="font-semibold text-lg tracking-tight">{t('editor.config.heading')}</h1>
          </div>
          <div className="mx-auto max-w-[660px] px-8 pt-7 pb-32">{project ? <ConfigSection project={project} section={configSection} /> : null}</div>
        </section>
      ) : activeId && page ? (
        /* Main area: page editor */
        <section className="flex min-w-0 flex-col">
          <div className="flex items-center gap-3 border-border border-b px-5 py-3">
            <Input
              className="h-9 border-0 bg-transparent px-0 font-semibold text-lg shadow-none focus-visible:ring-0"
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('editor.pageTitlePlaceholder')}
              value={title}
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
            <Button
              size="icon-sm"
              variant="ghost"
              className="cursor-pointer"
              onClick={() => setSettingsOpen(true)}
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
            <PageSettingsDialog projectId={projectId} page={page} open={settingsOpen} onOpenChange={setSettingsOpen} />
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

          {/* Editor sub-toolbar: branch switcher + language-aware breadcrumb */}
          <div className="flex h-12 items-center gap-3 border-border border-b px-5">
            <BranchSwitcher
              projectId={projectId}
              branches={branches ?? []}
              activeBranchId={activeBranchId}
              onSwitch={(id) => {
                setActiveBranchId(id);
                setSelectedId(null);
                loadedFor.current = null;
              }}
            />
            <span className="h-5 w-px bg-border" />
            <div className="min-w-0 truncate text-[13px] text-muted-foreground">
              {activeLanguage ? (
                <>
                  {activeLanguage.label} <span className="font-mono text-[11px] opacity-70">({activeLanguage.code})</span>
                  <span className="mx-1.5 text-muted-foreground/60">/</span>
                </>
              ) : null}
              {crumbSection ? (
                <>
                  {crumbSection} <span className="mx-1.5 text-muted-foreground/60">/</span>
                </>
              ) : null}
              <span className="font-medium text-foreground">{page.title}</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
            <TiptapEditor value={content} onChange={setContent} dir={activeLangDir} onUpload={onUploadImage} />
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
                <CommentsPanel pageId={activeId} projectId={projectId} />
              ) : (
                <AiAssist content={content} onContentChange={setContent} projectId={projectId} />
              )}
            </div>
          </Tabs>
        </aside>
      ) : null}
    </div>
  );
}

/** A segmented-control button used for the Content / Configuration toggle. */
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
