import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PageIcon } from '@/components/site/page-icon';
import type { NavNode } from '@/hooks/api';
import { cn } from '@/lib/utils';

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

function NavLink({ node, projectId, currentPath, lang, depth }: NavItemProps & { node: NavNode }) {
  const active = currentPath === node.path;
  return (
    <li>
      <Link
        to="/sites/$projectId/$"
        params={{ projectId, _splat: node.path }}
        search={{ lang }}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/75 hover:bg-muted hover:text-foreground',
        )}
      >
        <PageIcon name={node.icon} className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
        <span className="truncate">{node.title}</span>
        {node.tag ? (
          <span className="ms-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-[10px] text-primary uppercase tracking-wide">
            {node.tag}
          </span>
        ) : null}
      </Link>
      {node.children.length > 0 ? (
        <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} />
      ) : null}
    </li>
  );
}

function NavGroup({ node, projectId, currentPath, lang, depth }: NavItemProps & { node: NavNode }) {
  // Groups expand by default (Mintlify shows their pages); collapsing is a
  // convenience for long sidebars. A nested page being active keeps it open.
  const [open, setOpen] = useState(true);
  return (
    <li className="mt-4 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 shrink-0 transition-transform rtl:-scale-x-100', open && 'rotate-90')} />
        <span className="truncate">{node.title}</span>
      </button>
      {open && node.children.length > 0 ? (
        <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} />
      ) : null}
    </li>
  );
}

interface NavItemProps {
  projectId: string;
  currentPath: string;
  depth: number;
  lang?: string;
}

function NavItems({ nodes, ...rest }: NavItemProps & { nodes: NavNode[] }) {
  return (
    <ul className={cn('space-y-0.5', rest.depth > 0 && 'ms-3 border-border border-s ps-2')}>
      {nodes.map((node) =>
        node.kind === 'GROUP' ? <NavGroup key={node.id} node={node} {...rest} /> : <NavLink key={node.id} node={node} {...rest} />,
      )}
    </ul>
  );
}

export function SiteNav({ nodes, projectId, currentPath, lang }: { nodes: NavNode[]; projectId: string; currentPath: string; lang?: string }) {
  return (
    <nav className="py-6 pe-4">
      <NavItems nodes={nodes} projectId={projectId} currentPath={currentPath} depth={0} lang={lang} />
    </nav>
  );
}
