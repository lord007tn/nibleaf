import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, PanelTop, Rows3, Trash2, X } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

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
export function TableBubbleMenu({ editor }: { editor: Editor }) {
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
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {actions.map((action) => {
        const label = t(action.labelKey);
        return (
          <span key={action.labelKey} className="flex items-center gap-0.5">
            {action.separatorBefore ? <span className="mx-0.5 h-5 w-px bg-border" /> : null}
            <button
              type="button"
              title={label}
              aria-label={label}
              disabled={!action.enabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.run}
              className={cn(
                'flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground/80 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
                action.destructive && 'hover:bg-destructive/10 hover:text-destructive',
              )}
            >
              {action.content}
            </button>
          </span>
        );
      })}
    </BubbleMenu>
  );
}

export default TableBubbleMenu;
