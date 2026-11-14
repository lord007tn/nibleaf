import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { blockDirection } from '@nibleaf/shared/script-direction';
import { type NavNode, navGroupHasPage, startsUngroupedBlock } from '@nibleaf/shared/site';
import { PageIcon } from '@/components/site/page-icon';

interface PreviewNavProps {
  nodes: readonly NavNode[];
  selectedId: string | undefined;
  onSelect: (pageId: string) => void;
}

/**
 * The draft preview's page list, in the reader's structure: top-level groups
 * are labelled sections, pages after a section start their own block, and
 * nested pages sit on a rail. Pages are buttons because the preview switches
 * pages in place (`?pageId=`) instead of following reader links.
 */
export function PreviewNav({ nodes, selectedId, onSelect }: PreviewNavProps) {
  const t = useT();
  return (
    <nav aria-label={t('site.docsPages')} data-preview-nav="">
      <PreviewNavItems depth={0} nodes={nodes} onSelect={onSelect} selectedId={selectedId} />
    </nav>
  );
}

function PreviewNavItems({ nodes, depth, selectedId, onSelect, rail }: PreviewNavProps & { depth: number; rail?: boolean }) {
  return (
    <ul className={cn('space-y-px', rail && 'ms-3 border-border/70 border-s ps-3')}>
      {nodes.map((node, index) => {
        if (node.kind === 'GROUP') {
          if (!navGroupHasPage(node)) return null;
          return (
            <li className={depth === 0 ? 'mt-6 first:mt-0' : undefined} key={node.id}>
              <p
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 text-sm',
                  depth === 0 ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
                )}
                dir={blockDirection(node.title)}
              >
                {depth > 0 && node.icon ? <PageIcon className="size-3.5 shrink-0" name={node.icon} /> : null}
                <span className="min-w-0 break-words">{node.title}</span>
              </p>
              <PreviewNavItems depth={depth + 1} nodes={node.children} onSelect={onSelect} rail={depth > 0} selectedId={selectedId} />
            </li>
          );
        }
        const active = node.id === selectedId;
        return (
          <li
            className={depth === 0 && startsUngroupedBlock(nodes, index) ? 'mt-6' : undefined}
            data-nav-block-start={depth === 0 && startsUngroupedBlock(nodes, index) ? '' : undefined}
            key={node.id}
          >
            <button
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors pointer-coarse:min-h-11 pointer-coarse:items-center',
                active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => onSelect(node.id)}
              type="button"
            >
              <PageIcon className="mt-0.5 size-3.5 shrink-0 pointer-coarse:mt-0" name={node.icon} />
              <span className="min-w-0 break-words" dir={blockDirection(node.title)}>
                {node.title}
              </span>
            </button>
            {node.children.length > 0 ? (
              <PreviewNavItems depth={depth + 1} nodes={node.children} onSelect={onSelect} rail selectedId={selectedId} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
