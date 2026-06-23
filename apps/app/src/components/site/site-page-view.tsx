import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { Markdown } from '@/components/markdown';
import { useSitePage } from '@/hooks/api';
import type { SitePage } from '@/hooks/api/types';
import { api } from '@/lib/api';

const sessionId = (): string => {
  if (typeof window === 'undefined') {
    return 'ssr';
  }
  const key = 'plume.sid';
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2);
    window.localStorage.setItem(key, id);
  }
  return id;
};

export function SitePageView({ projectId, path, lang, initialData }: { projectId: string; path: string; lang?: string; initialData?: SitePage }) {
  const { data, isPending, isError } = useSitePage(projectId, path, lang, initialData);

  // Record a pageview whenever the resolved page changes. (The document title +
  // meta description are owned by the route's head() so they render server-side.)
  useEffect(() => {
    if (data?.page.path) {
      api.api.public.sites[':id'].events
        .$post({
          param: { id: projectId },
          json: { type: 'pageview', path: data.page.path, sessionId: sessionId(), referrer: document.referrer || undefined },
        })
        .catch(() => undefined);
    }
  }, [data?.page.path, projectId]);

  if (isPending) {
    return <div className="px-10 py-12 text-muted-foreground text-sm">Loading…</div>;
  }
  if (isError || !data) {
    return <div className="px-10 py-12 text-muted-foreground text-sm">This page is not available.</div>;
  }

  const { page, breadcrumbs, prev, next } = data;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-10 px-8 py-10 xl:grid-cols-[1fr_200px]">
      <article className="min-w-0">
        {breadcrumbs.length > 1 ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            {breadcrumbs.slice(0, -1).map((crumb) => (
              <span key={crumb.path}>{crumb.title} /</span>
            ))}
          </div>
        ) : null}
        <h1 className="font-semibold text-4xl tracking-tight">{page.title}</h1>
        {page.description ? <p className="mt-2 text-lg text-muted-foreground">{page.description}</p> : null}
        <div className="mt-6">
          <Markdown content={page.content} />
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 border-border border-t pt-6">
          {prev ? (
            <Link
              to="/sites/$projectId/$"
              params={{ projectId, _splat: prev.path }}
              search={{ lang }}
              className="flex flex-col items-start rounded-xl border border-border p-4 hover:bg-muted"
            >
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <ChevronLeft className="size-3 rtl:-scale-x-100" /> Previous
              </span>
              <span className="mt-1 font-medium">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to="/sites/$projectId/$"
              params={{ projectId, _splat: next.path }}
              search={{ lang }}
              className="flex flex-col items-end rounded-xl border border-border p-4 text-end hover:bg-muted"
            >
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                Next <ChevronRight className="size-3 rtl:-scale-x-100" />
              </span>
              <span className="mt-1 font-medium">{next.title}</span>
            </Link>
          ) : (
            <span />
          )}
        </div>
      </article>

      {/* Table of contents */}
      <aside className="hidden xl:block">
        {page.headings.length > 0 ? (
          <div className="sticky top-20">
            <div className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">On this page</div>
            <ul className="space-y-1.5 border-border border-s ps-3 text-sm">
              {page.headings
                .filter((h) => h.depth <= 3)
                .map((heading) => (
                  <li key={heading.id} style={{ paddingInlineStart: (heading.depth - 1) * 8 }}>
                    <a className="text-muted-foreground transition-colors hover:text-foreground" href={`#${heading.id}`}>
                      {heading.text}
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
