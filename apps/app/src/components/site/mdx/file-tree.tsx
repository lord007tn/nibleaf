import { cn } from '@nibleaf/design-system/lib/utils';
import { ChevronRight, File as FileIcon, FolderClosed, FolderOpen } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { truthyAttr } from './utils';

// ─── Authored file tree ─────────────────────────────────────────────────────

/** Visualizes authored names only. It deliberately has no path, repository,
 * manifest, snapshot, or network integration. */
export function FileTree({ children }: { children?: ReactNode }) {
  return (
    <ul
      className="my-5 list-none rounded-xl border border-border bg-muted/25 p-3 font-mono text-sm [&_ul]:ms-4 [&_ul]:list-none [&_ul]:border-border [&_ul]:border-s [&_ul]:ps-2"
      data-theme-component="file-tree"
    >
      {children}
    </ul>
  );
}

export function Folder({ name, defaultOpen, children }: { name?: string; defaultOpen?: string | boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(() => truthyAttr(defaultOpen));
  const folderId = useId();
  if (!name) {
    return (
      <li>
        <ul>{children}</ul>
      </li>
    );
  }
  const FolderIcon = open ? FolderOpen : FolderClosed;
  return (
    <li className="my-0.5">
      <button
        id={`${folderId}-trigger`}
        type="button"
        aria-controls={`${folderId}-contents`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform rtl:-scale-x-100', open && 'rotate-90')} aria-hidden />
        <FolderIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      <ul id={`${folderId}-contents`} aria-labelledby={`${folderId}-trigger`} hidden={!open}>
        {children}
      </ul>
    </li>
  );
}

export function File({ name, icon }: { name?: string; icon?: string }) {
  if (!name) {
    return null;
  }
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground">
      <span className="size-3.5 shrink-0" aria-hidden />
      {icon && hasIcon(icon) ? (
        <PageIcon name={icon} className="size-4 shrink-0" aria-hidden />
      ) : (
        <FileIcon className="size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 truncate">{name}</span>
    </li>
  );
}
