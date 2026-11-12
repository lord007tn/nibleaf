import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { type Editor, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { decodeMdxSource, replaceOpeningAttribute, VIDEO_EMBED_ELEMENT, writeBlockTag } from './mdx-roundtrip';
import { type EmbedIntent, type EmbedKind, embedTargetFor } from './video-embed-url';
import { VideoEmbedView } from './video-embed-view';

/**
 * The editor's Video and Embed block: one authored `<iframe>` or `<video>`,
 * optionally inside a `<Frame>` that holds nothing else. It stores the page's
 * canonical, Mintlify-compatible HTML and nothing Nibleaf-only:
 *
 *   <iframe src="https://www.youtube-nocookie.com/embed/ID" title="Tour"></iframe>
 *   <video controls src="https://cdn.example.com/demo.mp4"></video>
 *   <Frame caption="Caption">
 *     <iframe …></iframe>
 *   </Frame>
 *
 * Opened from a page (`mediaRanges` in ./mdx-roundtrip), the block keeps the
 * authored source and saves it back byte for byte until the writer changes the
 * address, title or caption. Then only what changed is rewritten, with the same
 * attribute editing the MDX components use (`replaceOpeningAttribute`); every
 * other authored attribute and child stays as written. A new block writes the
 * canonical form above.
 */

export const VIDEO_EMBED_NODE = 'videoEmbed';

/** Which field a newly inserted block focuses: its address, or its title. */
type FocusField = '' | 'url' | 'title';

export interface VideoEmbedAttributes {
  kind: EmbedKind;
  src: string;
  /** The iframe's accessible name. A `<video>` has none in storage. */
  title: string;
  /** The `<Frame caption>` around it; empty for none. */
  caption: string;
  /** The authored source, Frame included; empty for a new block. */
  source: string;
  /** Where the Frame's opener ends and its closer starts in `source` (0 and the length without one). */
  frameOpen: number;
  frameClose: number;
  /** The values as opened, as JSON: unchanged, `source` is saved as is. */
  original: string;
  /** The slash item that made it (`video` or `embed`); empty when opened from a page. */
  intent: EmbedIntent | '';
  focus: FocusField;
}

type Values = Pick<VideoEmbedAttributes, 'kind' | 'src' | 'title' | 'caption'>;
const valuesOf = (attributes: Values): Values => ({
  kind: attributes.kind,
  src: attributes.src,
  title: attributes.title,
  caption: attributes.caption,
});

const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The block's attributes from authored source, or null when it isn't one closed iframe or video. */
const videoEmbedFromSource = (source: string, frameOpen: number, frameClose: number, caption: string): VideoEmbedAttributes | null => {
  if (!source || frameOpen < 0 || frameClose > source.length || frameOpen > frameClose) return null;
  const inner = source.slice(frameOpen, frameClose);
  const [media, extra] = scanAuthoredEmbeds(inner);
  if (!media?.closed || extra || inner.slice(0, media.start).trim() || inner.slice(media.end).trim()) return null;
  const values: Values = {
    kind: media.kind,
    src: media.attributes.get('src') ?? '',
    title: media.kind === 'iframe' ? (media.attributes.get('title') ?? '') : '',
    caption,
  };
  return { ...values, source, frameOpen, frameClose, original: JSON.stringify(values), intent: '', focus: '' };
};

/** The canonical HTML for one iframe or video. */
const canonicalMedia = ({ kind, src, title }: Values): string =>
  kind === 'video'
    ? `<video controls src="${escapeAttribute(src)}"></video>`
    : `<iframe src="${escapeAttribute(src)}"${title ? ` title="${escapeAttribute(title)}"` : ''}></iframe>`;

const tagName = (opener: string): string => /^<([A-Za-z][\w.:-]*)/.exec(opener)?.[1] ?? '';

/** What the block saves: its authored source while unchanged, otherwise that source with only the changed values rewritten. */
const videoEmbedMarkdown = (attributes: VideoEmbedAttributes): string => {
  const current = valuesOf(attributes);
  let original: Values | null = null;
  try {
    original = attributes.original ? (JSON.parse(attributes.original) as Values) : null;
  } catch {
    original = null;
  }
  const { source } = attributes;
  if (source && original && JSON.stringify(valuesOf(original)) === JSON.stringify(current)) return source;
  // A new block with no address yet has nothing to save.
  if (!current.src.trim()) return source && original ? source : '';

  const frameOpener = source ? source.slice(0, attributes.frameOpen) : '';
  const inner = source ? source.slice(attributes.frameOpen, attributes.frameClose) : '';
  const frameCloser = source ? source.slice(attributes.frameClose) : '';
  const [authored] = scanAuthoredEmbeds(inner);
  // The authored whitespace around the media inside its Frame.
  const lead = authored ? inner.slice(0, authored.start) : '';
  const trail = authored ? inner.slice(authored.end) : '';
  let media: string;
  if (authored && original && authored.kind === current.kind) {
    let opener = inner.slice(authored.start, authored.openEnd);
    const name = tagName(opener);
    if (current.src !== original.src) opener = replaceOpeningAttribute(opener, name, 'src', current.src);
    if (current.kind === 'iframe' && current.title !== original.title) opener = replaceOpeningAttribute(opener, name, 'title', current.title);
    media = `${opener}${inner.slice(authored.openEnd, authored.end)}`;
  } else {
    media = canonicalMedia(current);
  }

  if (frameOpener) {
    let opener = frameOpener;
    if (current.caption !== original?.caption) opener = replaceOpeningAttribute(opener, 'Frame', 'caption', current.caption);
    // Removing the caption from a Frame that has nothing else to say removes the Frame.
    if (!current.caption && current.caption !== original?.caption && /^<Frame\s*>$/.test(opener)) return media;
    return `${opener}${lead}${media}${trail}${frameCloser}`;
  }
  return current.caption ? `<Frame caption="${escapeAttribute(current.caption)}">\n  ${media}\n</Frame>` : media;
};

/**
 * A block from somewhere else (another page's clipboard, pasted HTML or
 * Markdown) keeps none of its authored source: only an address the block
 * accepts, written canonically, with its title and caption. Null drops it.
 */
export const pastedVideoEmbedAttributes = (attributes: VideoEmbedAttributes): Partial<VideoEmbedAttributes> | null => {
  const target = embedTargetFor(attributes.src, 'embed');
  if (!target) return null;
  return { kind: target.kind, src: target.src, title: target.kind === 'iframe' ? attributes.title : '', caption: attributes.caption };
};

/**
 * Turn the video link the caret is on into the Video block, asking for its
 * title. A paragraph that is only that link becomes the block; in a paragraph
 * with other words, the block goes after it and the words stay as they are.
 */
export const embedLinkedVideo = (editor: Editor, href: string): boolean => {
  const target = embedTargetFor(href, 'video');
  const type = editor.schema.nodes[VIDEO_EMBED_NODE];
  const { $from } = editor.state.selection;
  const paragraph = $from.parent;
  if (!target || !type || !editor.isEditable || paragraph.type.name !== 'paragraph') return false;
  const block = type.create({ ...target, intent: 'video', focus: 'title' });
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  let onlyTheLink = paragraph.childCount > 0;
  paragraph.forEach((child) => {
    if (!child.marks.some((mark) => mark.type.name === 'link' && mark.attrs.href === href)) onlyTheLink = false;
  });
  const tr = editor.state.tr;
  if (onlyTheLink && container.canReplaceWith(index, index + 1, type)) tr.replaceWith($from.before(depth), $from.after(depth), block);
  else if (container.canReplaceWith(index + 1, index + 1, type)) tr.insert($from.after(depth), block);
  else return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
};

const plain = (fallback: unknown) => ({ default: fallback, rendered: false });

export const VideoEmbed = Node.create({
  name: VIDEO_EMBED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes: () => ({
    kind: plain('iframe'),
    src: plain(''),
    title: plain(''),
    caption: plain(''),
    source: plain(''),
    frameOpen: plain(0),
    frameClose: plain(0),
    original: plain(''),
    intent: plain(''),
    focus: plain(''),
  }),
  parseHTML: () => [
    {
      tag: VIDEO_EMBED_ELEMENT,
      getAttrs: (element) =>
        videoEmbedFromSource(
          decodeMdxSource(element.getAttribute('data-source')),
          Number(element.getAttribute('data-frame-open') ?? 0),
          Number(element.getAttribute('data-frame-close') ?? 0),
          element.getAttribute('data-caption') ?? '',
        ) ?? false,
    },
  ],
  renderHTML: ({ node }) => ['div', { 'data-video-embed': String(node.attrs.kind), 'data-src': String(node.attrs.src) }],
  addNodeView: () => ReactNodeViewRenderer(VideoEmbedView),
  addStorage: () => ({
    markdown: {
      serialize(state: Parameters<typeof writeBlockTag>[0], node: PMNode) {
        const markdown = videoEmbedMarkdown(node.attrs as VideoEmbedAttributes);
        if (markdown) writeBlockTag(state, node, markdown);
      },
      parse: {},
    } satisfies MarkdownNodeSpec,
  }),
});
