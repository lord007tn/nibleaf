import { type JSONContent, mergeAttributes, Node } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { AttrStep, Mapping } from '@tiptap/pm/transform';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { FileNameView } from '../file-name-view';
import { sourceMetadataAttributes, writeBlockTag } from '../mdx-roundtrip';
import { atomTag, containerNode, registryAttributes, type SerializeState, titledNode } from './factories';

// ─── Authored file tree (names are display data, never filesystem paths) ─────
/** Preserve the tree parser's existing Folder wrapper for stray body content.
 * An editable File can now hold text, so automatic wrapping would otherwise
 * turn that text into a file name instead of retaining it as a folder body. */
const treeContent = (element: HTMLElement): HTMLElement => {
  const content = element.ownerDocument.createElement('div');
  let pending: globalThis.Node[] = [];
  const flush = () => {
    if (pending.some((child) => child.nodeType === globalThis.Node.ELEMENT_NODE || child.textContent?.trim())) {
      const folder = element.ownerDocument.createElement('div');
      folder.setAttribute('data-mdx', 'Folder');
      folder.append(...pending);
      content.append(folder);
    }
    pending = [];
  };
  for (const child of element.childNodes) {
    const copy = child.cloneNode(true);
    if (child instanceof Element && child.matches('file, folder, div[data-mdx="File"], div[data-mdx="Folder"]')) {
      flush();
      content.append(copy);
    } else pending.push(copy);
  }
  flush();
  if (!content.hasChildNodes()) {
    const folder = element.ownerDocument.createElement('div');
    folder.setAttribute('data-mdx', 'Folder');
    content.append(folder);
  }
  return content;
};

export const FileTree = containerNode({
  name: 'mdxFileTree',
  tag: 'FileTree',
  content: '(mdxFolder | mdxFile)+',
  className: 'pl-filetree',
}).extend({
  parseHTML: () => [
    { tag: 'filetree', contentElement: treeContent },
    { tag: 'div[data-mdx="FileTree"]', contentElement: treeContent },
  ],
});
export const Folder = titledNode({
  name: 'mdxFolder',
  tag: 'Folder',
  className: 'pl-folder',
}).extend({
  // Preserve the tree's default child for createAndFill(), before File (101).
  priority: 102,
});

/** A File's name as written in its tag, exactly as its `name` attribute parses (see `registryAttributes`). */
const authoredName = (element: HTMLElement): string => element.getAttribute('name') ?? element.getAttribute('data-name') ?? '';
const nameContent = (element: globalThis.Node, schema: Schema): Fragment => {
  const name = element instanceof HTMLElement ? authoredName(element) : '';
  return name ? Fragment.from(schema.text(name)) : Fragment.empty;
};

/** Legacy constructor JSON predates the editable name. Seed it before the
 * initial document is created, without mutating the caller's JSON or history. */
const hydrateFileNames = (node: JSONContent): JSONContent => {
  if (node.type === 'mdxFile' && !node.content?.length && typeof node.attrs?.name === 'string' && node.attrs.name) {
    return { ...node, content: [{ type: 'text', text: node.attrs.name }] };
  }
  return node.content ? { ...node, content: node.content.map(hydrateFileNames) } : node;
};

/** The ranges of the final document that `transactions` wrote. */
const changedRanges = (transactions: readonly Transaction[], size: number): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  transactions.forEach((tr, index) => {
    tr.mapping.maps.forEach((map, step) => {
      const add = (newStart: number, newEnd: number) => {
        let from = tr.mapping.slice(step + 1).map(newStart, -1);
        let to = tr.mapping.slice(step + 1).map(newEnd, 1);
        for (const later of transactions.slice(index + 1)) {
          from = later.mapping.map(from, -1);
          to = later.mapping.map(to, 1);
        }
        ranges.push([Math.max(0, Math.min(from, size)), Math.max(0, Math.min(Math.max(to, from), size))]);
      };
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        add(newStart, newEnd);
      });
      const change = tr.steps[step];
      // AttrStep deliberately has an empty map, but its node still changed.
      if (change instanceof AttrStep && change.attr === 'name') add(change.pos, change.pos + 1);
    });
  });
  return ranges;
};

const fileNameKey = new PluginKey('mdxFileName');

/**
 * A File in a file tree (#670). Its name is the node's text, so the caret can
 * be in it: typing right after inserting a File tree names its first file.
 * The saved Markdown is unchanged: the name is still written as the tag's
 * `name` attribute (`<File name="…" />`), which a plugin keeps equal to the
 * text in the same transaction (so one undo covers both). A File is parsed
 * with its `name` as its text, so an unedited File keeps its authored tag.
 *
 * The name is plain text: no formatting, no Markdown shortcuts or typography
 * (`code`), never a line break. Enter starts the next file; Enter in an empty
 * last file leaves the tree, like an empty list item.
 */
export const File = Node.create({
  name: 'mdxFile',
  // Ahead of the core keymap (whose Enter adds a line break in `code` text), still after Paragraph (1000) in the schema.
  priority: 101,
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => ({ ...registryAttributes('File'), ...sourceMetadataAttributes() }),
  onBeforeCreate() {
    const content = this.editor.options.content;
    if (content && typeof content !== 'string') {
      this.editor.options.content = Array.isArray(content) ? content.map(hydrateFileNames) : hydrateFileNames(content);
    }
  },
  parseHTML: () => [
    { tag: 'file', getContent: nameContent },
    { tag: 'div[data-mdx="File"]', getContent: nameContent },
  ],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-mdx': 'File', class: 'pl-file' }), 0],
  addNodeView: () => ReactNodeViewRenderer(FileNameView),
  addStorage: () => ({
    markdown: {
      serialize(state: SerializeState, node: PMNode) {
        writeBlockTag(state, node, atomTag(node, 'File'));
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, $to } = state.selection;
        if ($from.parent.type !== this.type || !$from.sameParent($to)) return false;
        const tree = $from.node(-1);
        const index = $from.index(-1);
        // An empty last file of a tree with other entries: leave the tree, with a paragraph after it.
        if ($from.parent.content.size === 0 && tree.type.name === 'mdxFileTree' && tree.childCount > 1 && index === tree.childCount - 1) {
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return false;
          const fileStart = $from.before();
          const tr = state.tr.delete(fileStart, $from.after());
          const after = tr.mapping.map($from.after(-1));
          tr.insert(after, paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1));
          editor.view.dispatch(tr.scrollIntoView());
          return true;
        }
        // Otherwise the next file, a new one (its own tag, never a copy of this one's), with the text after the caret as its name.
        const tr = state.tr.deleteSelection();
        tr.split(tr.mapping.map($from.pos), 1, [{ type: this.type, attrs: {} }]);
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: fileNameKey,
        // Only what the transactions wrote is looked at, so typing elsewhere costs nothing.
        appendTransaction(transactions, previous, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = state.tr;
          const mapping = new Mapping();
          for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
          const backwards = mapping.invert();
          for (const [from, to] of changedRanges(transactions, state.doc.content.size)) {
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type !== type) return true;
              const currentPos = tr.mapping.map(pos);
              const current = tr.doc.nodeAt(currentPos);
              if (!current || current.attrs.name === current.textContent) return false;
              const prior = backwards.mapResult(pos, 1);
              const before = previous.doc.nodeAt(prior.pos);
              // Attribute edits and attribute-only JSON are supported entry points,
              // too. A text edit leaves the attribute unchanged until this plugin.
              const renamed = before?.type === type && before.attrs.name !== node.attrs.name;
              const attributeOnly = !node.content.size && node.attrs.name && (prior.deleted || before?.type !== type || !before.content.size);
              if (renamed || attributeOnly) {
                const name = String(current.attrs.name ?? '');
                tr.replaceWith(currentPos + 1, currentPos + current.nodeSize - 1, name ? state.schema.text(name) : Fragment.empty);
              } else tr.setNodeAttribute(currentPos, 'name', current.textContent);
              return false;
            });
          }
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
