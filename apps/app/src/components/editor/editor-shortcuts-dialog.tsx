import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useState } from 'react';
import { scrollFadeStyle, useScrollEdges } from './scroll-edges';
import { modShortcut } from './shortcut-label';

interface Row {
  label: MessageKey;
  /** What follows Ctrl/⌘, or `plain` for a key pressed on its own. */
  keys: string;
  plain?: boolean;
}

/** The editor's shortcuts, as the editor binds them (TipTap's and ours). */
const GROUPS: Array<{ heading: MessageKey; rows: Row[] }> = [
  {
    heading: 'shortcuts.editor.text',
    rows: [
      { label: 'editor.format.bold', keys: 'B' },
      { label: 'editor.format.italic', keys: 'I' },
      { label: 'editor.format.underline', keys: 'U' },
      { label: 'editor.format.strikethrough', keys: 'Shift+S' },
      { label: 'editor.format.code', keys: 'E' },
      { label: 'editor.format.highlight', keys: 'Shift+H' },
      { label: 'editor.format.link', keys: 'K' },
      { label: 'shortcuts.editor.formattingMenu', keys: 'Alt+F10', plain: true },
    ],
  },
  {
    heading: 'shortcuts.editor.blocks',
    rows: [
      { label: 'editor.insertBlock', keys: '/', plain: true },
      { label: 'editor.slash.h1.title', keys: 'Alt+1' },
      { label: 'editor.slash.h2.title', keys: 'Alt+2' },
      { label: 'editor.slash.h3.title', keys: 'Alt+3' },
      { label: 'editor.slash.bulletList.title', keys: 'Shift+8' },
      { label: 'editor.slash.numberedList.title', keys: 'Shift+7' },
      { label: 'editor.slash.todo.title', keys: 'Shift+9' },
      { label: 'editor.slash.quote.title', keys: 'Shift+B' },
      { label: 'editor.slash.codeBlock.title', keys: 'Alt+C' },
      { label: 'shortcuts.editor.moveUp', keys: 'Shift+↑' },
      { label: 'shortcuts.editor.moveDown', keys: 'Shift+↓' },
    ],
  },
  {
    heading: 'shortcuts.editor.page',
    rows: [
      { label: 'shortcuts.editor.saveDraft', keys: 'S' },
      { label: 'editor.toolbar.undo', keys: 'Z' },
      { label: 'editor.toolbar.redo', keys: 'Shift+Z' },
      { label: 'shortcuts.editor.show', keys: '/' },
    ],
  },
];

/** "Keyboard shortcuts" for writing a page: Ctrl/⌘+/ or the page's … menu. */
export function EditorShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  // The list scrolls under the heading; a fade at its edge shows there is more.
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const edges = useScrollEdges(list, 'y');
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.editor.description')}</DialogDescription>
        </DialogHeader>
        <div
          className="-mx-6 min-h-0 space-y-6 overflow-y-auto px-6 pb-1"
          data-scroll-edges={[edges.start && 'start', edges.end && 'end'].filter(Boolean).join(' ') || undefined}
          ref={setList}
          style={scrollFadeStyle(edges, 'y')}
        >
          {GROUPS.map((group) => (
            <section aria-label={t(group.heading)} className="space-y-1.5" key={group.heading}>
              <h3 className="font-medium text-muted-foreground text-xs">{t(group.heading)}</h3>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {group.rows.map((row) => (
                  <div className="flex items-center justify-between gap-4 px-3 py-2 text-sm" key={`${row.label}-${row.keys}`}>
                    <dt className="min-w-0">{t(row.label)}</dt>
                    <dd className="shrink-0" dir="ltr">
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {row.plain ? row.keys : modShortcut(row.keys)}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
