import { useParams } from '@tanstack/react-router';
import type { Editor } from '@tiptap/core';
import { useLanguages, usePages } from '@/hooks/api';
import { useActiveBranchId } from '../active-branch-context';

/** Pages of the edited language and version whose title matches `query`. */
export function useLinkablePages(editor: Editor, query: string, limit = 6) {
  const params = useParams({ strict: false });
  const projectId = 'projectId' in params ? params.projectId : undefined;
  const languages = useLanguages(projectId);
  const lang = editor.view.dom.closest<HTMLElement>('[lang]')?.lang;
  const language = languages.data?.find((item) => item.code === lang);
  // Search the version being edited, not the default one: a link resolves within
  // the version the page is published in.
  const branchId = useActiveBranchId();
  const pages = usePages(projectId, language?.id, branchId);
  const needle = query.toLocaleLowerCase();
  return (pages.data ?? []).filter((page) => page.kind === 'PAGE' && page.title.toLocaleLowerCase().includes(needle)).slice(0, limit);
}

/** Loaded when the link panel opens; the basic formatting tools need no API client.
 *  `onSelect` receives the page path instead of setting a link mark (component settings use it). */
export default function PageLinkPicker({
  editor,
  query,
  onDone,
  onSelect,
}: {
  editor: Editor;
  query: string;
  onDone: () => void;
  onSelect?: (href: string) => void;
}) {
  const matches = useLinkablePages(editor, query);
  return (
    <div className="w-full">
      {matches.map((page) => (
        <button
          key={page.id}
          type="button"
          className="block w-full rounded p-2 text-start text-sm hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (onSelect) onSelect(`/${page.path}`);
            else
              editor
                .chain()
                .focus()
                .extendMarkRange('link')
                .setLink({ href: `/${page.path}` })
                .run();
            onDone();
          }}
        >
          {page.title}
        </button>
      ))}
    </div>
  );
}
