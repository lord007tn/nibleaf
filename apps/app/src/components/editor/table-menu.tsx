import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, PanelTop, Rows3, Trash2, X } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { alignTableColumns, type ColumnAlignment } from './extensions/aligned-table';

function AlignmentGlyph({ align }: { align: ColumnAlignment }) {
  const start = align === 'left' ? 3 : align === 'right' ? 9 : 6;
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={`M3 6h18M${start} 12h12M3 18h18`} />
    </svg>
  );
}

/** A Rows3/Columns3 glyph with a small × badge — reads as "delete row/column". */
function DeleteGlyph({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) {
  return (
    <span className="relative inline-flex">
      <Icon className="size-4" />
      <X className="-end-1.5 -top-1 absolute size-2.5" strokeWidth={3} />
    </span>
  );
}

interface TableAction {
  labelKey: MessageKey;
  content: ReactNode;
  run: () => void;
  enabled: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/**
 * Floating table controls, shown while the caret (or a cell selection) is inside
 * a table: insert/delete rows and columns, toggle the header row, delete the
 * table. Positioned BELOW the selection so it never fights the text formatting
 * bubble (which floats above and only appears for non-empty text selections).
 */
export function TableBubbleMenu({ editor, dir = 'ltr' }: { editor: Editor; dir?: 'ltr' | 'rtl' }) {
  const t = useT();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      inTable: current.isActive('table'),
      canAddRowBefore: current.can().addRowBefore(),
      canAddRowAfter: current.can().addRowAfter(),
      canAddColBefore: current.can().addColumnBefore(),
      canAddColAfter: current.can().addColumnAfter(),
      canDeleteRow: current.can().deleteRow(),
      canDeleteCol: current.can().deleteColumn(),
      canToggleHeader: current.can().toggleHeaderRow(),
      canDeleteTable: current.can().deleteTable(),
    }),
  });

  const actions: TableAction[] = [
    {
      labelKey: 'editor.table.alignStart',
      content: <AlignmentGlyph align={dir === 'rtl' ? 'right' : 'left'} />,
      run: () => {
        alignTableColumns(editor, dir === 'rtl' ? 'right' : 'left');
      },
      enabled: state.inTable,
    },
    {
      labelKey: 'editor.table.alignCenter',
      content: <AlignmentGlyph align="center" />,
      run: () => {
        alignTableColumns(editor, 'center');
      },
      enabled: state.inTable,
    },
    {
      labelKey: 'editor.table.alignEnd',
      content: <AlignmentGlyph align={dir === 'rtl' ? 'left' : 'right'} />,
      run: () => {
        alignTableColumns(editor, dir === 'rtl' ? 'left' : 'right');
      },
      enabled: state.inTable,
    },
    {
      labelKey: 'editor.table.addRowAbove',
      content: <ArrowUpToLine className="size-4" />,
      run: () => editor.chain().focus().addRowBefore().run(),
      enabled: state.canAddRowBefore,
    },
    {
      labelKey: 'editor.table.addRowBelow',
      content: <ArrowDownToLine className="size-4" />,
      run: () => editor.chain().focus().addRowAfter().run(),
      enabled: state.canAddRowAfter,
    },
    {
      labelKey: 'editor.table.deleteRow',
      content: <DeleteGlyph icon={Rows3} />,
      run: () => editor.chain().focus().deleteRow().run(),
      enabled: state.canDeleteRow,
    },
    {
      labelKey: 'editor.table.addColBefore',
      content: <ArrowLeftToLine className="size-4 rtl:-scale-x-100" />,
      run: () => editor.chain().focus().addColumnBefore().run(),
      enabled: state.canAddColBefore,
      separatorBefore: true,
    },
    {
      labelKey: 'editor.table.addColAfter',
      content: <ArrowRightToLine className="size-4 rtl:-scale-x-100" />,
      run: () => editor.chain().focus().addColumnAfter().run(),
      enabled: state.canAddColAfter,
    },
    {
      labelKey: 'editor.table.deleteCol',
      content: <DeleteGlyph icon={Columns3} />,
      run: () => editor.chain().focus().deleteColumn().run(),
      enabled: state.canDeleteCol,
    },
    {
      labelKey: 'editor.table.toggleHeader',
      content: <PanelTop className="size-4" />,
      run: () => editor.chain().focus().toggleHeaderRow().run(),
      enabled: state.canToggleHeader,
      separatorBefore: true,
    },
    {
      labelKey: 'editor.table.delete',
      content: <Trash2 className="size-4" />,
      run: () => editor.chain().focus().deleteTable().run(),
      enabled: state.canDeleteTable,
      destructive: true,
      separatorBefore: true,
    },
  ];

  return (
    <BubbleMenu
      data-editor-bubble-menu=""
      editor={editor}
      pluginKey="nibleaf-table-menu"
      options={{ placement: 'bottom' }}
      // Only while inside a table, and only when the text bubble is NOT showing:
      // caret (empty selection) or a cell selection. A non-empty text selection
      // inside a cell keeps the formatting bubble usable on its own.
      shouldShow={({ editor: current }) => {
        if (!current.isEditable || !current.isActive('table')) {
          return false;
        }
        const { selection } = current.state;
        return selection.empty || selection instanceof CellSelection;
      }}
      className="flex max-w-[calc(100vw-2rem)] items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-lg"
      dir={dir}
    >
      {actions.map((action) => {
        const label = t(action.labelKey);
        return (
          <span key={action.labelKey} className="flex shrink-0 items-center gap-0.5">
            {action.separatorBefore ? <span className="mx-0.5 h-5 w-px bg-border" /> : null}
            <Button
              aria-label={label}
              className={cn('size-11 text-foreground/80', action.destructive && 'hover:bg-destructive/10 hover:text-destructive')}
              disabled={!action.enabled}
              onClick={action.run}
              onMouseDown={(event) => event.preventDefault()}
              size="icon-xs"
              title={label}
              type="button"
              variant="ghost"
            >
              {action.content}
            </Button>
          </span>
        );
      })}
    </BubbleMenu>
  );
}
