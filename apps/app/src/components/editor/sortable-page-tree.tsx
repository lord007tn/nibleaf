import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ChevronRight, FileText, Folder, GripVertical, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import type { PageNode } from '@/hooks/api';

/**
 * A Notion-style page tree with @dnd-kit: drag the handle to reorder, drag
 * horizontally to nest/un-nest (the projected parent is previewed live), with a
 * floating drag overlay. Emits the full reorder set ({id, parentId, position})
 * which the editor sends to the reorderPages mutation. Children of a dragged
 * node move with it (they're hidden from the list while dragging and keep their
 * parentId on drop).
 */

const INDENT = 16;

/** Row actions stay out of the way on desktop until the row is hovered or
 *  focused, are always visible on touch screens (no hover there), and stay
 *  visible while their menu is open. */
const ROW_ACTION =
  'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[popup-open]:opacity-100';

export interface Flat {
  id: string;
  parentId: string | null;
  depth: number;
  node: PageNode;
}

export function flatten(pages: PageNode[]): Flat[] {
  const byParent = new Map<string, PageNode[]>();
  for (const page of pages) {
    const key = page.parentId ?? '__root';
    const list = byParent.get(key) ?? [];
    list.push(page);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position);
  }
  const out: Flat[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of byParent.get(parentId ?? '__root') ?? []) {
      out.push({ id: node.id, parentId, depth, node });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Hide the descendants of `id` from the list (so a subtree drags as a unit). */
function removeDescendants(items: Flat[], id: string): Flat[] {
  const excluded = new Set([id]);
  return items.filter((item) => {
    if (item.parentId && excluded.has(item.parentId)) {
      excluded.add(item.id);
      return false;
    }
    return true;
  });
}

/** Hide the descendants of any collapsed group (relies on tree order: a parent
 *  always precedes its children in the flattened list). */
function hideCollapsed(items: Flat[], collapsed: Set<string>): Flat[] {
  if (collapsed.size === 0) {
    return items;
  }
  const hidden = new Set<string>();
  return items.filter((item) => {
    if (item.parentId && (collapsed.has(item.parentId) || hidden.has(item.parentId))) {
      hidden.add(item.id);
      return false;
    }
    return true;
  });
}

const collapsedStoreKey = (treeKey: string) => `nibleaf.editor.collapsedGroups:${treeKey}`;

function readCollapsed(treeKey?: string): Set<string> {
  if (typeof window === 'undefined' || !treeKey) {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(collapsedStoreKey(treeKey));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

interface Projection {
  depth: number;
  parentId: string | null;
}

/** Horizontal drag distance in the tree's reading direction: dragging towards
 *  the inline end (right in LTR, left in RTL) nests a page deeper. */
export const inlineDragOffset = (deltaX: number, dir: 'ltr' | 'rtl') => (dir === 'rtl' ? -deltaX : deltaX);

export function getProjection(items: Flat[], activeId: string, overId: string, dragOffset: number, indent: number): Projection {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const newItems = arrayMove(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];
  const dragDepth = Math.round(dragOffset / indent);
  const projectedDepth = (activeItem?.depth ?? 0) + dragDepth;
  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const depth = projectedDepth > maxDepth ? maxDepth : projectedDepth < minDepth ? minDepth : projectedDepth;

  const parentId = (() => {
    if (depth === 0 || !previousItem) {
      return null;
    }
    if (depth === previousItem.depth) {
      return previousItem.parentId;
    }
    if (depth > previousItem.depth) {
      return previousItem.id;
    }
    return (
      newItems
        .slice(0, overIndex)
        .reverse()
        .find((item) => item.depth === depth)?.parentId ?? null
    );
  })();

  return { depth, parentId };
}

type RenameField = 'title' | 'sidebarTitle';
/** The name a tree row shows, and which page field holds it. */
export const rowName = (node: Pick<PageNode, 'title' | 'config'>): { label: string; field: RenameField } => {
  const sidebarTitle = node.config?.sidebarTitle?.trim();
  return sidebarTitle ? { label: sidebarTitle, field: 'sidebarTitle' } : { label: node.title, field: 'title' };
};

export function SortablePageTree({
  pages,
  activeId,
  onSelect,
  onAddChild,
  onSettings,
  onMove,
  onRename,
  onDelete,
  treeKey,
  dir = 'ltr',
}: {
  pages: PageNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onSettings: (id: string) => void;
  onMove: (items: Array<{ id: string; parentId: string | null; position: number }>) => void;
  /** `field` is the name the row shows: the sidebar title when the page has one, else its title. */
  onRename?: (id: string, title: string, field: RenameField) => void;
  onDelete?: (id: string) => void;
  /** Namespace for persisting which groups are collapsed (e.g. the language id). */
  treeKey?: string;
  /** Reading direction of this tree (its language), so drag-to-nest follows it. */
  dir?: 'ltr' | 'rtl';
}) {
  const t = useT();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Which GROUP rows are collapsed (their children hidden). Persisted per tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(treeKey));
  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCollapsed(next);
    if (treeKey) {
      try {
        window.localStorage.setItem(collapsedStoreKey(treeKey), JSON.stringify([...next]));
      } catch {
        // ignore storage failures (private mode etc.)
      }
    }
  };

  const flatFull = useMemo(() => flatten(pages), [pages]);
  // Ids of nodes that have at least one child (so only those get a collapse chevron).
  const parentIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of flatFull) {
      if (item.parentId) {
        set.add(item.parentId);
      }
    }
    return set;
  }, [flatFull]);
  // Hide collapsed groups' descendants, then (while dragging) the dragged subtree.
  const visible = useMemo(() => hideCollapsed(flatFull, collapsed), [flatFull, collapsed]);
  const flat = useMemo(() => (draggingId ? removeDescendants(visible, draggingId) : visible), [visible, draggingId]);
  const ids = flat.map((f) => f.id);

  const projection = draggingId && overId ? getProjection(flat, draggingId, overId, dragOffset, INDENT) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reset = () => {
    setDraggingId(null);
    setOverId(null);
    setDragOffset(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setDraggingId(String(active.id));
    setOverId(String(active.id));
  };
  const onDragMove = ({ delta }: DragMoveEvent) => setDragOffset(inlineDragOffset(delta.x, dir));
  const onDragOver = ({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    reset();
    if (!projection || !over) {
      return;
    }
    const clone = flatFull.map((f) => ({ id: f.id, parentId: f.parentId }));
    const activeIndex = clone.findIndex((f) => f.id === active.id);
    const overIndex = clone.findIndex((f) => f.id === over.id);
    if (activeIndex < 0 || overIndex < 0) {
      return;
    }
    clone[activeIndex] = { id: String(active.id), parentId: projection.parentId };
    const sorted = arrayMove(clone, activeIndex, overIndex);
    const posByParent = new Map<string, number>();
    const items = sorted.map((it) => {
      const key = it.parentId ?? '__root';
      const position = posByParent.get(key) ?? 0;
      posByParent.set(key, position + 1);
      return { id: it.id, parentId: it.parentId, position };
    });
    onMove(items);
  };

  const draggingNode = draggingId ? flatFull.find((f) => f.id === draggingId)?.node : null;
  // Screen readers hear page titles, never internal ids.
  const titleOf = (id: UniqueIdentifier) => {
    const node = flatFull.find((f) => f.id === String(id))?.node;
    return node ? rowName(node).label : '';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('editor.dnd.pickedUp', { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? t('editor.dnd.over', { title: titleOf(active.id), target: titleOf(over.id) })
        : t('editor.dnd.notOver', { title: titleOf(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t('editor.dnd.dropped', { title: titleOf(active.id), target: titleOf(over.id) })
        : t('editor.dnd.cancelled', { title: titleOf(active.id) }),
    onDragCancel: ({ active }) => t('editor.dnd.cancelled', { title: titleOf(active.id) }),
  };

  return (
    <DndContext
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('editor.dnd.instructions') } }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {flat.map((item) => (
          <SortableRow
            key={item.id}
            id={item.id}
            node={item.node}
            depth={item.id === draggingId && projection ? projection.depth : item.depth}
            active={activeId === item.id}
            hasChildren={parentIds.has(item.id)}
            collapsed={collapsed.has(item.id)}
            onToggleCollapse={toggleCollapse}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onSettings={onSettings}
            onDelete={onDelete}
            renaming={renamingId === item.id}
            onStartRename={onRename ? setRenamingId : undefined}
            onRename={(title) => {
              setRenamingId(null);
              if (title !== null) onRename?.(item.id, title, rowName(item.node).field);
            }}
          />
        ))}
      </SortableContext>
      <DragOverlay>{draggingNode ? <RowPresentation node={draggingNode} depth={0} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function SortableRow({
  id,
  node,
  depth,
  active,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onSelect,
  onAddChild,
  onSettings,
  onDelete,
  renaming,
  onStartRename,
  onRename,
}: {
  id: string;
  node: PageNode;
  depth: number;
  active: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onSettings: (id: string) => void;
  onDelete?: (id: string) => void;
  renaming: boolean;
  onStartRename?: (id: string) => void;
  onRename: (title: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: renaming });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-40')}>
      <RowPresentation
        node={node}
        depth={depth}
        active={active}
        hasChildren={hasChildren}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        onSelect={onSelect}
        onAddChild={onAddChild}
        onSettings={onSettings}
        onDelete={onDelete}
        renaming={renaming}
        onStartRename={onStartRename}
        onRename={onRename}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function RowPresentation({
  node,
  depth,
  active,
  overlay,
  hasChildren,
  collapsed,
  onToggleCollapse,
  onSelect,
  onAddChild,
  onSettings,
  onDelete,
  renaming,
  onStartRename,
  onRename,
  handleProps,
}: {
  node: PageNode;
  depth: number;
  active?: boolean;
  overlay?: boolean;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  onSelect?: (id: string) => void;
  onAddChild?: (parentId: string) => void;
  onSettings?: (id: string) => void;
  onDelete?: (id: string) => void;
  renaming?: boolean;
  onStartRename?: (id: string) => void;
  onRename?: (title: string | null) => void;
  handleProps?: Record<string, unknown>;
}) {
  const t = useT();
  const isGroup = node.kind === 'GROUP';
  // Renaming edits the name the row shows (the sidebar title when there is one).
  const { label, field: nameField } = rowName(node);
  const collapsible = isGroup && hasChildren && Boolean(onToggleCollapse);
  return (
    <div
      className={cn(
        'group/row flex items-center gap-1 rounded-md pe-1',
        overlay && 'bg-card shadow-lg ring-1 ring-border',
        !overlay && active && 'bg-primary/10 font-medium text-primary',
        !overlay && !active && 'text-foreground/80 hover:bg-muted hover:text-foreground',
      )}
      style={{ marginInlineStart: depth * INDENT }}
    >
      <button
        type="button"
        aria-label={t('editor.dragToReorder')}
        className={cn(
          'flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing pointer-coarse:size-7',
          ROW_ACTION,
        )}
        {...handleProps}
      >
        <GripVertical className="size-3.5" />
      </button>
      {/* Collapse chevron for groups with children; a spacer otherwise so every
          row's icon stays aligned. */}
      {collapsible ? (
        <button
          type="button"
          aria-label={collapsed ? t('editor.expand') : t('editor.collapse')}
          aria-expanded={!collapsed}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse?.(node.id);
          }}
        >
          {/* expanded → points down (both dirs); collapsed → points to the reading
              start (right in LTR, left in RTL). */}
          <ChevronRight className={cn('size-3.5 transition-transform', collapsed ? 'rtl:rotate-180' : 'rotate-90')} />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      {renaming ? (
        <RenameInput
          initialValue={label}
          label={nameField === 'sidebarTitle' ? t('editor.pageSettings.sidebarTitle') : t('editor.rename')}
          onDone={(title) => onRename?.(title)}
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect?.(node.id)}
          onDoubleClick={onStartRename ? () => onStartRename(node.id) : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-sm pointer-coarse:py-2.5',
            isGroup && 'font-semibold text-[11px] uppercase tracking-wide',
          )}
        >
          {isGroup ? (
            <Folder className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          ) : hasIcon(node.icon) ? (
            <PageIcon name={node.icon} className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          ) : (
            <FileText className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          )}
          <span className="truncate">{label}</span>
        </button>
      )}
      {!overlay && !renaming && onSettings ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className={cn('shrink-0 cursor-pointer', ROW_ACTION)}
                title={t('editor.pageActions', { title: label })}
                aria-label={t('editor.pageActions', { title: label })}
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {onStartRename ? (
              <DropdownMenuItem onClick={() => onStartRename(node.id)}>
                <Pencil /> {t('editor.rename')}
              </DropdownMenuItem>
            ) : null}
            {isGroup && onAddChild ? (
              <DropdownMenuItem onClick={() => onAddChild(node.id)}>
                <Plus /> {t('editor.addPageInside')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => onSettings(node.id)}>
              <Settings2 /> {isGroup ? t('editor.groupSettings') : t('editor.pageSettings.title')}
            </DropdownMenuItem>
            {onDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(node.id)}>
                  <Trash2 /> {isGroup ? t('editor.deleteGroup') : t('editor.deletePage')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {isGroup && onAddChild && !renaming ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className={cn('shrink-0 cursor-pointer pointer-coarse:hidden', ROW_ACTION)}
          onClick={() => onAddChild(node.id)}
          title={t('editor.addPageInside')}
          aria-label={t('editor.addPageInside')}
        >
          <Plus className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

/** Inline title editor for a tree row: Enter or leaving the field saves,
 *  Escape cancels. */
function RenameInput({ initialValue, label, onDone }: { initialValue: string; label: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initialValue);
  const [done, setDone] = useState(false);
  const finish = (save: boolean) => {
    if (done) return;
    setDone(true);
    const title = value.trim();
    onDone(save && title && title !== initialValue ? title : null);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-10"
      dir="auto"
      maxLength={200}
      onBlur={() => finish(true)}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      value={value}
    />
  );
}
