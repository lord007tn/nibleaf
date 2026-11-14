import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { isRtl, type Locale, type MessageKey, resolveLocale } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { type EditorState, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import type { Ref } from 'react';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { unsortedSlashItems } from './slash-items';
import type { SlashItem, UploadFn } from './slash-items/types';
import { groupSlashItems, searchSlashItems, slashMenuOrder, slashQueryKeepsMenuOpen, slashSectionOf } from './slash-search';

/** The page language scaffolds are written in: an explicit extension option wins,
 *  then a `lang` on the editor's direction scope (the host's `dir` wrapper), then
 *  that scope's direction — a right-to-left page defaults to Arabic. */
export const scaffoldLocaleOf = (scope: { lang?: string; dir?: string } | null | undefined, explicit?: Locale): Locale => {
  if (explicit) return explicit;
  const fromLang = scope?.lang ? resolveLocale(scope.lang) : null;
  if (fromLang) return fromLang;
  return scope?.dir === 'rtl' ? 'ar' : 'en';
};

/** Resolve the page language for a running editor from its nearest `dir` scope. */
export const slashPageLocale = (editor: Pick<Editor, 'view'>, explicit?: Locale): Locale =>
  scaffoldLocaleOf(editor.view.dom.closest<HTMLElement>('[dir]'), explicit);

export const createSlashItems = (onUpload?: UploadFn): SlashItem[] =>
  unsortedSlashItems(onUpload).sort((a, b) => slashMenuOrder(a) - slashMenuOrder(b));

/** The heading of the menu section an item is listed under (Basic blocks, Notes & warnings, Media & tables…). */
export const slashSection = (item: SlashItem): MessageKey => slashSectionOf(item).heading;

/** The items matching `query`, best first (rule and ranking in slash-search.ts). A blank query keeps menu order. */
export const rankSlashItems = (items: SlashItem[], query: string, locale: Locale = 'en'): SlashItem[] => searchSlashItems(items, query, locale);

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  /** The text typed after "/"; blank shows "Suggested" first (see groupSlashItems). */
  query: string;
  command: (item: SlashItem) => void;
  /** The editor's editable element: while the menu is open it names the active option for screen readers. */
  editorDom?: HTMLElement;
  ref?: Ref<SlashListHandle>;
}

/**
 * The next highlighted option for a navigation key, or null when the key is not
 * one. Arrows wrap; Home/End go to the first/last option; PageDown goes to the
 * first option of the next section (the last option from the last section) and
 * PageUp to the start of the current section, or of the previous one when
 * already there. `groupStarts` are the indexes where each section begins.
 */
export const nextSlashSelection = (selected: number, count: number, key: string, groupStarts: readonly number[] = [0]): number | null => {
  if (count <= 0) return null;
  if (key === 'ArrowUp') return (selected + count - 1) % count;
  if (key === 'ArrowDown') return (selected + 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'PageDown') return groupStarts.find((start) => start > selected && start < count) ?? count - 1;
  if (key === 'PageUp') return groupStarts.findLast((start) => start < selected) ?? 0;
  return null;
};

/** Whether `/` should be captured as a command trigger at the cursor. */
export const shouldHandleSlashTrigger = (previousCharacter: string): boolean => previousCharacter === '' || previousCharacter === ' ';

/** Offset of the slash that owns the active command query, relative to the
 * current text block, or null when the cursor is not in a command query. */
export const slashTriggerOffset = (textBeforeCursor: string): number | null => {
  if (!/(?:^| )\/[^/\s]*$/.test(textBeforeCursor)) return null;
  return textBeforeCursor.lastIndexOf('/');
};

interface SlashAnchorRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Resolve the first visible popup anchor. The suggestion decoration may not
 * have committed on the slash transaction, while coordsAtPos is already valid. */
export const resolveSlashAnchor = (
  decorationRect: (() => SlashAnchorRect | null | undefined) | null | undefined,
  coordsAtPos: (position: number) => SlashAnchorRect,
  position: number,
): SlashAnchorRect | null => {
  const decorated = decorationRect?.();
  if (decorated) return decorated;
  try {
    return coordsAtPos(position);
  } catch {
    return null;
  }
};

/** The option element cmdk rendered for `value` (cmdk owns the option ids). */
const optionFor = (list: HTMLElement | null, value: string | undefined): HTMLElement | null => {
  if (!list || value === undefined) return null;
  for (const option of list.querySelectorAll<HTMLElement>('[cmdk-item]')) {
    if (option.getAttribute('data-value') === value) return option;
  }
  return null;
};

const SlashList = ({ items, query, command, editorDom, ref }: SlashListProps) => {
  const { t, locale } = useLocale();
  const groups = useMemo(() => groupSlashItems(items, query), [items, query]);
  // One flat list of options in display order, keyed by section and block.
  const options = useMemo(() => groups.flatMap((group) => group.items.map((item) => ({ item, value: `${group.key}:${item.titleKey}` }))), [groups]);
  const groupStarts = useMemo(() => {
    const starts: number[] = [];
    let index = 0;
    for (const group of groups) {
      starts.push(index);
      index += group.items.length;
    }
    return starts;
  }, [groups]);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const active = options[Math.min(selected, options.length - 1)];

  // Reset the highlight to the first (best) option whenever the list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset-on-items-change
  useEffect(() => {
    setSelected(0);
  }, [options]);

  // Keep the active option in view (with its section heading when it is the
  // section's first), and name it as the active descendant: on the listbox and
  // on the editor, which keeps focus while the menu is open.
  useLayoutEffect(() => {
    const list = listRef.current;
    const option = optionFor(list, active?.value);
    if (option) {
      const group = option.closest('[cmdk-group]');
      if (group?.querySelector('[cmdk-item]') === option)
        group.querySelector<HTMLElement>('[cmdk-group-heading]')?.scrollIntoView?.({ block: 'nearest' });
      option.scrollIntoView?.({ block: 'nearest' });
    }
    for (const element of [list, editorDom]) {
      if (!element) continue;
      if (option?.id) element.setAttribute('aria-activedescendant', option.id);
      else element.removeAttribute('aria-activedescendant');
    }
    if (editorDom && list?.id) editorDom.setAttribute('aria-controls', list.id);
  });
  useEffect(
    () => () => {
      editorDom?.removeAttribute('aria-activedescendant');
      editorDom?.removeAttribute('aria-controls');
    },
    [editorDom],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (options.length === 0) {
        return false;
      }
      const nextSelection = nextSlashSelection(selected, options.length, event.key, groupStarts);
      if (nextSelection !== null) {
        setSelected(nextSelection);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (active) {
          command(active.item);
        }
        return true;
      }
      return false;
    },
  }));

  return (
    <Command
      // Focus never leaves the editor: the editor's keys move the selection
      // (above) and cmdk reports pointer hover here. The list is already ranked.
      value={active?.value ?? ''}
      onValueChange={(value) => {
        const index = options.findIndex((option) => option.value === value);
        if (index >= 0) setSelected(index);
      }}
      shouldFilter={false}
      // The menu is interface text: follow the dashboard language's direction, not
      // the page's (an English dashboard editing an Arabic page stays left-to-right).
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
      className="z-50 h-auto w-[320px] border border-border bg-card p-0 shadow-xl"
    >
      <CommandList ref={listRef} label={t('editor.insertBlock')} className="max-h-[min(26rem,calc(100vh-6rem))] p-1">
        {options.length === 0 ? <CommandEmpty className="px-3 py-3 text-start text-muted-foreground">{t('editor.slash.empty')}</CommandEmpty> : null}
        {groups.map((group) => (
          <CommandGroup key={group.key} heading={t(group.heading)} className="p-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.titleKey}
                  value={`${group.key}:${item.titleKey}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onSelect={() => command(item)}
                  className="gap-3 rounded-lg px-2.5 py-1.5 text-start data-selected:text-foreground"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-[13px]">
                    <Icon className="size-4 text-foreground/80" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-[13.5px] text-foreground">{t(item.titleKey)}</span>
                    <span className="block truncate text-muted-foreground text-xs">{t(item.descKey)}</span>
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};

const createSuggestion = (onUpload?: UploadFn, locale?: Locale): Omit<SuggestionOptions<SlashItem>, 'editor'> => {
  const items = createSlashItems(onUpload);
  return {
    pluginKey: slashSuggestionKey,
    char: '/',
    startOfLine: false,
    // Block names have spaces ("code block"); slashQueryKeepsMenuOpen closes the
    // menu again on a double space, a leading space, or once the words typed
    // can no longer match any block.
    allowSpaces: true,
    allow: ({ state, range }) =>
      slashQueryKeepsMenuOpen(state.doc.textBetween(range.from + 1, range.to), (finished) => rankSlashItems(items, finished, locale).length > 0),
    initialItems: items,
    items: ({ query }) => rankSlashItems(items, query, locale),
    command: ({ editor, range, props }) => {
      editor.view.dispatch(closeHistory(editor.state.tr));
      props.command({ editor, range, locale: slashPageLocale(editor, locale) });
      editor.view.dispatch(closeHistory(editor.state.tr));
    },
    render: () => {
      let component: ReactRenderer<SlashListHandle, SlashListProps> | null = null;
      let currentProps: SuggestionProps<SlashItem> | null = null;
      let cleanup: (() => void) | null = null;
      let positionFrame: number | null = null;

      const position = () => {
        if (!component || !currentProps) return;
        // The decoration is created by the same transaction as the slash. On
        // that first transaction it can be active before its DOM node exists,
        // so fall back to the immediately available document position.
        const anchor = resolveSlashAnchor(
          currentProps.clientRect,
          currentProps.editor.view.coordsAtPos.bind(currentProps.editor.view),
          currentProps.range.from,
        );
        if (!anchor) return;

        const popup = component.element;
        const gap = 6;
        const edge = 12;
        const popupRect = popup.getBoundingClientRect();
        const rtl = currentProps.editor.view.dom.closest('[dir]')?.getAttribute('dir') === 'rtl';
        popup.dir = rtl ? 'rtl' : 'ltr';
        const left = Math.max(edge, Math.min(rtl ? anchor.right - popupRect.width : anchor.left, window.innerWidth - popupRect.width - edge));
        const below = anchor.bottom + gap;
        const top = below + popupRect.height <= window.innerHeight - edge ? below : Math.max(edge, anchor.top - popupRect.height - gap);

        Object.assign(popup.style, {
          position: 'fixed',
          left: `${left}px`,
          top: `${top}px`,
          width: 'max-content',
          zIndex: '50',
        });
      };

      return {
        onStart: (props) => {
          currentProps = props;
          component = new ReactRenderer(SlashList, {
            editor: props.editor,
            props: {
              items: props.items,
              query: props.query,
              command: (item: SlashItem) => props.command(item),
              editorDom: props.editor.view.dom,
            },
          });
          document.body.appendChild(component.element);
          position();
          // On the insertion transaction the suggestion decoration may not be
          // in the DOM yet, so clientRect() can legitimately be null. Position
          // again after ProseMirror commits the decoration; otherwise the menu
          // exists at the end of <body> and only appears after a later cursor
          // movement (leaving the line and coming back).
          positionFrame = requestAnimationFrame(position);

          const reposition = () => position();
          const dismiss = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && component && !component.element.contains(target) && !props.editor.view.dom.contains(target)) {
              exitSuggestion(props.editor.view, slashSuggestionKey);
            }
          };
          window.addEventListener('resize', reposition);
          window.addEventListener('scroll', reposition, true);
          document.addEventListener('pointerdown', dismiss, true);
          cleanup = () => {
            if (positionFrame !== null) cancelAnimationFrame(positionFrame);
            positionFrame = null;
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
            document.removeEventListener('pointerdown', dismiss, true);
            component?.element.remove();
          };
        },
        onUpdate: (props) => {
          currentProps = props;
          component?.updateProps({
            items: props.items,
            query: props.query,
            command: (item: SlashItem) => props.command(item),
            editorDom: props.editor.view.dom,
          });
          if (positionFrame !== null) cancelAnimationFrame(positionFrame);
          positionFrame = requestAnimationFrame(position);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          cleanup?.();
          cleanup = null;
          component?.destroy();
          component = null;
          currentProps = null;
        },
      };
    },
  };
};

const slashSuggestionKey = new PluginKey('nibleaf-slash-command');
/** True while the "/" block menu is open, so other floating menus can step aside. */
export const isSlashMenuOpen = (state: EditorState): boolean => Boolean(slashSuggestionKey.getState(state)?.active);

/** Slash-command extension: type `/` to open the block menu. `locale` is
 *  the page language for inserted scaffold text; when omitted it is derived from
 *  the host's `dir` wrapper (see `slashPageLocale`). */
export const SlashCommand = Extension.create<{ onUpload?: UploadFn; locale?: Locale }>({
  name: 'slashCommand',
  addOptions() {
    return { onUpload: undefined, locale: undefined };
  },
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...createSuggestion(this.options.onUpload, this.options.locale) })];
  },
});
