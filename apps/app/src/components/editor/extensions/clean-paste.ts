import { Extension } from '@tiptap/core';
import { DOMParser, DOMSerializer, Fragment, type Node as PMNode, Slice } from '@tiptap/pm/model';
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { allowedURL, escapeImageAttribute, IMAGE_UPLOAD_PLACEHOLDER_PREFIX, imageClasses, imageDimension, normalizedURL } from './html-safety';
import { imageAttributeNames } from './image-source';
import { canEditImages, type ImageUploader, uploadEditorImage } from './image-upload';
import { fileFromPastedImage } from './pasted-image';

// Clipboard HTML is public. A nonce only identifies a candidate: the matching
// plain text and this in-memory Slice are the authority, never returned HTML.
let lastCopy: { nonce: string; slice: Slice; text: string } | null = null;

function unsafeSourceOpener(opening: string): boolean {
  if (!opening) return false;
  const root = document.implementation.createHTMLDocument('').createElement('div');
  root.innerHTML = opening;
  return Array.from(root.firstElementChild?.attributes ?? []).some(
    (attribute) =>
      /^(?:on.*|style|srcdoc|formaction|srcset|dangerouslysetinnerhtml|xmlns(?::.*)?|xlink:href)$/i.test(attribute.name) ||
      (['href', 'src'].includes(attribute.name) && !safePasteHref(attribute.value)),
  );
}

const semanticTags = new Set(
  'p h1 h2 h3 h4 h5 h6 strong b em i u s strike del sup sub mark a ul ol li blockquote pre code table thead tbody tfoot tr th td img hr br'.split(
    ' ',
  ),
);
const blocks = 'p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,div,hr';

/** Clipboard links may be relative, but may never introduce an active URL scheme. */
export function safePasteHref(value: string): boolean {
  return allowedURL(value, ['http', 'https', 'mailto', 'tel']);
}

/** Word's downlevel-revealed conditionals contain marker spans without mso-list:Ignore. */
function removeSupportListMarkers(paragraph: Element): string | null {
  const doc = paragraph.ownerDocument;
  const walker = doc.createTreeWalker(paragraph, 128);
  const comments: Comment[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as Comment);
  let glyph: string | null = null;
  for (const [index, comment] of comments.entries()) {
    if (!paragraph.contains(comment) || !/\[if\s+!supportLists\]/i.test(comment.data)) continue;
    if (/\[endif\]/i.test(comment.data)) {
      const marker = doc.createElement('div');
      marker.innerHTML = comment.data.replace(/^.*?\[if\s+!supportLists\]>/i, '').replace(/<!\[endif\].*$/i, '');
      glyph ??= marker.textContent;
      comment.remove();
      continue;
    }
    const end = comments.slice(index + 1).find((candidate) => paragraph.contains(candidate) && /\[endif\]/i.test(candidate.data));
    if (!end) continue;
    const range = doc.createRange();
    range.setStartBefore(comment);
    range.setEndAfter(end);
    glyph ??= range.cloneContents().textContent;
    range.deleteContents();
  }
  return glyph;
}

function wordLists(root: HTMLElement) {
  for (const parent of [root, ...root.querySelectorAll<HTMLElement>('div,td,blockquote')]) {
    const stack: { list: HTMLOListElement | HTMLUListElement; level: number; id: string; ordinal?: number }[] = [];
    for (const child of Array.from(parent.children)) {
      const match = /mso-list:\s*(l\d+)\s+level(\d+)(?:\s+(lfo\d+))?/i.exec(child.getAttribute('style') ?? '');
      if (child.tagName !== 'P' || !match) {
        stack.length = 0;
        continue;
      }
      const supportGlyph = removeSupportListMarkers(child);
      const markers = Array.from(child.querySelectorAll<HTMLElement>('span')).filter((span) =>
        /mso-list:\s*ignore/i.test(span.getAttribute('style') ?? ''),
      );
      const glyph = (supportGlyph ?? markers[0]?.textContent ?? '').trimStart();
      const number = /^(\d+|[a-z]|[ivxlcdm]+)[.)]/i.exec(glyph);
      const kind = number ? 'ol' : 'ul';
      const level = Number(match[2]);
      const id = `${match[1]}:${match[3] ?? ''}`;
      for (const marker of markers) marker.remove();
      const text = root.ownerDocument.createTreeWalker(child, 4);
      while (text.nextNode()) {
        text.currentNode.textContent = (text.currentNode.textContent ?? '').trimStart();
        if (text.currentNode.textContent) break;
      }
      while (stack.length) {
        const last = stack.at(-1);
        if (!last || (last.level <= level && last.id === id)) break;
        stack.pop();
      }
      let current = stack.at(-1);
      const ordinal = number && /^\d+$/.test(number[1] ?? '') ? Number(number[1]) : undefined;
      if (
        !current ||
        current.level !== level ||
        current.list.localName !== kind ||
        (ordinal !== undefined && current.ordinal !== undefined && ordinal !== current.ordinal + 1)
      ) {
        if (current?.level === level) {
          stack.pop();
          current = stack.at(-1);
        }
        const list = root.ownerDocument.createElement(kind);
        const ordinal = number?.[1];
        if (kind === 'ol' && ordinal && /^\d+$/.test(ordinal) && ordinal !== '1') list.setAttribute('start', ordinal);
        const previousItem = current?.list.lastElementChild;
        if (previousItem) previousItem.append(list);
        else parent.insertBefore(list, child);
        current = { list, level, id };
        stack.push(current);
      }
      current.ordinal = ordinal;
      const item = root.ownerDocument.createElement('li');
      item.append(...child.childNodes);
      current.list.append(item);
      child.remove();
    }
  }
}

/** Mutates an inert clipboard container. No editor state or document globals required. */
export function cleanPasteDOM(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;
  root
    .querySelectorAll('script,style,meta,link,button,input:not([type="checkbox"]),select,textarea,option,nav,svg,iframe,object,embed,math,o\\:p')
    .forEach((node) => {
      node.remove();
    });
  wordLists(root);
  const comments = doc.createTreeWalker(root, 128);
  const discarded: Node[] = [];
  while (comments.nextNode()) discarded.push(comments.currentNode);
  for (const comment of discarded) comment.parentNode?.removeChild(comment);
  // Notion's exported checkboxes are empty styled divs rather than form inputs.
  for (const marker of root.querySelectorAll<HTMLElement>('.checkbox, [role="checkbox"]')) {
    const item = marker.closest('li');
    if (!item) continue;
    item.setAttribute('data-type', 'taskItem');
    item.setAttribute('data-checked', String(marker.classList.contains('checkbox-on') || marker.getAttribute('aria-checked') === 'true'));
    item.parentElement?.setAttribute('data-type', 'taskList');
    if (!marker.textContent?.trim()) marker.remove();
  }

  const linkContents = new WeakSet<Element>();
  for (const link of root.querySelectorAll('a')) {
    linkContents.add(link);
    for (const child of link.querySelectorAll('*')) linkContents.add(child);
  }
  const styledText = new Set('span p h1 h2 h3 h4 h5 h6 b strong i em u s strike del sup sub a font'.split(' '));
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*')).reverse()) {
    if (element.localName === 'input') {
      const item = element.closest('li');
      if (item && element.getAttribute('type') === 'checkbox') {
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', String(element.hasAttribute('checked')));
        item.parentElement?.setAttribute('data-type', 'taskList');
      }
      element.remove();
      continue;
    }
    const style = element.style;
    const insideLink = linkContents.has(element);
    const marks = [
      [/^(bold|[7-9]00)$/i.test(style.fontWeight), 'strong'],
      [style.fontStyle === 'italic', 'em'],
      [!insideLink && /underline/.test(style.textDecoration + style.textDecorationLine), 'u'],
      [/line-through/.test(style.textDecoration + style.textDecorationLine), 's'],
      [style.verticalAlign === 'super', 'sup'],
      [style.verticalAlign === 'sub', 'sub'],
    ] as const;
    for (const [enabled, tag] of marks) {
      if (!enabled || !styledText.has(element.localName) || element.localName === tag) continue;
      const wrapper = doc.createElement(tag);
      wrapper.append(...element.childNodes);
      element.append(wrapper);
    }
    const normalBold = element.localName === 'b' && /^(normal|400)$/.test(style.fontWeight);
    const attributes: Record<string, string> = {};
    if (element.localName === 'a') {
      const href = element.getAttribute('href');
      if (href && safePasteHref(href)) attributes.href = href;
    }
    if (element.localName === 'img') {
      if (!allowedURL(element.getAttribute('src') ?? '', ['http', 'https'])) {
        element.replaceWith(doc.createTextNode(element.getAttribute('alt') ?? ''));
        continue;
      }
      for (const key of ['src', 'alt', 'title', 'width', 'height']) {
        const value = element.getAttribute(key);
        if (value !== null && (!['width', 'height'].includes(key) || imageDimension(value) !== null)) attributes[key] = value;
      }
      for (const key of ['class', 'className']) {
        const value = imageClasses(element.getAttribute(key));
        if (value) attributes[key] = value;
      }
    }
    if (element.localName === 'code') {
      const language = element.className.match(/\blanguage-[\w+-]+\b/);
      if (language) attributes.class = language[0];
    }
    if (['th', 'td'].includes(element.localName)) {
      for (const key of ['colspan', 'rowspan']) {
        const value = element.getAttribute(key);
        if (value && /^\d+$/.test(value)) attributes[key] = value;
      }
      const align = style.textAlign || element.getAttribute('align');
      if (align && /^(left|center|right)$/.test(align)) attributes.align = align;
    }
    const start = element.getAttribute('start');
    if (element.localName === 'ol' && start && /^\d+$/.test(start)) attributes.start = start;
    const taskType = element.getAttribute('data-type');
    if (['li', 'ul'].includes(element.localName) && taskType && /^task(Item|List)$/.test(taskType)) {
      attributes['data-type'] = taskType;
      if (element.localName === 'li') attributes['data-checked'] = String(element.getAttribute('data-checked') === 'true');
    }
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (element.localName === 'div' && !element.querySelector(blocks)) {
      const paragraph = doc.createElement('p');
      paragraph.append(...element.childNodes);
      element.replaceWith(paragraph);
    } else if (!semanticTags.has(element.localName) || normalBold || (insideLink && element.localName === 'u'))
      element.replaceWith(...element.childNodes);
  }
  for (const paragraph of root.querySelectorAll('p')) {
    if (!paragraph.textContent?.replace(/[\s\u00a0]/g, '') && !paragraph.querySelector('img,hr')) paragraph.remove();
  }
  for (const item of root.querySelectorAll('li')) {
    const paragraph = item.firstElementChild;
    if (
      item.children.length === 1 &&
      paragraph?.localName === 'p' &&
      Array.from(item.childNodes).every((node) => node === paragraph || (node.nodeType === 3 && !node.textContent?.trim()))
    )
      paragraph.replaceWith(...paragraph.childNodes);
  }
  return root;
}

export function cleanPastedHTML(html: string): string {
  const root = document.implementation.createHTMLDocument('').createElement('div');
  root.innerHTML = html;
  return cleanPasteDOM(root).innerHTML;
}

export const CleanPaste = Extension.create<{ getUpload: () => ImageUploader | undefined }>({
  name: 'cleanPaste',
  // Consume URL replacements before Link's linkOnPaste handler links old text.
  priority: 1100,
  addOptions: () => ({ getUpload: () => undefined }),
  addProseMirrorPlugins() {
    const editor = this.editor;
    const getUpload = this.options.getUpload;
    const base = DOMSerializer.fromSchema(editor.schema);
    const serializer = new DOMSerializer(
      Object.fromEntries(
        Object.entries(base.nodes).map(([name, render]) => [
          name,
          (node: PMNode) => {
            const spec = DOMSerializer.renderSpec(document, render(node));
            if (spec.dom instanceof Element) {
              spec.dom.querySelector('.pl-callout-icon')?.remove();
              if (lastCopy) spec.dom.setAttribute('data-nibleaf-clipboard', lastCopy.nonce);
            }
            return spec;
          },
        ]),
      ),
      base.marks,
    );
    const uploads = new Map<string, { file: File; attributes: Record<string, unknown> }>();
    const rootFor = (html: string) => {
      const root = document.implementation.createHTMLDocument('').createElement('div');
      root.innerHTML = html;
      for (const image of root.querySelectorAll('img')) {
        if (
          !normalizedURL((image.getAttribute('src') ?? '').split(',', 1)[0] ?? '')
            ?.toLowerCase()
            .startsWith('data:')
        )
          continue;
        const file = fileFromPastedImage(image.getAttribute('src') ?? '');
        if (!file || !getUpload()) {
          image.replaceWith(root.ownerDocument.createTextNode(image.getAttribute('alt') ?? ''));
          continue;
        }
        const marker = `${IMAGE_UPLOAD_PLACEHOLDER_PREFIX}${crypto.randomUUID()}`;
        uploads.set(marker, {
          file,
          attributes: {
            alt: image.getAttribute('alt'),
            title: image.getAttribute('title'),
            width: imageDimension(image.getAttribute('width')),
            height: imageDimension(image.getAttribute('height')),
            class: imageClasses(image.getAttribute('class')),
            className: imageClasses(image.getAttribute('className')),
          },
        });
        image.setAttribute('src', marker);
      }
      return cleanPasteDOM(root);
    };
    const sanitize = (node: PMNode, internal = false): PMNode[] => {
      // Even a genuine internal copy must upload an existing inline raster image.
      if (node.type.name === 'legacyImage') {
        const attributes = imageAttributeNames
          .filter((key) => node.attrs[key] != null)
          .map((key) => `${key}="${escapeImageAttribute(node.attrs[key])}"`)
          .join(' ');
        return Array.from(DOMParser.fromSchema(editor.schema).parseSlice(rootFor(`<img ${attributes} />`)).content.content);
      }
      if (internal && ['mdxOpaqueBlock', 'mdxOpaqueInline'].includes(node.type.name)) return [node];
      if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') {
        const clean = DOMParser.fromSchema(editor.schema).parseSlice(rootFor(String(node.attrs.source ?? '')));
        if (node.isInline)
          return clean.content.textBetween(0, clean.content.size) ? [editor.schema.text(clean.content.textBetween(0, clean.content.size))] : [];
        return Array.from(clean.content.content);
      }
      const marks = node.marks.filter((mark) => mark.type.name !== 'link' || safePasteHref(String(mark.attrs.href ?? '')));
      if (node.isText) return [node.mark(marks)];
      const attrs = { ...node.attrs };
      if (typeof attrs.href === 'string' && !safePasteHref(attrs.href)) attrs.href = '';
      // Clipboard nodes cannot carry a raw-source cache around the allow list.
      if (!internal || unsafeSourceOpener(String(attrs.sourceOpen ?? '')))
        for (const key of ['sourceOpen', 'sourceClose', 'sourceOriginal']) if (key in attrs) attrs[key] = '';
      if (node.type.name === 'image') {
        if (
          normalizedURL(String(attrs.src ?? '').split(',', 1)[0] ?? '')
            ?.toLowerCase()
            .startsWith('data:')
        ) {
          const root = rootFor(`<img src="${escapeImageAttribute(attrs.src)}" alt="${escapeImageAttribute(attrs.alt)}" />`);
          return Array.from(DOMParser.fromSchema(editor.schema).parseSlice(root).content.content);
        }
        if (
          (String(attrs.src).startsWith(IMAGE_UPLOAD_PLACEHOLDER_PREFIX) && !uploads.has(String(attrs.src))) ||
          !allowedURL(String(attrs.src ?? ''), ['http', 'https'])
        )
          return [editor.schema.node('paragraph', null, attrs.alt ? editor.schema.text(String(attrs.alt)) : undefined)];
        attrs.width = imageDimension(attrs.width);
        attrs.height = imageDimension(attrs.height);
        attrs.class = imageClasses(attrs.class);
        attrs.className = imageClasses(attrs.className);
      }
      const content: PMNode[] = [];
      node.forEach((child) => {
        content.push(...sanitize(child, internal));
      });
      return [node.type.create(attrs, content, marks)];
    };
    const sanitizedSlice = (slice: Slice, internal = false) => {
      const content: PMNode[] = [];
      slice.content.forEach((node) => {
        content.push(...sanitize(node, internal));
      });
      return new Slice(Fragment.fromArray(content), slice.openStart, slice.openEnd);
    };
    const hasQueuedImages = (slice: Slice) => {
      let pending = false;
      slice.content.descendants((node) => {
        if (node.type.name === 'image' && uploads.has(node.attrs.src)) pending = true;
      });
      return pending;
    };
    // Both paste and HTML drop remove temporary images in the insertion transaction.
    // Only mapped widget anchors, never temporary URLs, reach document consumers.
    const insertWithUploads = (view: EditorView, tr: Transaction) => {
      const points: { pos: number; size: number; marker: string }[] = [];
      tr.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && uploads.has(node.attrs.src)) points.push({ pos, size: node.nodeSize, marker: node.attrs.src });
      });
      const mappingStart = tr.mapping.maps.length;
      for (const point of [...points].reverse()) tr.delete(point.pos, point.pos + point.size);
      const jobs = points.map((point) => ({ pos: tr.mapping.slice(mappingStart).map(point.pos, -1), job: uploads.get(point.marker) }));
      uploads.clear();
      view.dispatch(tr);
      const upload = getUpload();
      for (const { pos, job } of jobs) if (job && upload) void uploadEditorImage(editor, job.file, upload, pos, job.attributes);
    };
    return [
      new Plugin({
        props: {
          transformCopied: (slice) => {
            lastCopy = { nonce: crypto.randomUUID(), slice, text: '' };
            return slice;
          },
          clipboardSerializer: serializer,
          clipboardTextSerializer: (slice) => {
            // tiptap-markdown exposes this serializer at runtime but omits it
            // from its declarations. Use the same serializer as its clipboard plugin.
            const storage = editor.storage as typeof editor.storage & { markdown: { serializer: { serialize(content: Fragment): string } } };
            const text = storage.markdown.serializer.serialize(slice.content);
            if (lastCopy) lastCopy = { ...lastCopy, slice, text };
            return text;
          },
          handleDOMEvents: {
            paste(view, event) {
              if (!canEditImages(editor)) {
                event.preventDefault();
                return true;
              }
              const record = lastCopy;
              const html = event.clipboardData?.getData('text/html') ?? '';
              if (!record || event.clipboardData?.getData('text/plain') !== record.text || !html.includes(record.nonce)) return false;
              const root = document.implementation.createHTMLDocument('').createElement('div');
              root.innerHTML = html;
              if (!root.querySelector(`[data-nibleaf-clipboard="${record.nonce}"]`)) return false;
              // Rehydrate trusted nodes into this editor's schema, rather than parsing
              // clipboard HTML (which a different page may have changed).
              uploads.clear();
              const slice = sanitizedSlice(Slice.fromJSON(editor.schema, record.slice.toJSON()), true);
              event.preventDefault();
              insertWithUploads(view, view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste'));
              return true;
            },
          },
          transformPastedHTML: (html) => {
            uploads.clear();
            // DOM serialization leaves raw attribute line breaks intact. Encode
            // them before ProseMirror parses HTML again (and normalizes CR to LF).
            return rootFor(html).innerHTML.replace(/<img(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*\/?>/gi, (tag) =>
              tag.replace(/\n/g, '&#10;').replace(/\r/g, '&#13;'),
            );
          },
          transformPasted: (slice) => sanitizedSlice(slice),
          handleDrop(view, event, slice, moved) {
            if (!hasQueuedImages(slice)) return false;
            if (!canEditImages(editor)) return true;
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
            const tr = view.state.tr;
            const target = dropPoint(tr.doc, position, slice) ?? position;
            if (moved) tr.deleteSelection();
            const mapped = tr.mapping.map(target);
            insertWithUploads(view, tr.replaceRange(mapped, mapped, slice).setMeta('uiEvent', 'drop'));
            return true;
          },
          handlePaste(view, event, slice) {
            if (hasQueuedImages(slice)) {
              insertWithUploads(view, view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste'));
              return true;
            }
            const url = event.clipboardData?.getData('text/plain').trim() ?? '';
            if (!/^(https?:\/\/|mailto:)\S+$/i.test(url) || !safePasteHref(url)) return false;
            let parsed: URL;
            try {
              parsed = new URL(url);
            } catch {
              return false;
            }
            const { selection } = editor.state;
            if (
              !selection.empty &&
              /^(?:[a-z][\w+.-]*:|\/|\.{1,2}\/|www\.)|^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(
                editor.state.doc.textBetween(selection.from, selection.to),
              )
            ) {
              // Consume the paste before Link's own linkOnPaste handler can link
              // the old URL text. Preserve the normal parsed replacement slice.
              view.dispatch(view.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste'));
              return true;
            }
            const link = editor.schema.marks.link;
            if (
              !selection.empty &&
              !/^(?:[a-z][\w+.-]*:|\/|\.{1,2}\/|www\.)|^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(
                editor.state.doc.textBetween(selection.from, selection.to),
              ) &&
              selection instanceof TextSelection &&
              link &&
              selection.$from.parent.type.allowsMarkType(link) &&
              selection.$to.parent.type.allowsMarkType(link)
            ) {
              editor.chain().setLink({ href: url }).run();
              return true;
            }
            if (
              selection.empty &&
              selection.$from.parent.type.name === 'paragraph' &&
              !selection.$from.parent.content.size &&
              /^https?:\/\//i.test(url) &&
              /\.(png|jpe?g|gif|webp|avif|ico)$/i.test(parsed.pathname)
            ) {
              editor.commands.setImage({ src: url });
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
