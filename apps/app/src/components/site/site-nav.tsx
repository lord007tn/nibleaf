import { cn } from '@nibleaf/design-system/lib/utils';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PageIcon } from '@/components/site/page-icon';
import type { NavNode } from '@/hooks/api';
import { siteHref } from '@/lib/site-paths';

/** First navigable page in document order — used to highlight the home page's entry. */
export function firstLeafPath(nodes: NavNode[]): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'GROUP') {
      const child = firstLeafPath(node.children);
      if (child) {
        return child;
      }
    } else {
      return node.path;
    }
  }
  return undefined;
}

function NavLink({ node, projectId, currentPath, lang, version, depth, rail }: NavItemProps & { node: NavNode; rail?: boolean }) {
  const active = currentPath === node.path;
  return (
    <li>
      <a
        href={siteHref(projectId, node.path, { lang, version })}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
          active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          // Entries in a railed list recolor their segment of the rail when active.
          rail && active && 'before:absolute before:-start-[13px] before:inset-y-1 before:w-[1.5px] before:rounded-full before:bg-primary',
        )}
      >
        <PageIcon name={node.icon} className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80')} />
        <span className="truncate">{node.title}</span>
        {node.tag ? (
          <span className="ms-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-[10px] text-primary uppercase tracking-wide">
            {node.tag}
          </span>
        ) : null}
      </a>
      {node.children.length > 0 ? (
        <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} version={version} rail />
      ) : null}
    </li>
  );
}

/** Top-level groups render as Mintlify-style section headers (sentence case,
 *  semibold, generous spacing). They stay collapsible — the chevron only shows
 *  on hover so the resting state reads as a plain heading. */
function NavSection({ node, projectId, currentPath, lang, version, depth }: NavItemProps & { node: NavNode }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="mt-7 first:mt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1 text-start font-semibold text-foreground text-sm"
      >
        <span className="truncate">{node.title}</span>
        {/* Resting state hides the chevron on fine pointers only; keyboard focus,
            touch devices, and the collapsed state always show it. */}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 rtl:-scale-x-100',
            open ? 'rotate-90' : 'opacity-100',
          )}
        />
      </button>
      {open && node.children.length > 0 ? (
        <div className="mt-1">
          <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} version={version} />
        </div>
      ) : null}
    </li>
  );
}

/** Nested groups render as collapsible rows styled like items. */
function NavSubGroup({ node, projectId, currentPath, lang, version, depth }: NavItemProps & { node: NavNode }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start font-medium text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform rtl:-scale-x-100', open && 'rotate-90')} />
        <span className="truncate">{node.title}</span>
      </button>
      {open && node.children.length > 0 ? (
        <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} version={version} rail />
      ) : null}
    </li>
  );
}

interface NavItemProps {
  projectId: string;
  currentPath: string;
  depth: number;
  lang?: string;
  /** Non-default version path prefix, e.g. "next". Default/latest is undefined. */
  version?: string;
}

function NavItems({ nodes, rail, ...rest }: NavItemProps & { nodes: NavNode[]; rail?: boolean }) {
  return (
    <ul className={cn('space-y-px', rail && 'ms-3 border-border/70 border-s ps-3')}>
      {nodes.map((node) => {
        if (node.kind === 'GROUP') {
          return rest.depth === 0 ? <NavSection key={node.id} node={node} {...rest} /> : <NavSubGroup key={node.id} node={node} {...rest} />;
        }
        return <NavLink key={node.id} node={node} rail={rail} {...rest} />;
      })}
    </ul>
  );
}

export function SiteNav({
  nodes,
  projectId,
  currentPath,
  lang,
  version,
}: {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  lang?: string;
  version?: string;
}) {
  return (
    <nav>
      <NavItems nodes={nodes} projectId={projectId} currentPath={currentPath} depth={0} lang={lang} version={version} />
    </nav>
  );
}
