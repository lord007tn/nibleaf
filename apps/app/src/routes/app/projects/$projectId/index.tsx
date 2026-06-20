import { useDebouncedCallback } from '@tanstack/react-pacer';
import { createFileRoute } from '@tanstack/react-router';
import { Check, FileText, FolderPlus, GitBranch, Loader2, PanelRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AiAssist } from '@/components/editor/ai-assist';
import { CommentsPanel } from '@/components/editor/comments-panel';
import { LanguageTabs } from '@/components/editor/language-tabs';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Language, PageNode } from '@/hooks/api';
import { useCreatePage, useDeletePage, useLanguages, usePage, usePages, useUpdatePage, useUploadAsset } from '@/hooks/api';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/app/projects/$projectId/')({
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
  const { projectId } = Route.useParams();

  // ─── Languages ─────────────────────────────────────────────────────────────
  const { data: languages } = useLanguages(projectId);
  const [activeLanguageId, setActiveLanguageId] = useState<string | null>(null);

  // Default to the project's default language (fallback: first) once languages load.
  useEffect(() => {
    if (!languages || languages.length === 0 || activeLanguageId) {
      return;
    }
    const fallback = languages.find((l) => l.isDefault) ?? languages[0];
    if (fallback) {
      setActiveLanguageId(fallback.id);
    }
  }, [languages, activeLanguageId]);

  const activeLanguage = useMemo<Language | undefined>(() => languages?.find((l) => l.id === activeLanguageId), [languages, activeLanguageId]);
  const activeLangDir: 'ltr' | 'rtl' = activeLanguage?.direction === 'RTL' ? 'rtl' : 'ltr';

  // ─── Pages (scoped to the active language) ──────────────────────────────────
  const { data: pages, isPending } = usePages(projectId, activeLanguageId ?? undefined);
  const createPage = useCreatePage(projectId);
  const deletePage = useDeletePage(projectId);
  const updatePage = useUpdatePage(projectId);
  const uploadAsset = useUploadAsset(projectId);

  // Upload an image (paste/drop/pick) and return its hosted URL for the editor.
  const onUploadImage = async (file: File): Promise<string | null> => {
    try {
      return (await uploadAsset.mutateAsync(file)).url;
    } catch {
      toast.error('Image upload failed.');
      return null;
    }
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const firstPageId = useMemo(() => (pages ?? []).find((p) => p.kind === 'PAGE')?.id ?? null, [pages]);
  const activeId = selectedId ?? firstPageId;

  const { data: page } = usePage(projectId, activeId ?? undefined);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [railOpen, setRailOpen] = useState(true);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const loadedFor = useRef<string | null>(null);

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

  const { roots, childrenOf } = useMemo(() => buildTree(pages ?? []), [pages]);

  // Switch language: reset the selected page so the tree re-points at the new language.
  const switchLanguage = (languageId: string) => {
    setActiveLanguageId(languageId);
    setSelectedId(null);
    loadedFor.current = null;
  };

  const onLanguageCreated = (language: Language) => {
    switchLanguage(language.id);
  };

  const addPage = (parentId: string | null) =>
    createPage.mutate(
      { title: 'Untitled', parentId, ...(activeLanguageId ? { languageId: activeLanguageId } : {}) },
      { onSuccess: (created) => setSelectedId(created.id), onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed') },
    );
  const addGroup = () =>
    createPage.mutate(
      { title: 'New group', kind: 'GROUP', ...(activeLanguageId ? { languageId: activeLanguageId } : {}) },
      { onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed') },
    );

  const renderItem = (node: PageNode) => (
    <button
      key={node.id}
      type="button"
      onClick={() => setSelectedId(node.id)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm',
        activeId === node.id ? 'bg-accent text-accent-foreground' : 'text-foreground/80 hover:bg-muted',
      )}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.title}</span>
    </button>
  );

  const showRail = railOpen && Boolean(activeId && page);
  const crumbSection = useMemo(() => {
    if (!page) {
      return null;
    }
    const parent = page.parentId ? (pages ?? []).find((p) => p.id === page.parentId) : null;
    return parent?.title ?? null;
  }, [page, pages]);

  return (
    <div className={cn('grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[260px_1fr]', showRail && 'xl:grid-cols-[260px_1fr_300px]')}>
      {/* Page tree */}
      <aside className="flex flex-col border-border border-e bg-sidebar/40">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Pages</span>
          <div className="flex gap-0.5">
            <Button size="icon-xs" variant="ghost" className="cursor-pointer" onClick={addGroup} title="New group">
              <FolderPlus className="size-3.5" />
            </Button>
            <Button size="icon-xs" variant="ghost" className="cursor-pointer" onClick={() => addPage(null)} title="New page">
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Active-language header */}
        {activeLanguage ? (
          <div className="flex items-center gap-2 px-4 pb-2">
            <span className="font-semibold text-[13px] text-foreground">
              {activeLanguage.label} <span className="font-mono text-[11px] text-muted-foreground">({activeLanguage.code})</span>
            </span>
            {activeLanguage.isDefault ? (
              <span className="rounded-md bg-accent px-1.5 py-0.5 font-medium text-[10px] text-accent-foreground">Default</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {isPending ? (
            <p className="px-2 text-muted-foreground text-sm">Loading…</p>
          ) : (
            roots.map((node) =>
              node.kind === 'GROUP' ? (
                <div key={node.id} className="mt-3">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">{node.title}</span>
                    <Button size="icon-xs" variant="ghost" className="cursor-pointer" onClick={() => addPage(node.id)}>
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
      </aside>

      {/* Editor + preview */}
      {activeId && page ? (
        <section className="flex min-w-0 flex-col">
          <div className="flex items-center gap-3 border-border border-b px-5 py-3">
            <Input
              className="h-9 border-0 bg-transparent px-0 font-semibold text-lg shadow-none focus-visible:ring-0"
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Page title"
              value={title}
            />
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              {status === 'saving' ? (
                <>
                  <Loader2 className="size-3 animate-spin" /> Saving
                </>
              ) : status === 'saved' ? (
                <>
                  <Check className="size-3 text-primary" /> Saved
                </>
              ) : null}
            </span>
            <Tabs onValueChange={(v) => setMode(v as 'edit' | 'preview')} value={mode}>
              <TabsList>
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="icon-sm"
              variant="ghost"
              className="cursor-pointer"
              onClick={() => {
                if (confirm('Delete this page?')) {
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
              title={railOpen ? 'Hide AI & comments' : 'Show AI & comments'}
              variant={railOpen ? 'secondary' : 'ghost'}
            >
              <PanelRight className="size-4" />
            </Button>
          </div>

          {/* Editor sub-toolbar: static branch chip + breadcrumb + language controls */}
          <div className="flex h-12 items-center gap-3 border-border border-b px-5">
            <span
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 font-medium text-[12.5px] text-muted-foreground"
              title="Branch (read-only)"
            >
              <GitBranch className="size-3.5" /> main
            </span>
            <span className="h-5 w-px bg-border" />
            <div className="min-w-0 truncate text-[13px] text-muted-foreground">
              {crumbSection ? (
                <>
                  {crumbSection} <span className="mx-1.5 text-muted-foreground/60">/</span>
                </>
              ) : null}
              <span className="font-medium text-foreground">{page.title}</span>
            </div>
            <div className="ms-auto">
              <LanguageTabs
                projectId={projectId}
                languages={languages ?? []}
                activeLanguageId={activeLanguageId}
                onSelect={switchLanguage}
                onCreated={onLanguageCreated}
              />
            </div>
          </div>

          {mode === 'edit' ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              <TiptapEditor value={content} onChange={setContent} dir={activeLangDir} onUpload={onUploadImage} />
            </div>
          ) : (
            // Preview mode: render the draft exactly as it will appear on the
            // published website (same renderer, site typography, title + description).
            <div className="min-h-0 flex-1 overflow-y-auto bg-background">
              <article className="mx-auto w-full max-w-3xl px-8 py-12" dir={activeLangDir}>
                <h1 className="font-semibold text-4xl tracking-tight">{title || 'Untitled'}</h1>
                {page.description ? <p className="mt-2 text-lg text-muted-foreground">{page.description}</p> : null}
                <div className="mt-6">
                  <Markdown content={content} />
                </div>
              </article>
            </div>
          )}
        </section>
      ) : (
        <section className="grid place-items-center text-center">
          <div>
            <FileText className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No page selected</p>
            <p className="mt-1 text-muted-foreground text-sm">Pick a page from the tree, or create one.</p>
            <Button className="mt-4 cursor-pointer" onClick={() => addPage(null)}>
              <Plus className="size-4" /> New page
            </Button>
          </div>
        </section>
      )}

      {/* Right rail: AI assist + comments */}
      {showRail && activeId ? (
        <aside className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-border border-s bg-sidebar/40 p-4 xl:flex">
          <AiAssist content={content} onContentChange={setContent} projectId={projectId} />
          <CommentsPanel pageId={activeId} projectId={projectId} />
        </aside>
      ) : null}
    </div>
  );
}
