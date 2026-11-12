import { Button } from '@nibleaf/design-system/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@nibleaf/design-system/components/ui/dropdown-menu-radio';
import { IconButton } from '@nibleaf/design-system/components/ui/icon-button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { Editor, EditorEvents } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu, type BubbleMenuProps } from '@tiptap/react/menus';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  ExternalLink,
  FileText,
  Highlighter,
  Italic,
  Link as LinkIcon,
  MessageSquarePlus,
  Pilcrow,
  Strikethrough,
  Unlink,
} from 'lucide-react';
import { type ComponentType, type KeyboardEvent, lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MOD_K_OWNER_ATTRIBUTE } from '@/lib/mod-k-owner';
import { isWebAddress, useEditorLinks } from './editor-links';
import { selectionMenuApplies, selectionMenuRequest } from './extensions/selection-shortcuts';
import { isPageQuery, normalizeLinkUrl, type PageLinkMatch } from './link-utils';
import { currentTurnIntoKind, TURN_INTO_OPTIONS, type TurnIntoKind, turnInto } from './turn-into';

const PageLinkPicker = lazy(() => import('./extensions/page-link-picker'));

/** The anchor the comment flow attaches a new comment to. */
export interface CommentAnchor {
  quote: string;
  from: number;
  to: number;
}

interface EditorBubbleMenuProps {
  editor: Editor;
  /** Starts the page's comment flow for the selection. Without it (comments
   *  unavailable to this writer) the menu offers no Comment action. */
  onComment?: (anchor: CommentAnchor) => void;
}

interface MarkButton {
  labelKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  /** Letter of the Ctrl/⌘ shortcut, shown in the label. */
  shortcut?: string;
  run: () => void;
}

/**
 * Inline link editor: shows the current URL prefilled with Save / Open / Remove
 * actions. Used inside the selection bubble menu and the WYSIWYG toolbar popover.
 * URLs are validated (http(s), mailto:, tel:, #anchor, /relative) — unsafe
 * schemes like javascript: are rejected inline instead of being silently saved.
 */
export function LinkEditorPanel({
  editor,
  initialUrl,
  onDone,
  autoFocus = false,
}: {
  editor: Editor;
  initialUrl: string;
  onDone: () => void;
  /** Focus the URL field on mount — only when the panel was opened explicitly,
   *  never when it appears because the caret moved into a link. */
  autoFocus?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState(initialUrl);

  const [invalid, setInvalid] = useState(false);
  // The field is a combobox over the page suggestions: Arrow keys move the
  // highlight, Enter links the highlighted page (AUTH-02).
  const [matches, setMatches] = useState<PageLinkMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  // Re-seed when the caret moves to a different link (the prefilled URL changes).
  useEffect(() => {
    setDraft(initialUrl);
    setInvalid(false);
  }, [initialUrl]);
  // A new list of suggestions starts with nothing highlighted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the suggestions change.
  useEffect(() => setActiveIndex(-1), [matches]);

  const setHref = (href: string) => {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    onDone();
  };
  const pick = (match: PageLinkMatch) => setHref(`/${match.path}`);
  const save = () => {
    const highlighted = matches[activeIndex];
    if (highlighted) {
      pick(highlighted);
      return;
    }
    // Typed text that isn't a link is a page search: link the best match, and
    // never save the words themselves as the address. An existing link saved
    // unchanged keeps its address.
    if (isPageQuery(draft) && draft.trim() !== initialUrl.trim()) {
      const best = matches[0];
      if (best) {
        pick(best);
      } else {
        setInvalid(true);
      }
      return;
    }
    const href = normalizeLinkUrl(draft);
    if (!href) {
      setInvalid(true);
      return;
    }
    setHref(href);
  };
  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onDone();
  };
  const normalized = normalizeLinkUrl(draft);
  // Web addresses (which always carry a scheme after normalization) open in a
  // new tab. A relative link ('/x', './x', 'getting-started') would resolve
  // against the dashboard's origin, so in the page editor it opens the page it
  // leads to on the site, in the editor; anything else can't be opened here.
  const links = useEditorLinks();
  const openHref = normalized && isWebAddress(normalized) ? normalized : null;
  const target = normalized && !openHref && links ? links.resolve(normalized) : null;
  const linkedPageId = target?.kind === 'page' ? target.pageId : null;
  // Not resolved yet (pages loading, or a link into another docs version): it
  // may be a page, so Open stays available and resolves on the way.
  const unresolved = target?.kind === 'unknown';
  const openLabel = linkedPageId || unresolved ? t('editor.link.openPage') : t('editor.link.open');
  const openDisabledReason =
    !normalized || openHref || linkedPageId || unresolved
      ? undefined
      : target?.kind === 'missing'
        ? t('editor.link.missingPage')
        : t('editor.link.openRelativeHint');
  const iconButton = 'size-7 shrink-0 text-foreground/80';
  // Load the other docs versions' pages when a link may lead into one of them.
  useEffect(() => {
    if (unresolved) links?.loadVersions();
  }, [unresolved, links]);

  return (
    <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 p-0.5">
      {invalid ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {t('editor.link.invalid')}
        </p>
      ) : null}
      <Input
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={matches.length > 0 ? listboxId : undefined}
        aria-activedescendant={matches[activeIndex] ? optionId(activeIndex) : undefined}
        onKeyDown={(event) => {
          // Keys that confirm or move an IME composition belong to the IME.
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length > 0) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex((index) => (index < 0 ? (step > 0 ? 0 : matches.length - 1) : (index + step + matches.length) % matches.length));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
            editor.commands.focus();
          }
        }}
        dir="auto"
        placeholder={t('editor.link.search')}
        aria-label={t('editor.link.search')}
        aria-invalid={invalid}
        title={invalid ? t('editor.link.invalid') : undefined}
        className="h-7 w-56 bg-background px-2 font-mono text-[12px] placeholder:text-muted-foreground/60 md:text-[12px]"
      />
      <Button
        aria-label={t('editor.link.save')}
        className={iconButton}
        onClick={save}
        size="icon-xs"
        title={t('editor.link.save')}
        type="button"
        variant="ghost"
      >
        <Check className="size-4" />
      </Button>
      <TooltipButton
        aria-label={openLabel}
        className={iconButton}
        disabled={!(openHref || linkedPageId || unresolved)}
        disabledReason={openDisabledReason}
        onClick={() => {
          if (openHref) {
            window.open(openHref, '_blank', 'noopener,noreferrer');
          } else if (linkedPageId && links) {
            onDone();
            links.open(linkedPageId);
          } else if (unresolved && links && normalized) {
            onDone();
            void links.resolveAsync(normalized).then((resolved) => {
              if (resolved.kind === 'page') links.open(resolved.pageId);
              else if (resolved.kind === 'missing') toast.error(t('editor.link.missingPage'));
            });
          }
        }}
        size="icon-xs"
        tooltip={openLabel}
        type="button"
        variant="ghost"
      >
        {linkedPageId || unresolved ? <FileText className="size-4" /> : <ExternalLink className="size-4" />}
      </TooltipButton>
      <Suspense fallback={null}>
        <PageLinkPicker
          editor={editor}
          query={draft}
          listboxId={listboxId}
          optionId={optionId}
          activeIndex={activeIndex}
          onMatches={setMatches}
          onPick={pick}
        />
      </Suspense>
      {editor.isActive('link') ? (
        <Button
          aria-label={t('editor.link.remove')}
          className={iconButton}
          onClick={remove}
          size="icon-xs"
          title={t('editor.link.remove')}
          type="button"
          variant="ghost"
        >
          <Unlink className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

const isApplePlatform = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The text menu's bubble plugin; it also reads a 'hide' meta under this key. */
const TEXT_MENU_KEY = 'nibleaf-text-menu';

/** Marks the Turn into popup, which is portaled out of the menu but belongs to it. */
const MENU_POPUP_ATTRIBUTE = 'data-text-menu-popup';

/** Whether a node is in the menu, including its portaled Turn into popup. */
const inMenu = (menu: Element | null | undefined, node: Node | null): boolean =>
  node !== null && (Boolean(menu?.contains(node)) || (node instanceof Element && node.closest(`[${MENU_POPUP_ATTRIBUTE}]`) !== null));

/** The toolbar's own controls, in order, for arrow-key movement. */
const TOOLBAR_ITEM = '[data-toolbar-item]:not([disabled])';

/**
 * Inline formatting toolbar that floats under the current text selection:
 * Turn into, bold / italic / strike / code / highlight, link and comment. Also
 * appears when the caret rests inside a link (as a link inspector with the URL
 * prefilled).
 *
 * Keyboard: Ctrl/⌘+K in the page opens the link field; Alt+F10 moves focus into
 * the toolbar, Arrow keys and Home/End move between its controls, and Escape
 * returns to the text with the selection intact.
 */
export function EditorBubbleMenu({ editor, onComment }: EditorBubbleMenuProps) {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);
  // Shown by the bubble plugin (it attaches the menu after a short delay).
  const [visible, setVisible] = useState(false);
  // A keyboard request waiting for the menu to be on screen.
  const [pendingFocus, setPendingFocus] = useState<'link' | 'toolbar' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      highlight: current.isActive('highlight'),
      link: current.isActive('link'),
      href: (current.getAttributes('link').href as string | undefined) ?? '',
      empty: current.state.selection.empty,
      kind: currentTurnIntoKind(current),
    }),
  });

  // Caret inside a link (no selection) → the menu acts as a link inspector.
  const inspectingLink = state.link && state.empty;
  const showLinkPanel = linkOpen || inspectingLink;

  // Reset the manual panel when the selection leaves link territory.
  useEffect(() => {
    if (state.empty && !state.link) {
      setLinkOpen(false);
    }
  }, [state.empty, state.link]);

  // Ctrl/⌘+K and Alt+F10 from the page (extensions/selection-shortcuts.ts).
  useEffect(() => {
    const onTransaction = ({ transaction }: EditorEvents['transaction']) => {
      const request = selectionMenuRequest(transaction);
      if (request === 'link') setLinkOpen(true);
      if (request) setPendingFocus(request);
    };
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  // A request is for this editing session: once focus leaves both the page and
  // the menu, it is dropped, so it can never pull focus back later.
  useEffect(() => {
    const leftBoth = (next: EventTarget | null) => !(next instanceof Node && (editor.view.dom.contains(next) || inMenu(menuRef.current, next)));
    const onBlur = ({ event }: EditorEvents['blur']) => {
      if (leftBoth(event.relatedTarget)) setPendingFocus(null);
    };
    const menu = menuRef.current;
    const onMenuFocusOut = (event: FocusEvent) => {
      if (leftBoth(event.relatedTarget)) setPendingFocus(null);
    };
    editor.on('blur', onBlur);
    menu?.addEventListener('focusout', onMenuFocusOut);
    return () => {
      editor.off('blur', onBlur);
      menu?.removeEventListener('focusout', onMenuFocusOut);
    };
  }, [editor]);

  // Move focus once the menu is attached: the link field, or the toolbar's tab
  // stop. While a link is inspected the menu holds only the link field, so a
  // toolbar request goes there, as Ctrl/⌘+K on a link does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the link field appears with showLinkPanel.
  useEffect(() => {
    if (!visible || !pendingFocus) return;
    const target =
      pendingFocus === 'link' || inspectingLink
        ? menuRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')
        : (toolbarRef.current?.querySelector<HTMLElement>(`${TOOLBAR_ITEM}[tabindex="0"]`) ??
          toolbarRef.current?.querySelector<HTMLElement>(TOOLBAR_ITEM));
    // A request for a control that isn't there is dropped, never kept for later.
    setPendingFocus(null);
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  }, [visible, pendingFocus, showLinkPanel, inspectingLink]);

  // Shown only while the writer is in the page or the menu, as TipTap's default
  // rule does, so a delayed update never shows it over another field.
  const shouldShow = useCallback<NonNullable<BubbleMenuProps['shouldShow']>>(
    ({ editor: current, view, element }) =>
      current.isEditable && (view.hasFocus() || inMenu(element, document.activeElement)) && selectionMenuApplies(current.state),
    [],
  );
  const options = useMemo<BubbleMenuProps['options']>(
    () => ({
      placement: 'bottom',
      onShow: () => setVisible(true),
      onHide: () => {
        setVisible(false);
        setPendingFocus(null);
      },
    }),
    [],
  );

  const modifier = isApplePlatform() ? '⌘' : 'Ctrl+';
  const withShortcut = (labelKey: MessageKey, shortcut?: string) => `${t(labelKey)}${shortcut ? ` (${modifier}${shortcut})` : ''}`;
  const buttons: MarkButton[] = [
    { labelKey: 'editor.format.bold', icon: Bold, active: state.bold, shortcut: 'B', run: () => editor.chain().focus().toggleBold().run() },
    { labelKey: 'editor.format.italic', icon: Italic, active: state.italic, shortcut: 'I', run: () => editor.chain().focus().toggleItalic().run() },
    { labelKey: 'editor.format.strikethrough', icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { labelKey: 'editor.format.code', icon: Code, active: state.code, run: () => editor.chain().focus().toggleCode().run() },
    { labelKey: 'editor.format.highlight', icon: Highlighter, active: state.highlight, run: () => editor.chain().focus().toggleHighlight().run() },
  ];

  // Roving tabindex: the toolbar is one Tab stop, on the control last focused
  // (the first one at the start); the arrow keys move along it.
  const itemKeys = ['turnInto', ...buttons.map((button) => button.labelKey), 'link', ...(onComment ? ['comment'] : [])];
  const [rovingKey, setRovingKey] = useState('turnInto');
  const tabStop = itemKeys.includes(rovingKey) ? rovingKey : 'turnInto';
  const rovingProps = (key: string) => ({
    'data-toolbar-item': key,
    tabIndex: key === tabStop ? 0 : -1,
    onFocus: () => setRovingKey(key),
  });

  const comment = () => {
    const { from, to } = editor.state.selection;
    const quote = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!quote || !onComment) return;
    onComment({ quote, from, to });
    // The writer continues in the comment composer: put the menu away until
    // they come back to the text.
    editor.view.dispatch(editor.state.tr.setMeta(TEXT_MENU_KEY, 'hide').setMeta('addToHistory', false));
  };

  // Arrow keys move along the toolbar in reading order (mirrored in RTL). Read in
  // the capture phase, so an open tooltip cannot swallow Escape.
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(TOOLBAR_ITEM));
    const index = items.indexOf(event.target as HTMLElement);
    // Keys inside the Turn into menu (a portal) belong to the menu.
    if (index < 0) return;
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number;
    if (event.key === forward) next = (index + 1) % items.length;
    else if (event.key === backward) next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      editor.commands.focus();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  };

  const iconButton = (active: boolean) => cn('size-7 text-foreground/80', active && 'bg-muted text-foreground');

  return (
    <BubbleMenu
      ref={menuRef}
      data-editor-bubble-menu=""
      {...{ [MOD_K_OWNER_ATTRIBUTE]: '' }}
      editor={editor}
      pluginKey={TEXT_MENU_KEY}
      options={options}
      shouldShow={shouldShow}
      className="flex max-w-[calc(100vw-1rem)] flex-col rounded-lg border border-border bg-card p-1 shadow-lg"
    >
      {!inspectingLink ? (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={t('editor.format.toolbar')}
          aria-keyshortcuts="Alt+F10"
          className="flex flex-wrap items-center gap-0.5"
          onKeyDownCapture={onToolbarKeyDown}
        >
          <TurnIntoMenu editor={editor} kind={state.kind} rovingProps={rovingProps('turnInto')} />
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          {buttons.map((button) => {
            const Icon = button.icon;
            return (
              <IconButton
                aria-pressed={button.active}
                className={iconButton(button.active)}
                {...rovingProps(button.labelKey)}
                key={button.labelKey}
                label={withShortcut(button.labelKey, button.shortcut)}
                onClick={button.run}
                onMouseDown={(event) => event.preventDefault()}
                size="icon-xs"
                type="button"
              >
                <Icon className="size-4" />
              </IconButton>
            );
          })}
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <IconButton
            aria-expanded={showLinkPanel}
            aria-pressed={state.link}
            className={iconButton(state.link)}
            {...rovingProps('link')}
            label={withShortcut('editor.format.link', 'K')}
            onClick={() => setLinkOpen((open) => !open)}
            onMouseDown={(event) => event.preventDefault()}
            size="icon-xs"
            type="button"
          >
            <LinkIcon className="size-4" />
          </IconButton>
          {onComment ? (
            <IconButton
              className={iconButton(false)}
              {...rovingProps('comment')}
              label={t('editor.comment')}
              onClick={comment}
              onMouseDown={(event) => event.preventDefault()}
              size="icon-xs"
              type="button"
            >
              <MessageSquarePlus className="size-4" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      {showLinkPanel ? <LinkEditorPanel editor={editor} initialUrl={state.href} onDone={() => setLinkOpen(false)} autoFocus={linkOpen} /> : null}
    </BubbleMenu>
  );
}

/**
 * "Turn into": the block type of the selection, as a menu of the common types.
 * The current type is the checked choice; choosing one keeps the selection and
 * returns focus to the text.
 */
function TurnIntoMenu({
  editor,
  kind,
  rovingProps,
}: {
  editor: Editor;
  kind: TurnIntoKind | null;
  /** The toolbar's roving tabindex for this control. */
  rovingProps: { 'data-toolbar-item': string; tabIndex: number; onFocus: () => void };
}) {
  const t = useT();
  const current = TURN_INTO_OPTIONS.find((option) => option.kind === kind);
  const CurrentIcon = current?.icon ?? Pilcrow;
  // Focus goes back to the text after a choice, and to the trigger otherwise.
  const chose = useRef(false);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) chose.current = false;
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            className="h-7 gap-1 px-1.5 text-foreground/80"
            {...rovingProps}
            size="xs"
            title={t('editor.format.turnInto')}
            type="button"
            variant="ghost"
          />
        }
      >
        {/* The visible type is part of the name, so speaking what is shown works. */}
        <span className="sr-only">{t('editor.format.turnInto')}: </span>
        <CurrentIcon aria-hidden className="size-4" />
        <span className="hidden max-w-24 truncate text-xs sm:inline">{current ? t(current.labelKey) : t('editor.format.turnInto')}</span>
        <ChevronDown aria-hidden className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        {...{ [MENU_POPUP_ATTRIBUTE]: '' }}
        aria-label={t('editor.format.turnInto')}
        className="w-44"
        finalFocus={() => !chose.current}
      >
        <DropdownMenuRadioGroup
          value={kind ?? ''}
          onValueChange={(value) => {
            chose.current = true;
            turnInto(editor, value as TurnIntoKind);
          }}
        >
          {TURN_INTO_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem closeOnClick key={option.kind} value={option.kind}>
                <Icon aria-hidden />
                {t(option.labelKey)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
