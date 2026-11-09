import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
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
import { ChevronRight, CornerDownRight, FileText, Folder, GripVertical, MoreHorizontal, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import type { PageNode } from '@/hooks/api';

/**
 * A Notion-style page tree for every language of a site with @dnd-kit: drag the
 * handle to reorder, drag sideways to nest/un-nest (the projected parent is
 * previewed live), and drag into another language's section to move a page,
 * with everything inside it, to that language. One DndContext spans every
 * language section (`PageTreeDndProvider`); each section renders its rows with
 * `SortablePageTree` and its header with `LanguageDropTarget`.
 *
 * Row chrome (handle, indent, chevron, menu, drop hints) follows the dashboard's
 * direction, never the content language: only the title text is `dir="auto"`.
 */

const INDENT = 16;
/** Inline offset of a guide line inside a row's indent: under the chevron of the
 *  ancestor at that level (handle 20px + gap 4px + gap 4px + half a 16px chevron,
 *  minus the 24px the indent itself starts at). */
const GUIDE_OFFSET = 11.5;

/** Row actions stay out of the way on desktop until the row is hovered or
 *  focused, are always visible on touch screens (no hover there), and stay
 *  visible while their menu is open. */
/** Drop-target edges are inline styles, not new utility classes: the dashboard
 *  and the published docs share one stylesheet, which readers download. */
const DROP_EDGE = 'color-mix(in oklab, var(--color-primary) 50%, transparent)';
const DROP_RING = { boxShadow: `inset 0 0 0 1px ${DROP_EDGE}` } as const;
const DROP_SLOT = { outline: `1px dashed ${DROP_EDGE}`, outlineOffset: -1 } as const;

const ROW_ACTION =
  'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[popup-open]:opacity-100';

export interface Flat {
  id: string;
  parentId: string | null;
  depth: number;
  languageId: string;
  node: PageNode;
}

/** A language section's header in the shared sortable list: a drop target that
 *  places a page at the top level of that language. */
export interface LanguageMarker {
  id: string;
  languageId: string;
  marker: true;
}

export type TreeItem = Flat | LanguageMarker;

const MARKER_PREFIX = 'language:';
export const languageMarkerId = (languageId: string) => `${MARKER_PREFIX}${languageId}`;
const isMarker = (item: TreeItem | undefined): item is LanguageMarker => Boolean(item && 'marker' in item);

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
      out.push({ id: node.id, parentId, depth, languageId: node.languageId, node });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Hide the descendants of `id` from the list (so a subtree drags as a unit). */
function removeDescendants<T extends TreeItem>(items: T[], id: string): T[] {
  const excluded = new Set([id]);
  return items.filter((item) => {
    if (!isMarker(item) && item.parentId && excluded.has(item.parentId)) {
      excluded.add(item.id);
      return false;
    }
    return true;
  });
}

/** Hide the descendants of any collapsed row (relies on tree order: a parent
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

function readCollapsed(treeKey: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(collapsedStoreKey(treeKey));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export interface Projection {
  depth: number;
  parentId: string | null;
  languageId: string;
}

/** Horizontal drag distance in the dashboard's reading direction: dragging
 *  towards the inline end (right in LTR, left in RTL) nests a page deeper. */
export const inlineDragOffset = (deltaX: number, dir: 'ltr' | 'rtl') => (dir === 'rtl' ? -deltaX : deltaX);

/** Where the dragged page would land: its depth, its parent, and its language
 *  (the section it sits in once moved over `overId`). `items` is the shared list
 *  of every visible language section, each starting with its marker. */
export function getProjection(items: TreeItem[], activeId: string, overId: string, dragOffset: number, indent: number): Projection {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  const activeItem = items[activeIndex];
  const activeDepth = activeItem && !isMarker(activeItem) ? activeItem.depth : 0;
  const newItems = arrayMove(items, activeIndex, overIndex);
  // The section is the one of the nearest row or header above the drop spot;
  // above the very first header it can only be the first language.
  const above = newItems[overIndex - 1];
  const languageId = above?.languageId ?? newItems[overIndex + 1]?.languageId ?? activeItem?.languageId ?? '';
  const previousItem = above && !isMarker(above) ? above : undefined;
  const below = newItems[overIndex + 1];
  const nextItem = below && !isMarker(below) && below.languageId === languageId ? below : undefined;
  const dragDepth = Math.round(dragOffset / indent);
  const projectedDepth = activeDepth + dragDepth;
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
    const ancestor = newItems
      .slice(0, overIndex)
      .reverse()
      .find((item): item is Flat => !isMarker(item) && item.languageId === languageId && item.depth === depth);
    return ancestor?.parentId ?? null;
  })();

  return { depth, parentId, languageId };
}

export type PageMoveItem = { id: string; parentId: string | null; position: number; languageId: string };

/** The reorder set for a drop: every page of the languages the move touches,
 *  with its parent, position among its siblings and (final) language. The
 *  dragged page's subtree follows it into the target language. `full` is every
 *  page of every language in tree order, each language led by its marker. */
export function buildMove(full: TreeItem[], activeId: string, overId: string, projection: Projection): PageMoveItem[] {
  const activeIndex = full.findIndex((item) => item.id === activeId);
  const overIndex = full.findIndex((item) => item.id === overId);
  const active = full[activeIndex];
  if (activeIndex < 0 || overIndex < 0 || !active || isMarker(active)) {
    return [];
  }
  const sourceLanguageId = active.languageId;
  const rows = full.map((item) =>
    isMarker(item)
      ? { id: item.id, marker: true, parentId: null as string | null, languageId: item.languageId }
      : { id: item.id, marker: false, parentId: item.parentId, languageId: item.languageId },
  );
  rows[activeIndex] = { ...rows[activeIndex], parentId: projection.parentId, languageId: projection.languageId } as (typeof rows)[number];
  const sorted = arrayMove(rows, activeIndex, overIndex);
  // The subtree travels with its root.
  const subtree = new Set([activeId]);
  for (const row of sorted) {
    if (!row.marker && row.parentId && subtree.has(row.parentId)) {
      subtree.add(row.id);
      row.languageId = projection.languageId;
    }
  }
  const touched = new Set([sourceLanguageId, projection.languageId]);
  const posByParent = new Map<string, number>();
  const out: PageMoveItem[] = [];
  for (const row of sorted) {
    if (row.marker || !touched.has(row.languageId)) continue;
    const key = `${row.languageId}|${row.parentId ?? ''}`;
    const position = posByParent.get(key) ?? 0;
    posByParent.set(key, position + 1);
    out.push({ id: row.id, parentId: row.parentId, position, languageId: row.languageId });
  }
  return out;
}

type RenameField = 'title' | 'sidebarTitle';
/** The name a tree row shows, and which page field holds it. */
export const rowName = (node: Pick<PageNode, 'title' | 'config'>): { label: string; field: RenameField } => {
  const sidebarTitle = node.config?.sidebarTitle?.trim();
  return sidebarTitle ? { label: sidebarTitle, field: 'sidebarTitle' } : { label: node.title, field: 'title' };
};

/** Arrow up/down move between rows (and language headers); arrow left/right
 *  nest or un-nest by one level, in the dashboard's direction. */
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    const step = event.code === 'ArrowRight' ? INDENT : -INDENT;
    return { ...args.currentCoordinates, x: args.currentCoordinates.x + step };
  }
  return sortableKeyboardCoordinates(event, args);
};

export interface TreeLanguage {
  id: string;
  label: string;
  /** The section is folded: its rows are not rendered, but its header still takes drops. */
  collapsed: boolean;
}

interface TreeDndState {
  readOnly: boolean;
  draggingId: string | null;
  projection: Projection | null;
  rowsFor: (languageId: string) => Flat[];
  depthOf: (item: Flat) => number;
  parentIds: Set<string>;
  collapsed: Set<string>;
  toggleCollapse: (id: string) => void;
  dropHint: string | null;
  sourceLanguageId: string | null;
}

const TreeDndContext = createContext<TreeDndState | null>(null);

const useTreeDnd = () => {
  const value = useContext(TreeDndContext);
  if (!value) throw new Error('SortablePageTree must be rendered inside PageTreeDndProvider.');
  return value;
};

export function PageTreeDndProvider({
  pages,
  languages,
  dir,
  readOnly = false,
  onMove,
  children,
}: {
  /** Every page of every language on the active branch. */
  pages: PageNode[];
  /** Language sections in display order. */
  languages: TreeLanguage[];
  /** The dashboard's direction (not the content language), so drag-to-nest follows the UI. */
  dir: 'ltr' | 'rtl';
  /** Viewers browse the tree: no dragging, renaming, adding or deleting. */
  readOnly?: boolean;
  onMove: (items: PageMoveItem[]) => void;
  children: ReactNode;
}) {
  const t = useT();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Which rows are collapsed (their children hidden), persisted per language.
  const languageKey = languages.map((language) => language.id).join(',');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(languages.flatMap((language) => readCollapsed(language.id))));
  const [loadedLanguages, setLoadedLanguages] = useState(languageKey);
  useEffect(() => {
    if (languageKey === loadedLanguages) return;
    setLoadedLanguages(languageKey);
    setCollapsed((current) => new Set([...current, ...languageKey.split(',').flatMap((id) => (id ? readCollapsed(id) : []))]));
  }, [languageKey, loadedLanguages]);

  const flatByLanguage = useMemo(() => {
    const byLanguage = new Map<string, PageNode[]>();
    for (const page of pages) {
      byLanguage.set(page.languageId, [...(byLanguage.get(page.languageId) ?? []), page]);
    }
    return new Map(languages.map((language) => [language.id, flatten(byLanguage.get(language.id) ?? [])]));
  }, [pages, languages]);

  const toggleCollapse = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setCollapsed(next);
    const languageId = pages.find((page) => page.id === id)?.languageId;
    if (!languageId) return;
    try {
      const ids = (flatByLanguage.get(languageId) ?? []).map((item) => item.id).filter((itemId) => next.has(itemId));
      window.localStorage.setItem(collapsedStoreKey(languageId), JSON.stringify(ids));
    } catch {
      // ignore storage failures (private mode etc.)
    }
  };

  // Every page in display order, each language led by its marker.
  const full = useMemo<TreeItem[]>(
    () =>
      languages.flatMap((language) => [
        { id: languageMarkerId(language.id), languageId: language.id, marker: true as const },
        ...(flatByLanguage.get(language.id) ?? []),
      ]),
    [languages, flatByLanguage],
  );
  // What is on screen: folded sections and collapsed rows hide their pages,
  // and the dragged subtree travels hidden under its root.
  const visible = useMemo<TreeItem[]>(() => {
    const shown = languages.flatMap((language) => [
      { id: languageMarkerId(language.id), languageId: language.id, marker: true as const } satisfies LanguageMarker,
      ...(language.collapsed ? [] : hideCollapsed(flatByLanguage.get(language.id) ?? [], collapsed)),
    ]);
    return draggingId ? removeDescendants(shown, draggingId) : shown;
  }, [languages, flatByLanguage, collapsed, draggingId]);

  const parentIds = useMemo(() => new Set(pages.flatMap((page) => (page.parentId ? [page.parentId] : []))), [pages]);
  const projection = draggingId && overId ? getProjection(visible, draggingId, overId, dragOffset, INDENT) : null;
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const sourceLanguageId = draggingId ? (pageById.get(draggingId)?.languageId ?? null) : null;
  const languageLabel = (id: string) => languages.find((language) => language.id === id)?.label ?? '';

  const dropHint = (() => {
    if (!projection) return null;
    const parent = projection.parentId ? pageById.get(projection.parentId) : undefined;
    if (parent) return t('editor.dnd.inside', { title: rowName(parent).label });
    return projection.languageId === sourceLanguageId
      ? t('editor.dnd.topLevel')
      : t('editor.dnd.topLevelIn', { language: languageLabel(projection.languageId) });
  })();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
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
    const finalProjection = projection;
    reset();
    if (!finalProjection || !over) {
      return;
    }
    const before = pageById.get(String(active.id));
    const items = buildMove(full, String(active.id), String(over.id), finalProjection);
    const changed = items.some((item) => {
      const page = pageById.get(item.id);
      return !page || page.parentId !== item.parentId || page.position !== item.position || page.languageId !== item.languageId;
    });
    if (before && items.length > 0 && changed) {
      onMove(items);
    }
  };

  // Screen readers hear page titles and language names, never internal ids.
  const titleOf = (id: UniqueIdentifier) => {
    const key = String(id);
    if (key.startsWith(MARKER_PREFIX)) return languageLabel(key.slice(MARKER_PREFIX.length));
    const node = pageById.get(key);
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

  const visibleRows = useMemo(() => {
    const byLanguage = new Map<string, Flat[]>();
    for (const item of visible) {
      if (isMarker(item)) continue;
      byLanguage.set(item.languageId, [...(byLanguage.get(item.languageId) ?? []), item]);
    }
    return byLanguage;
  }, [visible]);

  const state: TreeDndState = {
    readOnly,
    draggingId,
    projection,
    rowsFor: (languageId) => visibleRows.get(languageId) ?? [],
    depthOf: (item) => (item.id === draggingId && projection ? projection.depth : item.depth),
    parentIds,
    collapsed,
    toggleCollapse,
    dropHint,
    sourceLanguageId,
  };

  const draggingNode = draggingId ? pageById.get(draggingId) : null;
  return (
    <TreeDndContext value={state}>
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
        <SortableContext items={visible.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        <DragOverlay>{draggingNode ? <RowPresentation node={draggingNode} depth={0} overlay hint={dropHint ?? undefined} /> : null}</DragOverlay>
      </DndContext>
    </TreeDndContext>
  );
}

/** A language section's header (and its empty state): moves with the list while
 *  dragging and takes a drop as "top of this language". Highlighted when the
 *  dragged page would land in this language from another one. */
export function LanguageDropTarget({ languageId, className, children }: { languageId: string; className?: string; children: ReactNode }) {
  const { readOnly, projection, sourceLanguageId } = useTreeDnd();
  const { setNodeRef, transform, transition } = useSortable({
    id: languageMarkerId(languageId),
    disabled: { draggable: true, droppable: readOnly },
  });
  const target = Boolean(projection && sourceLanguageId && projection.languageId === languageId && projection.languageId !== sourceLanguageId);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, ...(target ? DROP_RING : {}) }}
      className={cn('rounded-md', target && 'bg-primary/5', className)}
      data-drop-target={target ? 'language' : undefined}
    >
      {children}
    </div>
  );
}

export function SortablePageTree({
  languageId,
  activeId,
  onSelect,
  onAddChild,
  onSettings,
  onRename,
  onDelete,
}: {
  languageId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onSettings: (id: string) => void;
  /** `field` is the name the row shows: the sidebar title when the page has one, else its title. */
  onRename?: (id: string, title: string, field: RenameField) => void;
  onDelete?: (id: string) => void;
}) {
  const { readOnly, rowsFor, depthOf, parentIds, collapsed, toggleCollapse, projection, draggingId, dropHint } = useTreeDnd();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const rows = rowsFor(languageId);
  return (
    <div>
      {rows.map((item) => (
        <SortableRow
          key={item.id}
          id={item.id}
          node={item.node}
          depth={depthOf(item)}
          active={activeId === item.id}
          dropParent={Boolean(projection?.parentId && projection.parentId === item.id)}
          dropHint={item.id === draggingId ? dropHint : null}
          hasChildren={parentIds.has(item.id)}
          collapsed={collapsed.has(item.id)}
          onToggleCollapse={toggleCollapse}
          onSelect={onSelect}
          onAddChild={readOnly ? undefined : onAddChild}
          onSettings={readOnly ? undefined : onSettings}
          onDelete={readOnly ? undefined : onDelete}
          readOnly={readOnly}
          renaming={renamingId === item.id}
          onStartRename={onRename && !readOnly ? setRenamingId : undefined}
          onRename={(title) => {
            setRenamingId(null);
            if (title !== null) onRename?.(item.id, title, rowName(item.node).field);
          }}
        />
      ))}
    </div>
  );
}

function SortableRow({
  id,
  readOnly,
  renaming,
  dropHint,
  ...row
}: Omit<RowProps, 'handleProps' | 'overlay' | 'placeholder'> & { id: string; readOnly: boolean; dropHint: string | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: renaming || readOnly });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}>
      <RowPresentation
        {...row}
        renaming={renaming}
        placeholder={isDragging ? (dropHint ?? '') : undefined}
        handleProps={readOnly ? undefined : { ...attributes, ...listeners }}
      />
    </div>
  );
}

interface RowProps {
  node: PageNode;
  depth: number;
  active?: boolean;
  overlay?: boolean;
  /** This row is where the dragged page lands while dragging: the text says where. */
  placeholder?: string;
  /** Where the page being dragged would land, shown on the floating row. */
  hint?: string;
  /** The dragged page would drop inside this row. */
  dropParent?: boolean;
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
}

function RowPresentation({
  node,
  depth,
  active,
  overlay,
  placeholder,
  hint,
  dropParent,
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
}: RowProps) {
  const t = useT();
  const isGroup = node.kind === 'GROUP';
  // Renaming edits the name the row shows (the sidebar title when there is one).
  const { label, field: nameField } = rowName(node);
  const collapsible = Boolean(hasChildren && onToggleCollapse);
  const dragging = placeholder !== undefined;
  const iconClass = cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground');
  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-1 rounded-md pe-1',
        overlay && 'bg-card shadow-lg ring-1 ring-border',
        dragging && 'bg-primary/5 text-foreground',
        dropParent && 'bg-primary/10 text-foreground',
        !overlay && !dragging && !dropParent && active && 'bg-primary/10 font-medium text-primary',
        !overlay && !dragging && !dropParent && !active && 'text-foreground/80 hover:bg-muted hover:text-foreground',
      )}
      style={dragging ? DROP_SLOT : dropParent ? DROP_RING : undefined}
      data-depth={depth}
      data-drop-parent={dropParent ? '' : undefined}
    >
      {handleProps || overlay ? (
        <button
          type="button"
          aria-label={t('editor.dragToReorder')}
          className={cn(
            'flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing pointer-coarse:size-7',
            !dragging && ROW_ACTION,
          )}
          {...handleProps}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        // A read-only tree has nothing to drag; keep the rows aligned.
        <span aria-hidden className="size-5 shrink-0" />
      )}
      {/* The indent, with a guide line per ancestor level under that ancestor's chevron. */}
      <span aria-hidden className="relative shrink-0" style={{ width: depth * INDENT, alignSelf: 'stretch' }}>
        {Array.from({ length: depth }, (_, level) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: one guide per level; the level is the identity.
            key={level}
            className="pointer-events-none absolute inset-y-0 w-px bg-border"
            style={{ insetInlineStart: level * INDENT + GUIDE_OFFSET }}
          />
        ))}
      </span>
      {/* Collapse chevron for any row with children; a spacer otherwise so every
          row's icon stays aligned. */}
      {collapsible ? (
        <button
          type="button"
          aria-label={collapsed ? t('editor.expand') : t('editor.collapse')}
          aria-expanded={!collapsed}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse?.(node.id);
          }}
        >
          {/* expanded → points down (both dirs); collapsed → points to the inline
              end (right in an LTR dashboard, left in RTL). */}
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
            <Folder className={iconClass} />
          ) : hasIcon(node.icon) ? (
            <PageIcon name={node.icon} className={iconClass} />
          ) : (
            <FileText className={iconClass} />
          )}
          {/* Only the title follows its own script's direction. */}
          <span className="truncate" dir="auto">
            {label}
          </span>
        </button>
      )}
      {(dragging && placeholder) || (overlay && hint) ? (
        <span
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[10.5px] text-primary',
            // On the floating row the hint hangs just below it, so it never squeezes the title.
            overlay ? 'absolute start-4 top-full mt-1 max-w-full bg-card shadow-sm ring-1 ring-border' : 'min-w-0 bg-primary/10',
          )}
        >
          <CornerDownRight aria-hidden className="size-3 shrink-0 rtl:-scale-x-100" />
          <span className="truncate" dir="auto">
            {overlay ? hint : placeholder}
          </span>
        </span>
      ) : null}
      {!overlay && !dragging && !renaming && onSettings ? (
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
      {isGroup && onAddChild && !renaming && !dragging ? (
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
