import { cn } from '@nibleaf/design-system/lib/utils';
import { isRtl, type Locale, type MessageKey, resolveLocale } from '@nibleaf/i18n';
import { translateFn, useLocale } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { type EditorState, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import type { Ref } from 'react';
import { Fragment, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { unsortedSlashItems } from './slash-items';
import type { SlashItem, UploadFn } from './slash-items/types';

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

export const createSlashItems = (onUpload?: UploadFn): SlashItem[] => unsortedSlashItems(onUpload).sort((a, b) => slashOrder(a) - slashOrder(b));

// Sections stay contiguous in the menu: the everyday writing blocks first, then
// images/tables, then notes & warnings; everything else (to-dos, quotes, code,
// cards…) is listed afterwards under "Advanced".
const basic = ['text', 'h1', 'h2', 'h3', 'bulletList', 'numberedList'];
const media = ['image', 'table'];
const callouts = ['note', 'tip', 'info', 'check', 'warning', 'danger'];
const itemName = (item: SlashItem) => item.titleKey.split('.')[2] ?? '';
export const slashSection = (item: SlashItem): MessageKey => {
  const name = itemName(item);
  if (basic.includes(name)) return 'editor.slash.basicBlocks';
  if (media.includes(name)) return 'editor.slash.section.media';
  if (callouts.includes(name)) return 'editor.slash.section.callouts';
  return 'editor.slash.section.advanced';
};
const slashOrder = (item: SlashItem): number => {
  const order = [...basic, ...media, ...callouts];
  const index = order.indexOf(itemName(item));
  return index < 0 ? order.length : index;
};
export const rankSlashItems = (items: SlashItem[], query: string, locale: Locale = 'en'): SlashItem[] => {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return items;
  const score = (item: SlashItem) => {
    const labels = [
      translateFn(item.titleKey, undefined, locale),
      labelInFn(item.titleKey, 'en'),
      labelInFn(item.titleKey, 'ar'),
      itemName(item),
    ].map((label) => label.toLocaleLowerCase());
    const aliases = (item.keywords ?? []).map((label) => label.toLocaleLowerCase());
    if (labels.some((label) => label === q)) return 0;
    if (aliases.some((label) => label === q)) return 1;
    if (labels.some((label) => label.startsWith(q))) return 2;
    if (aliases.some((label) => label.startsWith(q))) return 3;
    return 4;
  };
  return items
    .filter((item) =>
      [haystackOf(item), translateFn(item.titleKey, undefined, locale), translateFn(item.descKey, undefined, locale), itemName(item)].some((text) =>
        text.toLocaleLowerCase().includes(q),
      ),
    )
    .sort((a, b) => score(a) - score(b));
};

/** Resolve a slash label in one canonical catalog for locale-independent search. */
const labelInFn = (label: MessageKey, locale: 'en' | 'ar'): string => translateFn(label, undefined, locale);

/** Search haystack across BOTH locales (+ keywords) so filtering works whatever
 *  language the menu is displayed in. */
const haystackOf = (item: SlashItem): string =>
  [
    labelInFn(item.titleKey, 'en'),
    labelInFn(item.titleKey, 'ar'),
    labelInFn(item.descKey, 'en'),
    labelInFn(item.descKey, 'ar'),
    ...(item.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();

interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SlashListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  ref?: Ref<SlashListHandle>;
}

export const nextSlashSelection = (selected: number, count: number, key: string): number | null => {
  if (count <= 0) return null;
  if (key === 'ArrowUp') return (selected + count - 1) % count;
  if (key === 'ArrowDown') return (selected + 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
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

const SlashList = ({ items, command, ref }: SlashListProps) => {
  const { t, locale } = useLocale();
  const label = (value: MessageKey): string => t(value);
  const [selected, setSelected] = useState(0);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset the highlight to the first item whenever the filtered list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset-on-items-change
  useEffect(() => {
    setSelected(0);
  }, [items]);

  // Keep the active item scrolled into view.
  useLayoutEffect(() => {
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) {
        return false;
      }
      const nextSelection = nextSlashSelection(selected, items.length, event.key);
      if (nextSelection !== null) {
        setSelected(nextSelection);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) {
          command(item);
        }
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label={t('editor.slash.basicBlocks')}
      // The menu is interface text: follow the dashboard language's direction, not
      // the page's (an English dashboard editing an Arabic page stays left-to-right).
      dir={isRtl(locale) ? 'rtl' : 'ltr'}
      className="z-50 max-h-80 w-[304px] overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-xl"
    >
      {items.length === 0 ? (
        <div className="px-3 py-3 text-muted-foreground text-sm">{t('editor.slash.empty')}</div>
      ) : (
        items.map((item, index) => {
          const Icon = item.icon;
          const previous = items[index - 1];
          return (
            <Fragment key={item.titleKey}>
              {!previous || slashSection(previous) !== slashSection(item) ? (
                <div className="px-2.5 py-1.5 text-xs text-muted-foreground" role="presentation">
                  {t(slashSection(item))}
                </div>
              ) : null}
              <button
                type="button"
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={index === selected}
                data-index={index}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => command(item)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-start',
                  index === selected ? 'bg-primary/10' : 'bg-transparent',
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-[13px]">
                  <Icon className="size-4 text-foreground/80" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-[13.5px] text-foreground">{label(item.titleKey)}</span>
                  <span className="block truncate text-muted-foreground text-xs">{label(item.descKey)}</span>
                </span>
              </button>
            </Fragment>
          );
        })
      )}
    </div>
  );
};

const createSuggestion = (onUpload?: UploadFn, locale?: Locale): Omit<SuggestionOptions<SlashItem>, 'editor'> => {
  const items = createSlashItems(onUpload);
  return {
    pluginKey: slashSuggestionKey,
    char: '/',
    startOfLine: false,
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
              command: (item: SlashItem) => props.command(item),
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
            command: (item: SlashItem) => props.command(item),
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

/** Slash-command extension: type `/` to open the Basic blocks menu. `locale` is
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
