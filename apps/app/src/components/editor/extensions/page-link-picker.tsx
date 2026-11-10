import { cn } from '@nibleaf/design-system/lib/utils';
import { useParams } from '@tanstack/react-router';
import type { Editor } from '@tiptap/core';
import { useEffect, useMemo } from 'react';
import { useLanguages, usePages } from '@/hooks/api';
import { useActiveBranchId } from '../active-branch-context';
import { matchPages, type PageLinkMatch } from '../link-utils';

/**
 * The page suggestions under the link field: the listbox of its combobox. The
 * field owns the keyboard (Arrow keys move `activeIndex`, Enter picks); this
 * list only reports what matches and renders it.
 * Loaded when the link panel opens; the basic formatting tools need no API client.
 */
export default function PageLinkPicker({
  editor,
  query,
  listboxId,
  optionId,
  activeIndex,
  onMatches,
  onPick,
}: {
  editor: Editor;
  query: string;
  listboxId: string;
  optionId: (index: number) => string;
  activeIndex: number;
  onMatches: (matches: PageLinkMatch[]) => void;
  onPick: (match: PageLinkMatch) => void;
}) {
  const params = useParams({ strict: false });
  const projectId = 'projectId' in params ? params.projectId : undefined;
  const languages = useLanguages(projectId);
  const lang = editor.view.dom.closest<HTMLElement>('[lang]')?.lang;
  const language = languages.data?.find((item) => item.code === lang);
  // Search the version being edited, not the default one: a link resolves within
  // the version the page is published in.
  const branchId = useActiveBranchId();
  const pages = usePages(projectId, language?.id, branchId);
  const matches = useMemo(
    () => matchPages(pages.data ?? [], query).map((page) => ({ id: page.id, title: page.title, path: page.path })),
    [pages.data, query],
  );
  const matchKey = matches.map((match) => match.id).join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the matched pages change.
  useEffect(() => onMatches(matches), [matchKey]);
  useEffect(() => () => onMatches([]), [onMatches]);
  if (matches.length === 0) return null;
  return (
    <div id={listboxId} role="listbox" className="w-full">
      {matches.map((page, index) => (
        <div
          key={page.id}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          className={cn('block w-full cursor-pointer rounded p-2 text-start text-sm hover:bg-muted', index === activeIndex && 'bg-muted')}
          // Keep focus in the link field (and the selection in the editor).
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(page)}
        >
          <span dir="auto">{page.title}</span>
        </div>
      ))}
    </div>
  );
}
