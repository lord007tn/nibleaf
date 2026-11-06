import { useParams } from '@tanstack/react-router';
import type { Editor } from '@tiptap/core';
import { useLanguages, usePages } from '@/hooks/api';
import { useActiveBranchId } from '../active-branch-context';

/** Loaded when the link panel opens; the basic formatting tools need no API client. */
export default function PageLinkPicker({ editor, query, onDone }: { editor: Editor; query: string; onDone: () => void }) {
  const params = useParams({ strict: false });
  const projectId = 'projectId' in params ? params.projectId : undefined;
  const languages = useLanguages(projectId);
  const lang = editor.view.dom.closest<HTMLElement>('[lang]')?.lang;
  const language = languages.data?.find((item) => item.code === lang);
  // Search the version being edited, not the default one: a link resolves within
  // the version the page is published in.
  const branchId = useActiveBranchId();
  const pages = usePages(projectId, language?.id, branchId);
  const matches = (pages.data ?? [])
    .filter((page) => page.kind === 'PAGE' && page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 6);
  return (
    <div className="w-full">
      {matches.map((page) => (
        <button
          key={page.id}
          type="button"
          className="block w-full rounded p-2 text-start text-sm hover:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
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
