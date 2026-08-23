import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { createFileRoute } from '@tanstack/react-router';
import { Eye, FileText, GitPullRequest } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { getGitPreviewFn } from '@/functions/site';

export const Route = createFileRoute('/git-preview/$token')({
  loader: async ({ params }) => JSON.parse(await getGitPreviewFn({ data: { token: params.token } })) as { snapshot: SiteSnapshot },
  head: () => ({ meta: [{ title: 'Pull request preview · Nibleaf' }, { name: 'robots', content: 'noindex,nofollow' }] }),
  component: GitPreviewPage,
});

function GitPreviewPage() {
  const { snapshot } = Route.useLoaderData();
  const pages = useMemo(() => snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden), [snapshot.pages]);
  const [pageId, setPageId] = useState(pages[0]?.id);
  const page = pages.find((item) => item.id === pageId) ?? pages[0];
  return (
    <div className="grid min-h-screen grid-cols-[280px_1fr] bg-background">
      <aside className="flex min-h-screen flex-col border-border border-e bg-card/60">
        <div className="border-border border-b p-4">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <GitPullRequest className="size-4" /> Pull request preview
          </div>
          <p className="mt-1 text-muted-foreground text-xs">Immutable snapshot · not indexed</p>
        </div>
        <ScrollArea className="flex-1">
          <nav className="p-3" aria-label="Preview pages">
            {pages.map((item) => (
              <button
                className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm ${item.id === page?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                key={item.id}
                onClick={() => setPageId(item.id)}
                type="button"
              >
                <FileText className="size-3.5" />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </nav>
        </ScrollArea>
      </aside>
      <main className="min-w-0 p-10">
        <article className="mx-auto max-w-4xl">
          {page ? (
            <>
              <div className="mb-8 border-border border-b pb-5">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Eye className="size-4" /> {page.path || '/'}
                </div>
                <h1 className="mt-2 font-semibold text-3xl tracking-tight">{page.title}</h1>
                {page.description ? <p className="mt-2 text-muted-foreground">{page.description}</p> : null}
              </div>
              <Markdown content={page.content} site={{ projectId: snapshot.project.id, lang: page.languageCode, version: page.versionId }} />
            </>
          ) : (
            <p className="text-muted-foreground">This preview contains no visible pages.</p>
          )}
        </article>
      </main>
    </div>
  );
}
