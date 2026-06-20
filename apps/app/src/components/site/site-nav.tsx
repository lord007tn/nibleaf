import { Link } from '@tanstack/react-router';
import type { NavNode } from '@/hooks/api';
import { cn } from '@/lib/utils';

function NavItems({ nodes, projectId, currentPath, depth }: { nodes: NavNode[]; projectId: string; currentPath: string; depth: number }) {
  return (
    <ul className={cn('space-y-0.5', depth > 0 && 'ms-3 border-border border-s ps-2')}>
      {nodes.map((node) =>
        node.kind === 'GROUP' ? (
          <li key={node.id} className="mt-4 first:mt-0">
            <div className="px-2 py-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">{node.title}</div>
            {node.children.length > 0 ? <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth} /> : null}
          </li>
        ) : (
          <li key={node.id}>
            <Link
              to="/sites/$projectId/$"
              params={{ projectId, _splat: node.path }}
              className={cn(
                'block rounded-md px-2 py-1.5 text-sm transition-colors',
                currentPath === node.path ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground/75 hover:bg-muted hover:text-foreground',
              )}
            >
              {node.title}
            </Link>
            {node.children.length > 0 ? <NavItems nodes={node.children} projectId={projectId} currentPath={currentPath} depth={depth + 1} /> : null}
          </li>
        ),
      )}
    </ul>
  );
}

export function SiteNav({ nodes, projectId, currentPath }: { nodes: NavNode[]; projectId: string; currentPath: string }) {
  return (
    <nav className="py-6 pe-4">
      <NavItems nodes={nodes} projectId={projectId} currentPath={currentPath} depth={0} />
    </nav>
  );
}
