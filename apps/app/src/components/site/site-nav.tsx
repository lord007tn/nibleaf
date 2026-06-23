import { Link } from '@tanstack/react-router';
import type { NavNode } from '@/hooks/api';
import { cn } from '@/lib/utils';

function NavItems({
  nodes,
  projectId,
  currentPath,
  depth,
  lang,
}: {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  depth: number;
  lang?: string;
}) {
  return (
    <ul className={cn('space-y-0.5', depth > 0 && 'ms-3 border-border border-s ps-2')}>
      {nodes.map((node) =>
        node.kind === 'GROUP' ? (
          <li key={node.id} className="mt-4 first:mt-0">
            <div className="px-2 py-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">{node.title}</div>
            {node.children.length > 0 ? (
              <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth} lang={lang} />
            ) : null}
          </li>
        ) : (
          <li key={node.id}>
            <Link
              to="/sites/$projectId/$"
              params={{ projectId, _splat: node.path }}
              search={{ lang }}
              className={cn(
                'block rounded-md px-2 py-1.5 text-sm transition-colors',
                currentPath === node.path
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-foreground/75 hover:bg-muted hover:text-foreground',
              )}
            >
              {node.title}
            </Link>
            {node.children.length > 0 ? (
              <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} lang={lang} />
            ) : null}
          </li>
        ),
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
