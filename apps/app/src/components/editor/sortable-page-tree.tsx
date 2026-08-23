import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ChevronRight, FileText, Folder, GripVertical, Plus, Settings2 } from 'lucide-react';
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

interface Flat {
  id: string;
  parentId: string | null;
  depth: number;
  node: PageNode;
}

function flatten(pages: PageNode[]): Flat[] {
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

function getProjection(items: Flat[], activeId: string, overId: string, dragOffset: number, indent: number): Projection {
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

export function SortablePageTree({
  pages,
  activeId,
  onSelect,
  onAddChild,
  onSettings,
  onMove,
  treeKey,
}: {
  pages: PageNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onSettings: (id: string) => void;
  onMove: (items: Array<{ id: string; parentId: string | null; position: number }>) => void;
  /** Namespace for persisting which groups are collapsed (e.g. the language id). */
  treeKey?: string;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);

  // Which GROUP rows are collapsed (their children hidden). Persisted per tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(treeKey));
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (typeof window !== 'undefined' && treeKey) {
        try {
          window.localStorage.setItem(collapsedStoreKey(treeKey), JSON.stringify([...next]));
        } catch {
          // ignore storage failures (private mode etc.)
        }
      }
      return next;
    });

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

  const projection = draggingId && overId ? getProjection(flat, draggingId, overId, offsetLeft, INDENT) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reset = () => {
    setDraggingId(null);
    setOverId(null);
    setOffsetLeft(0);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setDraggingId(String(active.id));
    setOverId(String(active.id));
  };
  const onDragMove = ({ delta }: DragMoveEvent) => setOffsetLeft(delta.x);
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

  return (
    <DndContext
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
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
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
  handleProps?: Record<string, unknown>;
}) {
  const t = useT();
  const isGroup = node.kind === 'GROUP';
  const label = node.config?.sidebarTitle?.trim() || node.title;
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
        className="flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover/row:opacity-100 active:cursor-grabbing"
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
      <button
        type="button"
        onClick={() => onSelect?.(node.id)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 py-1.5 text-start text-sm',
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
      {!overlay && onSettings ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 cursor-pointer opacity-0 group-hover/row:opacity-100"
          onClick={() => onSettings(node.id)}
          title={t('editor.pageSettings.title')}
          aria-label={t('editor.pageSettings.title')}
        >
          <Settings2 className="size-3" />
        </Button>
      ) : null}
      {isGroup && onAddChild ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 cursor-pointer opacity-0 group-hover/row:opacity-100"
          onClick={() => onAddChild(node.id)}
          title={t('editor.newPage')}
          aria-label={t('editor.newPage')}
        >
          <Plus className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
