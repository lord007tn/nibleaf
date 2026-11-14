/** @vitest-environment jsdom */
/**
 * Where the caret lands after inserting a block made of several items (UX
 * audit P2-ED-004). Typing straight after inserting Tabs used to fill the
 * SECOND tab; the caret now starts in the first item's body, in every
 * multi-item block the slash menu inserts, at the top level and inside a list
 * item, a quote and a Note, left-to-right and right-to-left. One undo still
 * removes the whole block.
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
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

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

async function make(content: JSONContent, dir: 'ltr' | 'rtl') {
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

const hasAncestor = (editor: Editor, pos: number, type: string) => {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) if ($pos.node(depth).type.name === type) return true;
  return false;
};

/** Put the caret in the last empty paragraph inside a node of type `inside` (or the document). */
const caretIn = async (editor: Editor, inside?: string) => {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph' && node.content.size === 0 && (!inside || hasAncestor(editor, pos, inside))) target = pos + 1;
    return true;
  });
  if (target < 0) throw new Error(`No empty paragraph inside ${inside}`);
  await act(async () => {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
  });
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

const nodesOf = (editor: Editor, type: string) => {
  const found: { node: PMNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push({ node, pos });
  });
  return found;
};

/** Open the slash menu with the block's own name and pick it, as a writer would. */
const insertFromSlashMenu = async (editor: Editor, titleKey: MessageKey) => {
  const title = translateFn(titleKey, undefined, uiLocale);
  await typeText(editor, `/${title}`);
  expect(isSlashMenuOpen(editor.state)).toBe(true);
  const option = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).find(
    (candidate) => candidate.querySelector('.font-medium')?.textContent === title,
  );
  if (!option) throw new Error(`"${title}" is not in the slash menu`);
  await act(async () => option.click());
  expect(isSlashMenuOpen(editor.state)).toBe(false);
};

/** `open`/`close` delimit the first item in the saved Markdown. */
type BlockCase = { name: string; titleKey: MessageKey; block: string; items: number; open: string; close: string };

const MULTI_ITEM_BLOCKS: BlockCase[] = [
  { name: 'Tabs', titleKey: 'editor.slash.tabs.title', block: 'mdxTabs', items: 2, open: '<Tab ', close: '</Tab>' },
  { name: 'Steps', titleKey: 'editor.slash.steps.title', block: 'mdxSteps', items: 2, open: '<Step ', close: '</Step>' },
  { name: 'Accordion', titleKey: 'editor.slash.accordion.title', block: 'mdxAccordionGroup', items: 2, open: '<Accordion ', close: '</Accordion>' },
  { name: 'Card group', titleKey: 'editor.slash.cardGroup.title', block: 'mdxCardGroup', items: 2, open: '<Card ', close: '</Card>' },
  { name: '3-card grid', titleKey: 'editor.slash.cardGrid3.title', block: 'mdxCardGroup', items: 3, open: '<Card ', close: '</Card>' },
  { name: '4-card grid', titleKey: 'editor.slash.cardGrid4.title', block: 'mdxCardGroup', items: 4, open: '<Card ', close: '</Card>' },
  { name: '2 columns', titleKey: 'editor.slash.columns2.title', block: 'mdxColumns', items: 2, open: '<Column>', close: '</Column>' },
  { name: '3 columns', titleKey: 'editor.slash.columns3.title', block: 'mdxColumns', items: 3, open: '<Column>', close: '</Column>' },
  { name: '4 columns', titleKey: 'editor.slash.columns4.title', block: 'mdxColumns', items: 4, open: '<Column>', close: '</Column>' },
  {
    name: 'API example',
    titleKey: 'editor.slash.apiExample.title',
    block: 'mdxApiExample',
    items: 2,
    open: '<RequestExample',
    close: '</RequestExample>',
  },
];

/** Blocks inserted with a single item: the caret was already in it on main; kept there. */
const SINGLE_ITEM_BLOCKS: BlockCase[] = [
  { name: 'Code group', titleKey: 'editor.slash.codeGroup.title', block: 'mdxCodeGroup', items: 1, open: '<CodeGroup>', close: '</CodeGroup>' },
  {
    name: 'Related content',
    titleKey: 'editor.slash.relatedContent.title',
    block: 'mdxRelatedContent',
    items: 1,
    open: '<RelatedCard',
    close: '</RelatedCard>',
  },
];

const CONTAINERS: { name: string; content: JSONContent; container?: string }[] = [
  { name: 'at the top level', content: doc(paragraph()) },
  {
    name: 'inside a list item',
    content: doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Install'), paragraph()] }] }),
    container: 'listItem',
  },
  { name: 'inside a quote', content: doc({ type: 'blockquote', content: [paragraph('Quoted'), paragraph()] }), container: 'blockquote' },
  { name: 'inside a Note', content: doc({ type: 'callout', attrs: { variant: 'note' }, content: [paragraph()] }), container: 'callout' },
];

/**
 * Insert `block` from the slash menu, type `typed` straight away, and check it
 * went into the first item; then undo the typing and check one more undo
 * removes the whole block, leaving the document exactly as before the insert.
 */
const insertTypeAndUndo = async (
  { titleKey, block, items, open, close }: BlockCase,
  content: JSONContent,
  container: string | undefined,
  typed: string,
  dir: 'ltr' | 'rtl',
) => {
  const editor = await make(content, dir);
  await caretIn(editor, container);

  await insertFromSlashMenu(editor, titleKey);
  const beforeTyping = nodesOf(editor, block);
  expect(beforeTyping).toHaveLength(1);
  expect(beforeTyping[0]?.node.childCount).toBe(items);
  if (container) expect(hasAncestor(editor, (beforeTyping[0]?.pos ?? 0) + 1, container)).toBe(true);

  await typeText(editor, typed);
  const [inserted] = nodesOf(editor, block);
  if (!inserted) throw new Error(`${block} disappeared`);
  // Whatever scaffold text the first item had is replaced; no other item is touched.
  expect(inserted.node.child(0).textContent).toBe(typed);
  for (let index = 1; index < inserted.node.childCount; index += 1) expect(inserted.node.child(index).textContent).not.toContain(typed);

  // In the saved Markdown, the text sits inside the first item, before that item closes.
  const markdown = getMarkdown(editor);
  expect(markdown.split(typed)).toHaveLength(2);
  expect(markdown.indexOf(open)).toBeGreaterThanOrEqual(0);
  expect(markdown.indexOf(open)).toBeLessThan(markdown.indexOf(typed));
  expect(markdown.indexOf(typed)).toBeLessThan(markdown.indexOf(close));

  // Undo the typing (however many steps it took), then one undo removes the block.
  for (let guard = 0; guard < typed.length && editor.state.doc.textContent.includes(typed); guard += 1) editor.commands.undo();
  expect(editor.state.doc.textContent).not.toContain(typed);
  expect(nodesOf(editor, block)).toHaveLength(1);
  editor.commands.undo();
  expect(nodesOf(editor, block)).toHaveLength(0);
  expect(editor.state.doc.textContent).toContain(`/${translateFn(titleKey, undefined, uiLocale)}`);
};

describe('typing right after inserting a multi-item block (P2-ED-004)', () => {
  for (const { name: where, content, container } of CONTAINERS) {
    describe(where, () => {
      it.each(MULTI_ITEM_BLOCKS)('$name: the text goes into the first item, and one undo removes the block', async (block) => {
        await insertTypeAndUndo(block, content, container, 'hello', 'ltr');
      });
    });
  }

  describe('in an Arabic, right-to-left editor', () => {
    it.each(MULTI_ITEM_BLOCKS)('$name: the text goes into the first item, and one undo removes the block', async (block) => {
      uiLocale = 'ar';
      await insertTypeAndUndo(block, doc(paragraph()), undefined, 'مرحبا', 'rtl');
    });
  });
});

describe('single-item blocks keep the caret in their only item', () => {
  it.each(SINGLE_ITEM_BLOCKS)('$name', async (block) => {
    await insertTypeAndUndo(block, doc(paragraph()), undefined, 'hello', 'ltr');
  });
});
