/** @vitest-environment jsdom */
/**
 * The slash menu in a real editor (UX audit P1-ED-003): multi-word names
 * insert their block, also inside Tabs, a Note, Steps and a list; the menu is
 * grouped under headings; arrows cross sections; Escape and stray text close it.
 */

import { type Locale, type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dashboard language the menu is shown in.
let uiLocale: Locale = 'en';
const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, uiLocale);
vi.mock('@nibleaf/i18n/react', async (original) => ({
  ...(await original<object>()),
  useT: () => translate,
  useLocale: () => ({ locale: uiLocale, t: translate, setLocale: () => undefined }),
}));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
vi.mock('@/hooks/api', () => ({ useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }), usePages: () => ({ data: [] }) }));

import { isSlashMenuOpen } from './extensions/slash-command';
import { buildEditorExtensions } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const editors: Editor[] = [];
const roots: Root[] = [];
beforeEach(() => {
  uiLocale = 'en';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

async function make(content: JSONContent, dir: 'ltr' | 'rtl' = 'ltr') {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }) });
  editors.push(editor);
  editor.commands.setContent(content, { emitUpdate: false });
  const host = document.createElement('div');
  host.dir = dir;
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(EditorContent, { editor })));
  return editor;
}

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const paragraph = (text = ''): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });

/** Put the caret at the end of the last empty paragraph inside a node of type `inside` (or the document). */
const caretIn = async (editor: Editor, inside?: string) => {
  let target = -1;
  editor.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && (!inside || hasAncestor(editor, pos, inside)) && parent) target = pos + 1 + node.content.size;
    return true;
  });
  if (target < 0) throw new Error(`No paragraph inside ${inside}`);
  await act(async () => {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
  });
};
const hasAncestor = (editor: Editor, pos: number, type: string) => {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) if ($pos.node(depth).type.name === type) return true;
  return false;
};

/** Type like a writer: one character per transaction, through the editor's text input path. */
const typeText = async (editor: Editor, text: string) => {
  for (const char of text) {
    await act(async () => {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp('handleTextInput', (handler) => handler(editor.view, from, to, char, () => editor.state.tr));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    });
  }
  // The menu positions itself on the next frame.
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
};
const press = async (editor: Editor, key: string) =>
  act(async () => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

const menu = () => document.querySelector<HTMLElement>('[cmdk-root]');
const headings = () => Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((heading) => heading.textContent);
const optionTitles = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).map((option) => option.querySelector('.font-medium')?.textContent ?? '');
const activeOption = () => document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
const en = (key: MessageKey) => translateFn(key, undefined, 'en');
const ar = (key: MessageKey) => translateFn(key, undefined, 'ar');

const nodesOf = (editor: Editor, type: string) => {
  const found: { node: PMNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push({ node, pos });
  });
  return found;
};

describe('inserting a block by its full name', () => {
  it('"/code block" + Enter inserts a code block and leaves no query text', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/code block');
    expect(isSlashMenuOpen(editor.state)).toBe(true);
    expect(optionTitles()[0]).toBe(en('editor.slash.codeBlock.title'));
    await press(editor, 'Enter');
    expect(nodesOf(editor, 'codeBlock')).toHaveLength(1);
    expect(editor.state.doc.textContent).not.toContain('/code');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
    expect(menu()).toBeNull();
  });

  it('"/code" + Enter inserts a code block, not a code group', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/code');
    await press(editor, 'Enter');
    expect(nodesOf(editor, 'codeBlock')).toHaveLength(1);
    expect(nodesOf(editor, 'mdxCodeGroup')).toHaveLength(0);
  });

  it.each([
    ['Tabs', doc({ type: 'mdxTabs', content: [{ type: 'mdxTab', attrs: { title: 'First' }, content: [paragraph()] }] }), 'mdxTab'],
    ['a Note', doc({ type: 'callout', attrs: { variant: 'note' }, content: [paragraph()] }), 'callout'],
    ['Steps', doc({ type: 'mdxSteps', content: [{ type: 'mdxStep', attrs: { title: 'First' }, content: [paragraph()] }] }), 'mdxStep'],
    ['a list item', doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Install'), paragraph()] }] }), 'listItem'],
  ])('works the same inside %s', async (_name, content, container) => {
    const editor = await make(content);
    await caretIn(editor, container);
    await typeText(editor, '/code block');
    expect(optionTitles()[0]).toBe(en('editor.slash.codeBlock.title'));
    await press(editor, 'Enter');
    const blocks = nodesOf(editor, 'codeBlock');
    expect(blocks).toHaveLength(1);
    expect(hasAncestor(editor, (blocks[0]?.pos ?? 0) + 1, container)).toBe(true);
    expect(editor.state.doc.textContent).not.toContain('/code');
  });

  it('finds Arabic names in an Arabic, right-to-left menu', async () => {
    uiLocale = 'ar';
    const editor = await make(doc(paragraph()), 'rtl');
    await caretIn(editor);
    await typeText(editor, `/${ar('editor.slash.codeBlock.title')}`);
    expect(menu()?.getAttribute('dir')).toBe('rtl');
    expect(optionTitles()[0]).toBe(ar('editor.slash.codeBlock.title'));
    await press(editor, 'Enter');
    expect(nodesOf(editor, 'codeBlock')).toHaveLength(1);
  });
});

describe('the grouped menu', () => {
  it('opens on "Suggested", then the named sections, as listbox groups', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/');
    expect(headings()).toEqual(
      (
        [
          'editor.slash.section.suggested',
          'editor.slash.basicBlocks',
          'editor.slash.section.callouts',
          'editor.slash.section.media',
          'editor.slash.section.layout',
          'editor.slash.section.api',
          'editor.slash.section.inline',
        ] as const
      ).map(en),
    );
    expect(optionTitles().slice(0, 6)).toEqual(
      (['text', 'h1', 'h2', 'h3', 'bulletList', 'numberedList'] as const).map((name) => en(`editor.slash.${name}.title`)),
    );
    // Each block is listed once, and all 50 are there.
    expect(optionTitles()).toHaveLength(50);
    expect(new Set(optionTitles()).size).toBe(50);
    // Screen readers: one listbox, options inside groups named by their heading.
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute('aria-label')).toBe(en('editor.insertBlock'));
    const group = listbox?.querySelector('[role="group"]');
    const heading = group?.getAttribute('aria-labelledby') ? document.getElementById(group.getAttribute('aria-labelledby') ?? '') : null;
    expect(heading?.textContent).toBe(en('editor.slash.section.suggested'));
    expect(group?.querySelectorAll('[role="option"]')).toHaveLength(6);
  });

  it('while searching, keeps headings and puts the best match first', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/code');
    // Sections follow their best match; Embed comes last through its "codepen" keyword.
    expect(headings()).toEqual([en('editor.slash.basicBlocks'), en('editor.slash.section.api'), en('editor.slash.section.media')]);
    expect(optionTitles().at(-1)).toBe(en('editor.slash.embed.title'));
    expect(optionTitles().slice(0, 2)).toEqual([en('editor.slash.codeBlock.title'), en('editor.slash.codeGroup.title')]);
  });

  it('moves the highlight across section boundaries with the arrow keys, PageDown and End', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/');
    const title = () => activeOption()?.querySelector('.font-medium')?.textContent;
    const group = () => activeOption()?.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.textContent;
    expect(title()).toBe(en('editor.slash.text.title'));
    for (let step = 0; step < 6; step += 1) await press(editor, 'ArrowDown');
    // The seventh option is the first of Basic blocks, past the six suggestions.
    expect(group()).toBe(en('editor.slash.basicBlocks'));
    expect(title()).toBe(en('editor.slash.todo.title'));
    // The active option is announced: the editor (which keeps focus) points at it.
    expect(editor.view.dom.getAttribute('aria-activedescendant')).toBe(activeOption()?.id);
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(document.querySelector('[role="listbox"]')?.id);
    await press(editor, 'ArrowUp');
    expect(group()).toBe(en('editor.slash.section.suggested'));
    await press(editor, 'PageDown');
    await press(editor, 'PageDown');
    expect(group()).toBe(en('editor.slash.section.callouts'));
    expect(title()).toBe(en('editor.slash.note.title'));
    await press(editor, 'End');
    expect(group()).toBe(en('editor.slash.section.inline'));
    await press(editor, 'ArrowDown');
    expect(title()).toBe(en('editor.slash.text.title'));
    await press(editor, 'Enter');
    expect(editor.state.doc.textContent).toBe('');
    expect(menu()).toBeNull();
    expect(editor.view.dom.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('inserts the clicked block', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/table');
    const option = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).find(
      (candidate) => candidate.querySelector('.font-medium')?.textContent === en('editor.slash.table.title'),
    );
    await act(async () => option?.click());
    expect(nodesOf(editor, 'table')).toHaveLength(1);
  });
});

describe('closing the menu', () => {
  it('closes on Escape and stays closed while the writer keeps typing', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/code');
    expect(menu()).not.toBeNull();
    await press(editor, 'Escape');
    expect(menu()).toBeNull();
    await typeText(editor, ' block');
    expect(menu()).toBeNull();
    expect(editor.state.doc.textContent).toBe('/code block');
  });

  it('closes on a double space', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/code ');
    expect(isSlashMenuOpen(editor.state)).toBe(true);
    await typeText(editor, ' ');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
    expect(menu()).toBeNull();
  });

  it('does not trap prose typed after a slash: a space after a word that matches nothing closes it', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, '/xyz');
    expect(menu()?.textContent).toContain(en('editor.slash.empty'));
    await typeText(editor, ' and more');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
    await press(editor, 'Enter');
    // Enter is the editor's again: a new paragraph, nothing inserted.
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.textContent).toBe('/xyz and more');
  });

  it('closes when a space follows the slash, as in "yes / no"', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await typeText(editor, 'yes / no');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
  });
});
