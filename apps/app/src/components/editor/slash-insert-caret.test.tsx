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

import { createSlashItems, isSlashMenuOpen } from './extensions/slash-command';
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

/** Type `/` and the block's own name, as a writer would; returns the name. */
const openSlashMenuFor = async (editor: Editor, titleKey: MessageKey) => {
  const title = translateFn(titleKey, undefined, uiLocale);
  await typeText(editor, `/${title}`);
  expect(isSlashMenuOpen(editor.state)).toBe(true);
  return title;
};

/** Click the option called `title` in the open slash menu. */
const chooseFromSlashMenu = async (editor: Editor, title: string) => {
  const option = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).find(
    (candidate) => candidate.querySelector('.font-medium')?.textContent === title,
  );
  if (!option) throw new Error(`"${title}" is not in the slash menu`);
  await act(async () => option.click());
  expect(isSlashMenuOpen(editor.state)).toBe(false);
};

/** Open the slash menu with the block's own name and pick it. */
const insertFromSlashMenu = async (editor: Editor, titleKey: MessageKey) => chooseFromSlashMenu(editor, await openSlashMenuFor(editor, titleKey));

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

/** The block a slash item inserts, read from its command through a recording chain. */
const scaffoldOf = (titleKey: MessageKey): JSONContent => {
  let inserted: JSONContent | undefined;
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ['focus', 'deleteRange', 'command']) chain[name] = () => chain;
  chain.insertContent = (content: unknown) => {
    inserted = content as JSONContent;
    return chain;
  };
  chain.run = () => true;
  const item = createSlashItems().find((candidate) => candidate.titleKey === titleKey);
  item?.command({ editor: { chain: () => chain } as unknown as Editor, range: { from: 1, to: 1 }, locale: 'en' });
  if (!inserted) throw new Error(`No scaffold for ${titleKey}`);
  return structuredClone(inserted);
};

/** A block of the same kind already on the page: item 1 says "KEEP FIRST", item 2 holds `secondItem`. */
const existingBlock = (block: BlockCase, secondItem = 'OLD 2'): JSONContent => {
  const value = scaffoldOf(block.titleKey);
  value.content = value.content?.map((item, index) => ({
    ...item,
    content: [paragraph(index === 0 ? 'KEEP FIRST' : index === 1 ? secondItem : `OLD ${index + 1}`)],
  }));
  return value;
};

/** Put the caret `offset` characters into the text node that reads exactly `text`. */
const caretInText = async (editor: Editor, text: string, offset: number) => {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) target = pos + offset;
  });
  if (target < 0) throw new Error(`No text "${text}"`);
  await act(async () => {
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)));
  });
};

/**
 * With a block of the same kind already on the page, insert `block` from the
 * slash menu and type straight away (review of #669). The text must land in
 * the NEW block's first item, nothing that was there before may change, and
 * once the typing is undone one more undo must restore the page exactly.
 */
const insertNextToExisting = async (block: BlockCase, content: JSONContent, placeCaret: (editor: Editor) => Promise<void>, dir: 'ltr' | 'rtl') => {
  const typed = 'HELLO';
  const editor = await make(content, dir);
  const textBefore = editor.state.doc.textContent;
  const existing = nodesOf(editor, block.block).length;
  await placeCaret(editor);
  const title = await openSlashMenuFor(editor, block.titleKey);
  const beforeInsert = editor.state.doc.toJSON();
  const markdownBeforeInsert = getMarkdown(editor);

  await chooseFromSlashMenu(editor, title);
  expect(nodesOf(editor, block.block)).toHaveLength(existing + 1);
  await typeText(editor, typed);

  // The typing is the first item of exactly one block: a new one, holding nothing that was there before.
  const fresh = nodesOf(editor, block.block).filter(({ node }) => node.child(0).textContent === typed);
  expect(fresh).toHaveLength(1);
  const [{ node, pos }] = fresh as [{ node: PMNode; pos: number }];
  expect(node.textContent).not.toMatch(/KEEP|OLD|before|after|Existing/);
  // Everything else on the page reads as it did before the slash command.
  expect(editor.state.tr.delete(pos, pos + node.nodeSize).doc.textContent).toBe(textBefore);
  expect(nodesOf(editor, block.block).filter(({ node: other }) => other.child(0).textContent === 'KEEP FIRST')).toHaveLength(existing);

  // Undo the typing, then one undo removes the new block and restores the page exactly.
  for (let guard = 0; guard < typed.length && editor.state.doc.textContent.includes(typed); guard += 1) editor.commands.undo();
  expect(editor.state.doc.textContent).not.toContain(typed);
  expect(nodesOf(editor, block.block)).toHaveLength(existing + 1);
  editor.commands.undo();
  expect(editor.state.doc.toJSON()).toEqual(beforeInsert);
  expect(getMarkdown(editor)).toBe(markdownBeforeInsert);
};

describe('inserting next to a block of the same kind keeps the old one intact', () => {
  // Tabs, Steps and 2 columns in both directions are the review's six repro cases.
  for (const dir of ['ltr', 'rtl'] as const) {
    describe(`inside its second item, mid-paragraph (${dir})`, () => {
      it.each(MULTI_ITEM_BLOCKS)('$name', async (block) => {
        uiLocale = dir === 'rtl' ? 'ar' : 'en';
        await insertNextToExisting(
          block,
          doc(existingBlock(block, 'before  after'), paragraph('AFTER')),
          (editor) => caretInText(editor, 'before  after', 'before '.length),
          dir,
        );
      });
    });
  }

  describe('with the old block directly before the insert point', () => {
    it.each(MULTI_ITEM_BLOCKS)('$name', async (block) => {
      await insertNextToExisting(block, doc(existingBlock(block), paragraph()), (editor) => caretIn(editor), 'ltr');
    });
  });

  describe('with the old block directly after the insert point', () => {
    it.each(MULTI_ITEM_BLOCKS)('$name', async (block) => {
      await insertNextToExisting(block, doc(paragraph(), existingBlock(block)), (editor) => caretIn(editor), 'ltr');
    });
  });

  describe('at the very start of a paragraph with text, inside the old block', () => {
    it.each(MULTI_ITEM_BLOCKS)('$name', async (block) => {
      await insertNextToExisting(block, doc(existingBlock(block, 'Existing text')), (editor) => caretInText(editor, 'Existing text', 0), 'ltr');
    });
  });

  describe('at the very end of a paragraph with text, inside the old block', () => {
    it.each(MULTI_ITEM_BLOCKS)('$name', async (block) => {
      await insertNextToExisting(
        block,
        doc(existingBlock(block, 'Existing text ')),
        (editor) => caretInText(editor, 'Existing text ', 'Existing text '.length),
        'ltr',
      );
    });
  });
});
