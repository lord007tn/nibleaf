import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { MovePageBody } from '@nibleaf/validators';
import { FileText, Folder, Languages } from 'lucide-react';
import { type KeyboardEvent, useId, useMemo, useState } from 'react';
import type { PageNode } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { filterPageIds, pageMatchesSearch, pageStructureRevision, subtreeIds } from './page-tree-utils';
import { flatten, rowName, usePageTreeReveal } from './sortable-page-tree';

/** Confirmed without choosing a destination. */
class NoDestination extends Error {}

interface Destination {
  key: string;
  parentId: string | null;
  languageId: string;
  label: string;
  depth: number;
  icon: 'language' | 'group' | 'page';
  /** Where the page already is: listed, but not a choice. */
  current: boolean;
  /** Matches the search itself; false for a page listed only as a match's ancestor. */
  match: boolean;
}

/** The places a page can move to: the top level of each language, and every
 *  page or group except the page itself and the pages inside it. A filter keeps
 *  the matches and the pages above them, as the tree's own filter does. */
export function moveDestinations(
  page: Pick<PageNode, 'id' | 'parentId' | 'languageId'>,
  pages: readonly PageNode[],
  languages: ReadonlyArray<{ id: string; label: string }>,
  query: string,
  topLevel: (language: string) => string,
): Destination[] {
  const excluded = subtreeIds(pages, page.id);
  const candidates = pages.filter((node) => !excluded.has(node.id));
  const included = query.trim() ? filterPageIds(candidates, query) : null;
  return languages.flatMap((language) => [
    {
      key: `language:${language.id}`,
      parentId: null,
      languageId: language.id,
      label: topLevel(language.label),
      depth: 0,
      icon: 'language' as const,
      current: page.parentId === null && page.languageId === language.id,
      match: !included,
    },
    ...flatten(candidates.filter((node) => node.languageId === language.id))
      .filter((item) => !included || included.has(item.id))
      .map((item) => ({
        key: item.id,
        parentId: item.id,
        languageId: language.id,
        label: rowName(item.node).label,
        depth: item.depth + 1,
        icon: item.node.kind === 'GROUP' ? ('group' as const) : ('page' as const),
        current: page.parentId === item.id,
        match: !included || pageMatchesSearch(item.node, query),
      })),
  ]);
}

/**
 * "Move to…" from a page's row menu: choose a new parent from a searchable list
 * of the tree instead of dragging. The page goes to the end of its new parent,
 * with the pages inside it, through the same move request as a drag (and the
 * same errors), and is refused if the tree changed since it was shown.
 */
export function MovePageDialog({
  page,
  pages,
  languages,
  onMove,
  onClose,
}: {
  page: PageNode;
  /** Every page of every language on the active branch. */
  pages: PageNode[];
  languages: ReadonlyArray<{ id: string; label: string }>;
  onMove: (move: MovePageBody) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const reveal = usePageTreeReveal();
  const name = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const destinations = useMemo(
    () =>
      moveDestinations(page, pages, languages, query, (language) =>
        languages.length > 1 ? t('editor.dnd.topLevelIn', { language }) : t('editor.dnd.topLevel'),
      ),
    [page, pages, languages, query, t],
  );
  // While searching, the first page that matches itself (not an ancestor listed
  // only for context) is the default choice, and Enter picks it.
  const firstMatch = query.trim()
    ? destinations.find((destination) => destination.match && destination.icon !== 'language' && !destination.current)
    : undefined;
  const selectedKey = destinations.some((destination) => destination.key === selected) ? selected : (firstMatch?.key ?? null);
  const choice = destinations.find((destination) => destination.key === selectedKey && !destination.current);

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    // Enter in the filter picks the first match; it never submits the move.
    event.preventDefault();
    if (firstMatch) setSelected(firstMatch.key);
  };

  return (
    <ActionDialog
      open
      onOpenChange={(open) => {
        if (open) return;
        onClose();
        // The menu item that opened the dialog is gone: return to the page's row
        // (shown in its new place after a move).
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="treeitem"][data-page-id="${page.id}"]`)?.focus());
      }}
      className="sm:max-w-md"
      initialFocus="content"
      title={t('editor.moveTitle', { title: rowName(page).label })}
      description={t('editor.moveHint')}
      confirmLabel={t('editor.pageSettings.moveLanguage.confirm')}
      cancelLabel={t('common.cancel')}
      pendingLabel={t('editor.tree.moving', { title: rowName(page).label })}
      fallbackErrorMessage={t('editor.reorderFailed')}
      errorMessage={(error) => (error instanceof NoDestination ? t('editor.moveChoose') : friendlyErrorMessage(t, error, 'editor.reorderFailed'))}
      onConfirm={async () => {
        if (!choice) throw new NoDestination();
        const expectedStructureRevision = await pageStructureRevision(pages);
        await onMove({
          pageId: page.id,
          parentId: choice.parentId,
          position: { at: 'end' },
          ...(choice.languageId === page.languageId ? {} : { languageId: choice.languageId }),
          ...(expectedStructureRevision ? { expectedStructureRevision } : {}),
        });
        reveal(choice.parentId);
      }}
    >
      <div className="grid min-w-0 gap-2">
        <Input
          type="search"
          density="compact"
          autoFocus
          aria-label={t('editor.tree.search')}
          placeholder={t('editor.tree.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
        <fieldset className="max-h-72 min-w-0 overflow-y-auto rounded-md border border-border p-1">
          <legend className="sr-only">{t('editor.moveTitle', { title: rowName(page).label })}</legend>
          {destinations.map((destination) => {
            const Icon = destination.icon === 'language' ? Languages : destination.icon === 'group' ? Folder : FileText;
            const checked = selectedKey === destination.key && !destination.current;
            return (
              <label
                key={destination.key}
                className={cn(
                  'flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1.5 pe-2 text-sm pointer-coarse:min-h-11',
                  checked ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  destination.current && 'cursor-default text-muted-foreground',
                  !destination.match && !checked && 'text-muted-foreground',
                  destination.icon === 'language' && 'font-medium',
                )}
                style={{ paddingInlineStart: 8 + destination.depth * 16 }}
                data-destination={destination.key}
              >
                <input
                  type="radio"
                  name={name}
                  value={destination.key}
                  checked={checked}
                  disabled={destination.current}
                  onChange={() => setSelected(destination.key)}
                />
                <Icon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate" dir="auto">
                  {destination.label}
                </span>
                {destination.current ? <span className="ms-auto shrink-0 text-xs">{t('editor.moveCurrent')}</span> : null}
              </label>
            );
          })}
        </fieldset>
      </div>
    </ActionDialog>
  );
}
