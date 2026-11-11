/** @vitest-environment jsdom */
/**
 * A writer's journey through the selection menu, with the real editor and the
 * real command palette mounted together:
 * - AUTH-10: Ctrl/⌘+K in the page adds or edits a link; outside it, the palette opens.
 * - AUTH-37: the menu can turn a block into another type and start a comment.
 */

import { type Locale, type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import type { Editor } from '@tiptap/core';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en' as Locale }));
const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, mocks.locale);
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => translate }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: { matches: Array<{ params: unknown }> }) => unknown }) => select({ matches: [{ params: {} }] }),
}));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }),
  usePages: () => ({ data: [{ id: 'start', kind: 'PAGE', title: 'Getting started', path: 'getting-started' }] }),
  useOrganizationSwitcherProjects: () => ({ data: [] }),
  useSwitcher: () => ({ data: { organizations: [] } }),
}));
vi.mock('../app/org-switcher/switcher-context', () => ({
  useSwitcherControls: () => ({ current: { organizationId: 'org-1' }, openSwitcher: vi.fn(), openCreateOrganization: vi.fn() }),
}));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageDialog: () => null }));

import { CommandPalette } from '../app/command-palette';
import type { CommentAnchor } from './editor-bubble-menu';
import { getMarkdown, TiptapEditor } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = [];

beforeEach(() => {
  mocks.locale = 'en';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  // The bubble menu positions itself from the selection's rectangle.
  const rect = new DOMRect(0, 0, 100, 20);
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect });
});

afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  document.body.replaceChildren();
});

const settle = () =>
  act(async () => {
    await Promise.resolve();
    await vi.dynamicImportSettled();
  });

async function mount(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(element));
  await settle();
  const prose = container.querySelector<HTMLElement & { editor: Editor }>('.ProseMirror');
  if (!prose) throw new Error('No editor');
  return { container, prose, editor: prose.editor };
}

/** The writer's page, with the app's command palette mounted beside it. */
async function mountPage({ value = 'See the guide for details', dir = 'ltr' as 'ltr' | 'rtl', editable = true, comments = true } = {}) {
  const onAddComment = vi.fn<(anchor: CommentAnchor) => void>();
  const onPaletteChange = vi.fn();
  const page = await mount(
    <>
      <CommandPalette open={false} onOpenChange={onPaletteChange} />
      <input aria-label="Search outside the page" />
      <TiptapEditor dir={dir} editable={editable} onAddComment={comments ? onAddComment : undefined} onChange={vi.fn()} value={value} />
    </>,
  );
  return { ...page, onPaletteChange, onAddComment };
}

/** Polls between act() turns, so the bubble plugin's timers and React's updates
 *  both run while waiting. */
async function waitFor(assertion: () => void, timeout = 2000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

const textMenu = () => document.querySelector<HTMLElement>('[data-editor-bubble-menu]');
const toolbar = () => textMenu()?.querySelector<HTMLElement>('[role="toolbar"]') ?? null;
const linkField = () => textMenu()?.querySelector<HTMLInputElement>('input[role="combobox"]') ?? null;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.getAttribute('aria-label') === name);
const turnIntoTrigger = () => toolbar()?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null;

/** Select `text` the way a writer would, with the page focused. */
async function select(editor: Editor, text: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText && node.text?.includes(text)) from = pos + (node.text.indexOf(text) ?? 0);
  });
  if (from < 0) throw new Error(`"${text}" is not on the page`);
  await act(async () => {
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to: from + text.length })
      .run();
  });
  await waitFor(() => expect(textMenu()).not.toBeNull());
  await editorFocused(editor);
}

/** TipTap focuses the page in an animation frame; a writer's next key comes after it. */
async function editorFocused(editor: Editor) {
  await waitFor(() => expect(editor.view.dom.contains(document.activeElement)).toBe(true));
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });
}

async function key(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

const linkHref = (editor: Editor) => {
  let href: string | undefined;
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((candidate) => candidate.type.name === 'link');
    if (mark) href ??= mark.attrs.href as string;
  });
  return href;
};

const selectedText = (editor: Editor) => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to);

describe('Ctrl/⌘+K in the page adds a link (AUTH-10)', () => {
  it('opens the link field for the selection, not the command palette', async () => {
    const { editor, prose, onPaletteChange } = await mountPage();
    await select(editor, 'guide');

    const event = await key(prose, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(linkField()));

    expect(onPaletteChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(selectedText(editor)).toBe('guide');

    // The writer types an address and presses Enter, never leaving the keyboard.
    const field = linkField() as HTMLInputElement;
    await typeInto(field, 'example.com/guide');
    await key(field, { key: 'Enter' });
    expect(linkHref(editor)).toBe('https://example.com/guide');
    expect(getMarkdown(editor)).toContain('[guide](https://example.com/guide)');
    // Focus is back in the page.
    await waitFor(() => expect(prose.contains(document.activeElement)).toBe(true));
  });

  it('with only a caret, links the word under it', async () => {
    const { editor, prose, onPaletteChange } = await mountPage();
    await act(async () => {
      editor.chain().focus().setTextSelection(10).run();
    });
    await editorFocused(editor);

    await key(prose, { key: 'k', metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(linkField()));
    expect(selectedText(editor)).toBe('guide');
    expect(onPaletteChange).not.toHaveBeenCalled();
  });

  it('edits the link under the caret, prefilled with its address', async () => {
    const { editor, prose } = await mountPage({ value: 'Read [the guide](https://old.example.com) first' });
    await act(async () => {
      editor.chain().focus().setTextSelection(10).run();
    });
    await editorFocused(editor);

    await key(prose, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(linkField()));
    const field = linkField() as HTMLInputElement;
    expect(field.value).toBe('https://old.example.com');

    await typeInto(field, 'https://new.example.com');
    await key(field, { key: 'Enter' });
    expect(getMarkdown(editor)).toContain('[the guide](https://new.example.com)');
    expect(getMarkdown(editor)).not.toContain('old.example.com');
  });

  it('leaves the key to an IME composition', async () => {
    const { editor, prose, onPaletteChange } = await mountPage();
    await select(editor, 'guide');

    const event = await key(prose, { key: 'k', ctrlKey: true, isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onPaletteChange).not.toHaveBeenCalled();
    expect(linkField()).toBeNull();
  });

  it('outside the page, the same key still opens the command palette', async () => {
    const { container, onPaletteChange } = await mountPage();
    const outside = container.querySelector('input[aria-label="Search outside the page"]') as HTMLInputElement;

    await key(outside, { key: 'k', ctrlKey: true });

    expect(onPaletteChange).toHaveBeenCalledWith(true);
    expect(linkField()).toBeNull();
  });

  it('on a read-only page (Viewers), the key opens the command palette', async () => {
    const { prose, onPaletteChange } = await mountPage({ editable: false });
    expect(prose.getAttribute('contenteditable')).toBe('false');

    await key(prose, { key: 'k', ctrlKey: true });

    expect(onPaletteChange).toHaveBeenCalledWith(true);
  });
});

describe('Turn into (AUTH-37)', () => {
  const chooseTurnInto = async (label: string) => {
    const trigger = turnIntoTrigger() as HTMLButtonElement;
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) => node.textContent?.trim() === label);
    if (!item) throw new Error(`No "${label}" choice`);
    await act(async () => {
      item.click();
    });
    await settle();
  };

  const checkedChoice = async () => {
    await act(async () => {
      turnIntoTrigger()?.focus();
      turnIntoTrigger()?.click();
    });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const checked = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .filter((node) => node.getAttribute('aria-checked') === 'true')
      .map((node) => node.textContent?.trim());
    await key(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    return checked;
  };

  it.each([
    ['Heading 2', '## Install the app'],
    ['Heading 3', '### Install the app'],
    ['Bullet list', '- Install the app'],
    ['Numbered list', '1. Install the app'],
    ['Quote', '> Install the app'],
  ])('turns a paragraph into %s and back, keeping the selection and focus', async (label, markdown) => {
    const { editor, prose } = await mountPage({ value: 'Install the app\n\nThen sign in' });
    await select(editor, 'the app');
    expect(await checkedChoice()).toEqual(['Text']);
    expect(turnIntoTrigger()?.textContent).toContain('Text');

    await chooseTurnInto(label);
    expect(getMarkdown(editor).split('\n')[0]).toBe(markdown);
    expect(getMarkdown(editor)).toContain('Then sign in');
    expect(selectedText(editor)).toBe('the app');
    await waitFor(() => expect(prose.contains(document.activeElement)).toBe(true));
    expect(turnIntoTrigger()?.textContent).toContain(label);
    expect(await checkedChoice()).toEqual([label]);

    await chooseTurnInto('Text');
    expect(getMarkdown(editor)).toBe('Install the app\n\nThen sign in');
    expect(selectedText(editor)).toBe('the app');
    await waitFor(() => expect(prose.contains(document.activeElement)).toBe(true));
  });

  it('switches a bulleted list to a numbered one in place', async () => {
    const { editor } = await mountPage({ value: '- One\n- Two' });
    await select(editor, 'Two');
    await chooseTurnInto('Numbered list');
    expect(getMarkdown(editor)).toBe('1. One\n2. Two');
  });

  it('is a menu button whose menu is labelled and lists the six types', async () => {
    const { editor, prose } = await mountPage();
    await select(editor, 'guide');
    const trigger = turnIntoTrigger() as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // Its name says what it does and what the block is now.
    expect(trigger.textContent).toContain('Turn into');
    expect(trigger.textContent).toContain('Text');

    // From the text, Alt+F10 reaches the toolbar; Turn into comes first.
    await key(prose, { key: 'F10', altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await key(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu.getAttribute('aria-label')).toBe('Turn into');
    expect([...menu.querySelectorAll('[role="menuitemradio"]')].map((node) => node.textContent?.trim())).toEqual([
      'Text',
      'Heading 2',
      'Heading 3',
      'Bullet list',
      'Numbered list',
      'Quote',
    ]);

    // Escape closes the menu and gives focus back to its button.
    await key(document.activeElement ?? menu, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    // Choosing with the keyboard applies the type and returns to the text.
    await key(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio'));
    const heading = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) => node.textContent?.trim() === 'Heading 2');
    await act(async () => heading?.focus());
    await key(heading as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(getMarkdown(editor)).toBe('## See the guide for details'));
    await waitFor(() => expect(prose.contains(document.activeElement)).toBe(true));
    expect(selectedText(editor)).toBe('guide');
  });
});

describe('Comment from the selection menu (AUTH-37)', () => {
  it('starts the comment flow with the selected passage', async () => {
    const { editor, onAddComment } = await mountPage();
    await select(editor, 'the guide');

    const comment = button('Comment') as HTMLButtonElement;
    expect(comment).toBeDefined();
    await act(async () => {
      comment.click();
    });

    const { from, to } = editor.state.selection;
    expect(onAddComment).toHaveBeenCalledWith({ quote: 'the guide', from, to });
    // The writer continues in the composer; the menu steps aside until they return.
    await waitFor(() => expect(textMenu()).toBeNull());
  });

  it('is not offered where comments are unavailable', async () => {
    const { editor } = await mountPage({ comments: false });
    await select(editor, 'guide');
    expect(button('Bold (Ctrl+B)')).toBeDefined();
    expect(button('Comment')).toBeUndefined();
  });

  it('is not offered to Viewers: a read-only page has no selection menu', async () => {
    const { editor, prose } = await mountPage({ editable: false });
    await act(async () => {
      editor.commands.setTextSelection({ from: 5, to: 14 });
    });
    await settle();
    expect(prose.getAttribute('contenteditable')).toBe('false');
    expect(textMenu()).toBeNull();
    expect(button('Comment')).toBeUndefined();
  });
});

describe('selection menu keyboard and ARIA', () => {
  it('is a labelled toolbar reached with Alt+F10, moved through with the arrow keys, and left with Escape', async () => {
    const { editor, prose } = await mountPage();
    await select(editor, 'guide');
    const bar = toolbar() as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('Text formatting');
    expect(bar.getAttribute('aria-keyshortcuts')).toBe('Alt+F10');

    await key(prose, { key: 'F10', altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(turnIntoTrigger()));

    const names = () => document.activeElement?.getAttribute('aria-label');
    await key(document.activeElement as Element, { key: 'ArrowRight' });
    expect(names()).toBe('Bold (Ctrl+B)');
    await key(document.activeElement as Element, { key: 'End' });
    expect(names()).toBe('Comment');
    await key(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(turnIntoTrigger());
    await key(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(names()).toBe('Comment');
    await key(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement).toBe(turnIntoTrigger());

    await key(document.activeElement as Element, { key: 'Escape' });
    await waitFor(() => expect(prose.contains(document.activeElement)).toBe(true));
    expect(selectedText(editor)).toBe('guide');
  });

  it('mirrors the arrow keys in an Arabic page and labels everything in Arabic', async () => {
    mocks.locale = 'ar';
    const { editor, prose } = await mountPage({ dir: 'rtl', value: 'اقرأ الدليل أولا' });
    await select(editor, 'الدليل');
    expect(toolbar()?.getAttribute('aria-label')).toBe(translateFn('editor.format.toolbar', undefined, 'ar'));
    expect(turnIntoTrigger()?.textContent).toContain(translateFn('editor.format.turnInto', undefined, 'ar'));
    expect(button(translateFn('editor.comment', undefined, 'ar'))).toBeDefined();

    await key(prose, { key: 'F10', altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(turnIntoTrigger()));
    // In RTL the next control is to the left.
    await key(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`${translateFn('editor.format.bold', undefined, 'ar')} (Ctrl+B)`);
  });

  it('marks pressed formatting and exposes each control by a localized name', async () => {
    const { editor } = await mountPage({ value: 'See **the guide** today' });
    await select(editor, 'the guide');
    expect(button('Bold (Ctrl+B)')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Italic (Ctrl+I)')?.getAttribute('aria-pressed')).toBe('false');
    expect(button('Link (Ctrl+K)')?.getAttribute('aria-expanded')).toBe('false');
    for (const control of toolbar()?.querySelectorAll('button') ?? []) {
      expect(control.getAttribute('aria-label') ?? control.textContent?.trim()).toBeTruthy();
    }
  });
});
