import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { encodeMdxSource } from './mdx-roundtrip';

export const imageAttributeNames = ['src', 'alt', 'title', 'width', 'height', 'class', 'className'] as const;
const imageParsers = new WeakSet<object>();

/** Capture authored HTML before the DOM lowercases className and normalizes quotes/order. */
export const setupImageSource: NonNullable<MarkdownNodeSpec['parse']>['setup'] = (markdownit) => {
  if (imageParsers.has(markdownit)) return;
  for (const rule of ['html_block', 'html_inline']) {
    const render = markdownit.renderer.rules[rule];
    if (!render) continue;
    markdownit.renderer.rules[rule] = (...args) =>
      render(...args).replace(/<img(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*\/?>/gi, (raw) =>
        raw.replace(/\s*\/?>$/, (ending) => ` data-mdx-source-open="${encodeMdxSource(raw)}"${ending}`),
      );
  }
  imageParsers.add(markdownit);
};

/** The snapshot uses parsed values, so equivalent spellings such as width='0480' remain untouched. */
export function snapshotImageSource(element: HTMLElement, parseDimension: (value: unknown, key: string) => number | '100%' | null) {
  for (const image of element.querySelectorAll('img[data-mdx-source-open]')) {
    const original = Object.fromEntries(
      imageAttributeNames.map((name) => [
        name,
        name === 'width' || name === 'height' ? parseDimension(image.getAttribute(name), name) : image.getAttribute(name),
      ]),
    );
    image.setAttribute('data-mdx-source-original', encodeMdxSource(JSON.stringify(original)));
  }
}
