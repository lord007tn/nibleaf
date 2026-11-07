import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';

const semanticTags = new Set(
  'p h1 h2 h3 h4 h5 h6 strong b em i u s strike del sup sub mark a ul ol li blockquote pre code table thead tbody tfoot tr th td img hr br'.split(
    ' ',
  ),
);
const blocks = 'p,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,div,hr';

/** Clipboard links may be relative, but may never introduce an active URL scheme. */
export function safePasteHref(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers ignore ASCII controls in URL schemes; reject obfuscated active links too.
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, '');
  return !/^[a-z][a-z\d+.-]*:/i.test(compact) || /^(https?:|mailto:|tel:)/i.test(compact);
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
    const stack: { list: HTMLOListElement | HTMLUListElement; level: number; id: string }[] = [];
    for (const child of Array.from(parent.children)) {
      const match = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(child.getAttribute('style') ?? '');
      if (child.tagName !== 'P' || !match) {
        stack.length = 0;
        continue;
      }
      const supportGlyph = removeSupportListMarkers(child);
      const markers = Array.from(child.querySelectorAll<HTMLElement>('span')).filter((span) =>
        /mso-list:\s*ignore/i.test(span.getAttribute('style') ?? ''),
      );
      const glyph = (supportGlyph ?? markers[0]?.textContent ?? child.textContent ?? '').trimStart();
      const number = /^(\d+|[a-z]|[ivxlcdm]+)[.)]/i.exec(glyph);
      const kind = number ? 'ol' : 'ul';
      const level = Number(match[2]);
      const id = match[1] ?? '';
      for (const marker of markers) marker.remove();
      if (supportGlyph === null && !markers.length) {
        // Some Word versions put the marker in an unstyled leading span/text node.
        const walker = root.ownerDocument.createTreeWalker(child, 4);
        const first = walker.nextNode();
        if (first) first.textContent = (first.textContent ?? '').replace(/^\s*(?:(?:\d+|[a-z]|[ivxlcdm]+)[.)]\s+|[•·▪○\uf0b7]\s*|o\s+)/i, '');
      }
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
      if (!current || current.level !== level || current.list.localName !== kind) {
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
  root.querySelectorAll('script,style,meta,link,form,button,nav,o\\:p').forEach((node) => {
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
    const insideLink = element.closest('a') !== null;
    const marks = [
      [/^(bold|[7-9]00)$/i.test(style.fontWeight), 'strong'],
      [style.fontStyle === 'italic', 'em'],
      [!insideLink && /underline/.test(style.textDecoration + style.textDecorationLine), 'u'],
      [/line-through/.test(style.textDecoration + style.textDecorationLine), 's'],
      [style.verticalAlign === 'super', 'sup'],
      [style.verticalAlign === 'sub', 'sub'],
    ] as const;
    for (const [enabled, tag] of marks) {
      if (!enabled || element.localName === tag) continue;
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
      for (const key of ['src', 'alt', 'title', 'width']) {
        const value = element.getAttribute(key);
        if (
          value !== null &&
          (key !== 'src' || !/^[a-z][a-z\d+.-]*:/i.test(value) || /^(https?:|data:image\/(?:png|jpeg|gif|webp|avif|x-icon);)/i.test(value))
        )
          attributes[key] = value;
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
      if (align && /^(left|center|right)$/.test(align)) attributes.style = `text-align: ${align}`;
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

export const CleanPaste = Extension.create({
  name: 'cleanPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          transformPastedHTML: cleanPastedHTML,
          handlePaste(_view, event) {
            const url = event.clipboardData?.getData('text/plain').trim() ?? '';
            if (!/^(https?:\/\/|mailto:|tel:|\/|\.{1,2}\/)\S+$/i.test(url) || !safePasteHref(url)) return false;
            const { selection } = editor.state;
            const link = editor.schema.marks.link;
            if (
              !selection.empty &&
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
              /^https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|avif|ico)(?:[?#][^\s]*)?$/i.test(url)
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
