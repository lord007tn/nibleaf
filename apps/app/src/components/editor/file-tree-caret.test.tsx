/** @vitest-environment jsdom */
/**
 * #670: inserting a File tree from the slash menu leaves the caret in its
 * first file's name, so typing names the file. A File's name used to be an
 * attribute field with no place for the caret; it is now the File's text,
 * kept equal to its `name` attribute, so the saved Markdown is the same
 * `<File name="…" />` as before. One undo removes the inserted tree.
 */

import { type Locale, type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { Editor, type JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function make(content: JSONContent | string, dir: 'ltr' | 'rtl' = 'ltr') {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }) });
  editors.push(editor);
  editor.commands.setContent(content, { emitUpdate: false });
  // Loading the page is not something to undo into: the writer's own changes start here.
  editor.view.dispatch(closeHistory(editor.state.tr));
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

/** Press a key on the page, as ProseMirror receives it. */
const press = async (editor: Editor, key: string) => {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event));
  });
};

const nodesOf = (editor: Editor, type: string) => {
  const found: { node: PMNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push({ node, pos });
  });
  return found;
};
const fileNames = (editor: Editor) => nodesOf(editor, 'mdxFile').map(({ node }) => ({ text: node.textContent, name: node.attrs.name as string }));

/** Type `/` and File tree's own name, and pick it from the menu, as a writer would; `beforeInsert` is the page just before the pick. */
const insertFileTree = async (editor: Editor) => {
  const title = translateFn('editor.slash.fileTree.title', undefined, uiLocale);
  await typeText(editor, `/${title}`);
  expect(isSlashMenuOpen(editor.state)).toBe(true);
  beforeInsert = editor.state.doc.toJSON();
  const option = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).find(
    (candidate) => candidate.querySelector('.font-medium')?.textContent === title,
  );
  if (!option) throw new Error(`"${title}" is not in the slash menu`);
  await act(async () => option.click());
  expect(isSlashMenuOpen(editor.state)).toBe(false);
  return title;
};

let beforeInsert: unknown;

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

describe('#670: typing right after inserting a File tree names its first file', () => {
  it.each(CONTAINERS)('$name: the caret is in the first file’s name; the typed name is saved as its name', async ({ content, container }) => {
    const editor = await make(content);
    await caretIn(editor, container);
    const title = await insertFileTree(editor);

    // The caret is in the (empty) name of the tree's only file.
    const [tree] = nodesOf(editor, 'mdxFileTree');
    if (!tree) throw new Error('No File tree');
    if (container) expect(hasAncestor(editor, tree.pos + 1, container)).toBe(true);
    const { $from, empty } = editor.state.selection;
    expect(empty).toBe(true);
    expect($from.parent.type.name).toBe('mdxFile');
    expect($from.node(-1)).toBe(tree.node);

    await typeText(editor, 'index.ts');
    expect(fileNames(editor)).toEqual([{ text: 'index.ts', name: 'index.ts' }]);
    // Saved as before: the name is the tag's attribute, and the Markdown reads back to the same name.
    const markdown = getMarkdown(editor);
    expect(markdown).toContain('<File name="index.ts" />');
    expect(markdown).not.toContain(`/${title}`);
    const reread = await make(markdown);
    expect(fileNames(reread)).toEqual([{ text: 'index.ts', name: 'index.ts' }]);
    expect(getMarkdown(reread)).toBe(markdown);

    // Undo the typing (however many steps it took); then one undo removes the tree and restores the page.
    for (let guard = 0; guard < 'index.ts'.length && nodesOf(editor, 'mdxFile')[0]?.node.textContent; guard += 1) editor.commands.undo();
    expect(fileNames(editor)).toEqual([{ text: '', name: '' }]);
    editor.commands.undo();
    expect(nodesOf(editor, 'mdxFileTree')).toHaveLength(0);
    expect(editor.state.doc.textContent).toContain(`/${title}`);
    expect(editor.state.doc.toJSON()).toEqual(beforeInsert);
  });

  it('one undo straight after the insert removes the whole tree', async () => {
    const editor = await make(doc(paragraph('Intro'), paragraph()));
    await caretIn(editor);
    const title = await insertFileTree(editor);
    expect(nodesOf(editor, 'mdxFileTree')).toHaveLength(1);
    editor.commands.undo();
    expect(nodesOf(editor, 'mdxFileTree')).toHaveLength(0);
    expect(nodesOf(editor, 'mdxFile')).toHaveLength(0);
    expect(editor.state.doc.textContent).toBe(`Intro/${title}`);
    expect(editor.state.doc.toJSON()).toEqual(beforeInsert);
  });

  it('in an Arabic, right-to-left editor: an Arabic name, read in its own direction', async () => {
    uiLocale = 'ar';
    const editor = await make(doc(paragraph()), 'rtl');
    await caretIn(editor);
    await insertFileTree(editor);
    await typeText(editor, 'دليل.md');
    expect(fileNames(editor)).toEqual([{ text: 'دليل.md', name: 'دليل.md' }]);
    expect(getMarkdown(editor)).toContain('<File name="دليل.md" />');
    // The name decides its own direction (an Arabic name right to left, `src/index.ts` left to right), whatever the interface.
    const name = document.querySelector('.pl-file-name');
    expect(name?.getAttribute('dir')).toBe('auto');
    expect(name?.textContent).toBe('دليل.md');
    expect(name?.getAttribute('data-placeholder')).toBe(translateFn('editor.block.namePlaceholder', undefined, 'ar'));
  });

  it('an empty name shows its placeholder, and only while empty', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await insertFileTree(editor);
    const name = () => document.querySelector('.pl-file-name');
    expect(name()?.classList.contains('is-empty')).toBe(true);
    expect(name()?.getAttribute('data-placeholder')).toBe(translateFn('editor.block.namePlaceholder', undefined, 'en'));
    await typeText(editor, 'a');
    expect(name()?.classList.contains('is-empty')).toBe(false);
  });
});

describe('#670: the keyboard in a file’s name', () => {
  it('Enter starts the next file; Enter in an empty last file leaves the tree for a paragraph', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await insertFileTree(editor);
    await typeText(editor, 'package.json');
    await press(editor, 'Enter');
    expect(editor.state.selection.$from.parent.type.name).toBe('mdxFile');
    await typeText(editor, 'README.md');
    expect(fileNames(editor)).toEqual([
      { text: 'package.json', name: 'package.json' },
      { text: 'README.md', name: 'README.md' },
    ]);
    // A new file is its own tag, not a copy of the one before it.
    expect(nodesOf(editor, 'mdxFile')[1]?.node.attrs.sourceOpen).toBe('');

    await press(editor, 'Enter');
    expect(fileNames(editor)).toHaveLength(3);
    await press(editor, 'Enter');
    // The empty third file is gone; the caret is in a paragraph after the tree.
    expect(fileNames(editor)).toHaveLength(2);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('paragraph');
    expect(hasAncestor(editor, $from.pos, 'mdxFileTree')).toBe(false);
    await typeText(editor, 'After the tree.');
    const markdown = getMarkdown(editor);
    expect(markdown).toMatch(/<FileTree>\s*<File name="package\.json" \/>\s*<File name="README\.md" \/>\s*<\/FileTree>\s*After the tree\./);
  });

  it('Enter in the middle of a name splits it into two files', async () => {
    const editor = await make('<FileTree>\n  <File name="ab.ts" />\n</FileTree>');
    const [file] = nodesOf(editor, 'mdxFile');
    if (!file) throw new Error('No file');
    await act(async () => {
      editor.view.focus();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, file.pos + 2)));
    });
    await press(editor, 'Enter');
    expect(fileNames(editor)).toEqual([
      { text: 'a', name: 'a' },
      { text: 'b.ts', name: 'b.ts' },
    ]);
    // One undo puts the name back together, with its authored tag.
    editor.commands.undo();
    expect(fileNames(editor)).toEqual([{ text: 'ab.ts', name: 'ab.ts' }]);
    expect(getMarkdown(editor)).toBe('<FileTree>\n\n<File name="ab.ts" />\n\n</FileTree>');
  });

  it('a slash in a name is part of the path, never the block menu; no Markdown shortcuts or typography either', async () => {
    const editor = await make(doc(paragraph()));
    await caretIn(editor);
    await insertFileTree(editor);
    await typeText(editor, 'src/');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
    await typeText(editor, 'code -- "x" ... (c).ts');
    expect(isSlashMenuOpen(editor.state)).toBe(false);
    expect(fileNames(editor)).toEqual([{ text: 'src/code -- "x" ... (c).ts', name: 'src/code -- "x" ... (c).ts' }]);
    expect(getMarkdown(editor)).toContain('<File name="src/code -- &quot;x&quot; ... (c).ts" />');
  });

  it('the icon is still its own field, and keys typed in it stay out of the page', async () => {
    const editor = await make('<FileTree>\n  <File name="a.ts" icon="file" />\n</FileTree>');
    const icon = document.querySelector<HTMLInputElement>('.pl-file input[data-attribute="icon"]');
    expect(icon?.value).toBe('file');
    expect(icon?.closest('[contenteditable="false"]')).not.toBeNull();
    expect(fileNames(editor)).toEqual([{ text: 'a.ts', name: 'a.ts' }]);
  });

  it('an attribute rename updates the editable name and saves only that attribute, including undo', async () => {
    const source = '<FileTree>\n\n<File   name=\'original.ts\' icon="book"/>\n\n</FileTree>';
    const editor = await make(source);
    const [file] = nodesOf(editor, 'mdxFile');
    if (!file) throw new Error('No file');
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(file.pos, undefined, { ...file.node.attrs, name: 'renamed.ts' }));
    });
    expect(fileNames(editor)).toEqual([{ text: 'renamed.ts', name: 'renamed.ts' }]);
    expect(getMarkdown(editor)).toBe(source.replace("name='original.ts'", 'name="renamed.ts"'));
    await act(async () => {
      editor.commands.undo();
    });
    expect(fileNames(editor)).toEqual([{ text: 'original.ts', name: 'original.ts' }]);
    expect(getMarkdown(editor)).toBe(source);
  });

  it('attribute-only File JSON keeps its name when loaded', async () => {
    const content = doc({ type: 'mdxFileTree', content: [{ type: 'mdxFile', attrs: { name: 'from-json.ts', icon: 'book' } }] });
    const editor = await make(content);
    expect(fileNames(editor)).toEqual([{ text: 'from-json.ts', name: 'from-json.ts' }]);
    expect(getMarkdown(editor)).toBe('<FileTree>\n\n<File name="from-json.ts" icon="book" />\n\n</FileTree>');
    await act(async () => {
      editor.commands.setContent(content, { emitUpdate: false });
    });
    expect(fileNames(editor)).toEqual([{ text: 'from-json.ts', name: 'from-json.ts' }]);
    expect(editor.schema.nodes.mdxFileTree?.createAndFill()?.firstChild?.type.name).toBe('mdxFolder');
  });
});

/** Exercise the browser copy event, including the production clipboard plugins. */
const copySelection = (editor: Editor) => {
  const values: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => undefined,
      setData: (type: string, value: string) => {
        values[type] = value;
      },
    },
  });
  editor.view.dom.dispatchEvent(event);
  return values;
};

describe('#846 review blockers', () => {
  it('copies only selected text within one File name', async () => {
    const editor = await make('<FileTree>\n\n<File name="index.ts" />\n\n</FileTree>');
    const file = nodesOf(editor, 'mdxFile')[0];
    if (!file) throw new Error('No file');
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, file.pos + 1, file.pos + 6)));
    });
    const copied = copySelection(editor);
    expect(copied['text/plain']).toBe('index');
    expect(copied['text/html']).not.toContain('FileTree');
    expect(fileNames(editor)).toEqual([{ text: 'index.ts', name: 'index.ts' }]);
  });

  it('synchronizes a File name changed by setNodeAttribute', async () => {
    const editor = await make('<FileTree>\n\n<File name="index.ts" />\n\n</FileTree>');
    const file = nodesOf(editor, 'mdxFile')[0];
    if (!file) throw new Error('No file');
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(file.pos, 'name', 'renamed.ts'));
    });
    expect(fileNames(editor)).toEqual([{ text: 'renamed.ts', name: 'renamed.ts' }]);
    expect(document.querySelector('.pl-file-name')?.textContent).toBe('renamed.ts');
    expect(getMarkdown(editor)).toContain('<File name="renamed.ts" />');
    await act(async () => {
      editor.commands.undo();
    });
    expect(fileNames(editor)).toEqual([{ text: 'index.ts', name: 'index.ts' }]);
    expect(document.querySelector('.pl-file-name')?.textContent).toBe('index.ts');
  });

  it('hydrates legacy constructor JSON before the first edit', async () => {
    const content = doc({ type: 'mdxFileTree', content: [{ type: 'mdxFile', attrs: { name: 'from-json.ts' } }] });
    const original = JSON.stringify(content);
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), content });
    editors.push(editor);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(createElement(EditorContent, { editor })));
    expect(document.querySelector('.pl-file-name')?.textContent).toBe('from-json.ts');
    expect(fileNames(editor)).toEqual([{ text: 'from-json.ts', name: 'from-json.ts' }]);
    const file = nodesOf(editor, 'mdxFile')[0];
    if (!file) throw new Error('No file');
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, file.pos + 1)));
    });
    await typeText(editor, 'x');
    expect(fileNames(editor)).toEqual([{ text: 'xfrom-json.ts', name: 'xfrom-json.ts' }]);
    expect(getMarkdown(editor)).toContain('<File name="xfrom-json.ts" />');
    expect(JSON.stringify(content)).toBe(original);
    await act(async () => {
      editor.commands.undo();
    });
    expect(fileNames(editor)).toEqual([{ text: 'from-json.ts', name: 'from-json.ts' }]);
    expect(getMarkdown(editor)).toContain('<File name="from-json.ts" />');
  });
});

describe('#846 structural clipboard controls', () => {
  it.each(['node', 'cross-node'])('keeps structural Markdown for a %s selection', async (kind) => {
    const editor = await make('<FileTree>\n\n<File name="index.ts" />\n\n<File name="util.ts" />\n\n</FileTree>');
    const tree = nodesOf(editor, 'mdxFileTree')[0];
    const [first, second] = nodesOf(editor, 'mdxFile');
    if (!tree || !first || !second) throw new Error('No tree or files');
    await act(async () => {
      const selection =
        kind === 'node' ? NodeSelection.create(editor.state.doc, tree.pos) : TextSelection.create(editor.state.doc, first.pos + 1, second.pos + 3);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    });
    const copied = copySelection(editor);
    expect(copied['text/plain']).toContain('<FileTree>');
    expect(copied['text/plain']).toContain('<File name="index.ts" />');
    expect(copied['text/plain']).toContain('<File name="util.ts" />');
  });
});

/**
 * Each source, and the Markdown main writes for it (read from main at bc5e35d70): the editor
 * spaces block tags with blank lines, and keeps each tag as authored (quotes, spacing,
 * expressions, character references, a closing tag).
 */
const SAVED_ON_MAIN: Array<[source: string, saved: string]> = [
  ['<FileTree>\n\nRead me.\n\n</FileTree>', '<FileTree>\n\n<Folder>\n\nRead me.\n\n</Folder>\n\n</FileTree>'],
  ['<FileTree>\n\n</FileTree>', '<FileTree>\n\n<Folder>\n\n</Folder>\n\n</FileTree>'],
  [
    '<FileTree>\n  <Folder name="src">\n    <File name="a.ts" />\n  </Folder>\n  <File name={x} icon="y" />\n  <File name="&amp;b" ></File>\n</FileTree>',
    '<FileTree>\n\n<Folder name="src">\n\n<File name="a.ts" />\n\n</Folder>\n\n<File name={x} icon="y" />\n\n<File name="&amp;b" ></File>\n\n</FileTree>',
  ],
  ['<File name="solo.md" />\n\nText after.', '<File name="solo.md" />\n\nText after.'],
  ['<FileTree>\n  <File name="" />\n</FileTree>', '<FileTree>\n\n<File name="" />\n\n</FileTree>'],
  ['<FileTree>\n<File   name=\'quoted.md\'   icon="book"/>\n</FileTree>', '<FileTree>\n\n<File   name=\'quoted.md\'   icon="book"/>\n\n</FileTree>'],
  [
    '<FileTree>\n\n<File name="a.ts" />\n\n<File name="b.ts" />\n\n</FileTree>',
    '<FileTree>\n\n<File name="a.ts" />\n\n<File name="b.ts" />\n\n</FileTree>',
  ],
  [
    '<FileTree>\n\n<Folder name="docs" defaultOpen>\n\n<File name="intro.mdx" />\n\n</Folder>\n\n</FileTree>',
    '<FileTree>\n\n<Folder name="docs" defaultOpen>\n\n<File name="intro.mdx" />\n\n</Folder>\n\n</FileTree>',
  ],
];

describe('#670: saved Markdown is unchanged', () => {
  it.each(SAVED_ON_MAIN)('%j reads in with its name as text and saves exactly as main does', async (source, saved) => {
    const editor = await make(source);
    for (const { text, name } of fileNames(editor)) expect(text).toBe(name);
    expect(getMarkdown(editor)).toBe(saved);
    // And the saved form is a fixed point.
    expect(getMarkdown(await make(saved))).toBe(saved);
  });
});

/** A browser cut or paste event, through the production clipboard plugins; `values` is the clipboard. */
const clipboardEvent = async (editor: Editor, type: 'copy' | 'cut' | 'paste', values: Record<string, string>) => {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => undefined,
        getData: (format: string) => values[format] ?? '',
        setData: (format: string, value: string) => {
          values[format] = value;
        },
      },
    });
    editor.view.dom.dispatchEvent(event);
  });
  return values;
};
const selectNode = async (editor: Editor, pos: number) => {
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  });
};
const placeCaret = async (editor: Editor, pos: number) => {
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  });
};
/** What the editor remembers about the last cut row, if anything. */
const rememberedCut = (editor: Editor) =>
  editor.state.plugins.find((plugin) => (plugin as unknown as { key: string }).key.startsWith('mdxCutRow$'))?.getState(editor.state) as unknown;
const undo = async (editor: Editor) => {
  await act(async () => {
    editor.commands.undo();
  });
};
const redo = async (editor: Editor) => {
  await act(async () => {
    editor.commands.redo();
  });
};

const TWO_FILES = '<FileTree>\n\n<File name="index.ts" />\n\n<File name="util.ts" />\n\n</FileTree>';
const THREE_FILES = '<FileTree>\n\n<File name="a.ts" />\n\n<File name="b.ts" />\n\n<File name="c.ts" />\n\n</FileTree>';
const WITH_FOLDER =
  '<FileTree>\n\n<Folder name="src">\n\n<File name="a.ts" />\n\n<File name="b.ts" />\n\n</Folder>\n\n<File name="c.ts" />\n\n</FileTree>';

describe('#870: cutting a whole row and pasting it back restores the File tree', () => {
  it.each([
    ['mdxFile', 0, TWO_FILES],
    ['mdxFile', 1, TWO_FILES],
    ['mdxFile', 0, THREE_FILES],
    ['mdxFile', 1, THREE_FILES],
    ['mdxFile', 2, THREE_FILES],
    ['mdxFolder', 0, WITH_FOLDER],
    ['mdxFile', 0, WITH_FOLDER],
    ['mdxFile', 1, WITH_FOLDER],
    ['mdxFile', 2, WITH_FOLDER],
  ] as const)('%s %i of %j', async (type, index, source) => {
    const editor = await make(source);
    const row = nodesOf(editor, type)[index];
    if (!row) throw new Error(`No ${type} ${index}`);
    await selectNode(editor, row.pos);
    const values = await clipboardEvent(editor, 'cut', {});
    const afterCut = getMarkdown(editor);
    expect(afterCut).not.toBe(source);
    // Straight after the cut, well within the history's grouping delay: the paste is still its own undo step.
    await clipboardEvent(editor, 'paste', values);
    expect(getMarkdown(editor)).toBe(source);
    for (const { text, name } of fileNames(editor)) expect(text).toBe(name);
    // One undo takes the paste back, a second the cut; redo replays them one at a time.
    await undo(editor);
    expect(getMarkdown(editor)).toBe(afterCut);
    await undo(editor);
    expect(getMarkdown(editor)).toBe(source);
    await redo(editor);
    expect(getMarkdown(editor)).toBe(afterCut);
    await redo(editor);
    expect(getMarkdown(editor)).toBe(source);
  });

  it.each([
    ['a horizontal rule', '---'],
    ['an image', '![shot](https://example.com/shot.png)'],
  ])('cutting the only File of a tree before %s and pasting it back restores the tree and keeps that block', async (_, block) => {
    const source = `<FileTree>\n\n<File name="cut" />\n\n</FileTree>\n\n${block}\n\ntail`;
    const editor = await make(source);
    const only = nodesOf(editor, 'mdxFile')[0];
    if (!only) throw new Error('No file');
    await selectNode(editor, only.pos);
    const values = await clipboardEvent(editor, 'cut', {});
    const afterCut = getMarkdown(editor);
    expect(afterCut).toBe(`${block}\n\ntail`);
    await clipboardEvent(editor, 'paste', values);
    expect(getMarkdown(editor)).toBe(source);
    await undo(editor);
    expect(getMarkdown(editor)).toBe(afterCut);
  });

  it('a quick cut and paste of one of two Files undoes and redoes as two steps', async () => {
    const source = '<FileTree>\n\n<File name="cut" />\n\n<File name="other" />\n\n</FileTree>\n\nend';
    const editor = await make(source);
    const first = nodesOf(editor, 'mdxFile')[0];
    if (!first) throw new Error('No file');
    await selectNode(editor, first.pos);
    await clipboardEvent(editor, 'paste', await clipboardEvent(editor, 'cut', {}));
    expect(fileNames(editor).map(({ name }) => name)).toEqual(['cut', 'other']);
    await undo(editor);
    expect(fileNames(editor).map(({ name }) => name)).toEqual(['other']);
    await redo(editor);
    expect(getMarkdown(editor)).toBe(source);
  });

  it.each([
    ['caret in its only, empty File', '<File />', 0],
    ['whole name of its only File selected', '<File name="other" />', 'other'.length],
  ] as const)('a copied row pasted into another tree with the %s replaces that File, with no Folder added', async (_, row, selected) => {
    const editor = await make(`<FileTree>\n\n<File name="copy" />\n\n</FileTree>\n\nmiddle\n\n<FileTree>\n\n${row}\n\n</FileTree>`);
    const [first, target] = nodesOf(editor, 'mdxFile');
    if (!first || !target) throw new Error('No files');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'copy', {});
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target.pos + 1, target.pos + 1 + selected)));
    });
    await clipboardEvent(editor, 'paste', values);
    expect(nodesOf(editor, 'mdxFolder')).toHaveLength(0);
    expect(getMarkdown(editor)).toBe(
      '<FileTree>\n\n<File name="copy" />\n\n</FileTree>\n\nmiddle\n\n<FileTree>\n\n<File name="copy" />\n\n</FileTree>',
    );
    await undo(editor);
    expect(fileNames(editor)[1]?.name).toBe(selected ? 'other' : '');
  });

  it('the remembered cut is gone once the editor is destroyed', async () => {
    const editor = await make(TWO_FILES);
    const first = nodesOf(editor, 'mdxFile')[0];
    if (!first) throw new Error('No file');
    await selectNode(editor, first.pos);
    await clipboardEvent(editor, 'cut', {});
    expect(rememberedCut(editor)).toBeTruthy();
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    editor.destroy();
    expect(rememberedCut(editor)).toBeNull();
  });

  it('the remembered cut is gone once the document is replaced', async () => {
    const editor = await make(TWO_FILES);
    const first = nodesOf(editor, 'mdxFile')[0];
    if (!first) throw new Error('No file');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'cut', {});
    const caret = editor.state.selection.head;
    await act(async () => {
      editor.commands.setContent(TWO_FILES, { emitUpdate: false });
      editor.commands.setTextSelection(caret);
    });
    expect(rememberedCut(editor)).toBeNull();
    await clipboardEvent(editor, 'paste', values);
    expect(fileNames(editor).map(({ name }) => name)).toEqual(['index.ts', 'index.ts', 'util.ts']);
  });

  it('cutting the only File takes its tree too, and pasting it back restores both', async () => {
    const source = '<FileTree>\n\n<File name="index.ts" />\n\n</FileTree>';
    const editor = await make(source);
    const only = nodesOf(editor, 'mdxFile')[0];
    if (!only) throw new Error('No file');
    await selectNode(editor, only.pos);
    const values = await clipboardEvent(editor, 'cut', {});
    await clipboardEvent(editor, 'paste', values);
    expect(fileNames(editor)).toEqual([{ text: 'index.ts', name: 'index.ts' }]);
    expect(getMarkdown(editor)).toBe(source);
  });

  it('undo right after a cut puts the row back', async () => {
    const editor = await make(TWO_FILES);
    const first = nodesOf(editor, 'mdxFile')[0];
    if (!first) throw new Error('No file');
    await selectNode(editor, first.pos);
    await clipboardEvent(editor, 'cut', {});
    expect(fileNames(editor).map(({ name }) => name)).toEqual(['util.ts']);
    await act(async () => {
      editor.commands.undo();
    });
    expect(getMarkdown(editor)).toBe(TWO_FILES);
  });

  it('the caret ends after the pasted row, in its name', async () => {
    const editor = await make(TWO_FILES);
    const first = nodesOf(editor, 'mdxFile')[0];
    if (!first) throw new Error('No file');
    await selectNode(editor, first.pos);
    await clipboardEvent(editor, 'paste', await clipboardEvent(editor, 'cut', {}));
    const { $from } = editor.state.selection;
    expect(editor.state.selection.empty).toBe(true);
    expect($from.parent.textContent).toBe('index.ts');
    expect($from.parentOffset).toBe('index.ts'.length);
  });

  it('a row pasted at the end of a name goes after that File', async () => {
    const editor = await make(TWO_FILES);
    const [first, second] = nodesOf(editor, 'mdxFile');
    if (!first || !second) throw new Error('No files');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'cut', {});
    await placeCaret(editor, (nodesOf(editor, 'mdxFile')[0]?.pos ?? 0) + 1 + 'util.ts'.length);
    await clipboardEvent(editor, 'paste', values);
    expect(getMarkdown(editor)).toBe('<FileTree>\n\n<File name="util.ts" />\n\n<File name="index.ts" />\n\n</FileTree>');
  });

  it('a copied row pasted at the start of a name goes before that File, with no empty File', async () => {
    const editor = await make(TWO_FILES);
    const [first, second] = nodesOf(editor, 'mdxFile');
    if (!first || !second) throw new Error('No files');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'copy', {});
    await placeCaret(editor, second.pos + 1);
    await clipboardEvent(editor, 'paste', values);
    expect(getMarkdown(editor)).toBe('<FileTree>\n\n<File name="index.ts" />\n\n<File name="index.ts" />\n\n<File name="util.ts" />\n\n</FileTree>');
  });

  it('a row pasted inside a name splits it as Enter does, the second half a File with its own tag', async () => {
    const editor = await make('<FileTree>\n\n<File name="index.ts" />\n\n<File name="util.ts" icon="ts" />\n\n</FileTree>');
    const [first, second] = nodesOf(editor, 'mdxFile');
    if (!first || !second) throw new Error('No files');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'copy', {});
    await placeCaret(editor, second.pos + 1 + 'util'.length);
    await clipboardEvent(editor, 'paste', values);
    expect(fileNames(editor)).toEqual([
      { text: 'index.ts', name: 'index.ts' },
      { text: 'util', name: 'util' },
      { text: 'index.ts', name: 'index.ts' },
      { text: '.ts', name: '.ts' },
    ]);
    expect(getMarkdown(editor)).toBe(
      '<FileTree>\n\n<File name="index.ts" />\n\n<File name="util" icon="ts" />\n\n<File name="index.ts" />\n\n<File name=".ts" />\n\n</FileTree>',
    );
  });

  it('a row pasted into an empty File takes its place', async () => {
    const editor = await make('<FileTree>\n\n<File name="index.ts" />\n\n<File name="" />\n\n</FileTree>');
    const [first, empty] = nodesOf(editor, 'mdxFile');
    if (!first || !empty) throw new Error('No files');
    await selectNode(editor, first.pos);
    const values = await clipboardEvent(editor, 'copy', {});
    await placeCaret(editor, empty.pos + 1);
    await clipboardEvent(editor, 'paste', values);
    expect(getMarkdown(editor)).toBe('<FileTree>\n\n<File name="index.ts" />\n\n<File name="index.ts" />\n\n</FileTree>');
  });

  it('text pasted into a name is still text in that name', async () => {
    const editor = await make(TWO_FILES);
    const second = nodesOf(editor, 'mdxFile')[1];
    if (!second) throw new Error('No file');
    await placeCaret(editor, second.pos + 1 + 'util'.length);
    await clipboardEvent(editor, 'paste', { 'text/plain': '-core' });
    expect(fileNames(editor).map(({ name }) => name)).toEqual(['index.ts', 'util-core.ts']);
  });
});
