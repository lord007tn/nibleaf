import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { allowedURL, escapeImageAttribute, imageClasses, imageDimension, isLegacyImageSource } from './html-safety';
import { decodeMdxSource, encodeMdxSource } from './mdx-roundtrip';

export const imageAttributeNames = ['src', 'alt', 'title', 'width', 'height', 'class', 'className'] as const;
const imageParsers = new WeakSet<object>();
// loading/decoding are browser delivery hints, never styling or executable content.
const sourceAttributes = new Set<string>([...imageAttributeNames.map((name) => name.toLowerCase()), 'loading', 'decoding']);

export function sourceImageAttribute(element: HTMLElement, name: string): string | null {
  const source = decodeMdxSource(element.getAttribute('data-mdx-source-open'));
  // tiptap-markdown serializes its intermediate DOM back to HTML. That turns
  // encoded CR into a literal CR, which the next HTML parse normalizes to LF.
  // Recover CR-bearing values from the preserved, safely escaped opening tag.
  if (!/&#(?:0*13|x0*d);/i.test(source)) return element.getAttribute(name);
  const root = document.implementation.createHTMLDocument('').createElement('div');
  root.innerHTML = source;
  return root.querySelector('img')?.getAttribute(name) ?? element.getAttribute(name);
}

function imageValue(name: string, value: unknown, preserveData = false): string | number | null {
  if (value === null || value === undefined) return null;
  if (name === 'width' || name === 'height') return imageDimension(value);
  if (name === 'class' || name === 'classname') return imageClasses(value);
  if (name === 'src' && !(preserveData && isLegacyImageSource(String(value))) && !allowedURL(String(value), ['http', 'https'])) return null;
  return String(value);
}

/** Preserve safe, untouched attribute spelling/order, but never replay unsafe cached HTML. */
export function safeImageTag(raw: string, overrides: Record<string, unknown> = {}, preserveData = false): string {
  const container = document.implementation.createHTMLDocument('').createElement('div');
  container.innerHTML = raw;
  const image = container.querySelector('img');
  if (!image) return '';
  const opening = /^<img\b/i.exec(raw)?.[0] ?? '<img';
  const attributes = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  attributes.lastIndex = opening.length;
  let result = opening;
  let end = opening.length;
  const seen = new Set<string>();
  for (let match = attributes.exec(raw); match; match = attributes.exec(raw)) {
    const spelling = match[1] ?? '';
    const name = spelling.toLowerCase();
    const key = name === 'classname' ? 'className' : name;
    const original = image.getAttribute(name);
    const value = imageValue(name, Object.hasOwn(overrides, key) ? overrides[key] : original, preserveData);
    if (sourceAttributes.has(name) && !seen.has(name) && value !== null) {
      const encoded = match[2] ?? match[3] ?? match[4] ?? '';
      const unsafeEncoding = /[\r\n"<>]/.test(encoded) || /&(?!(?:[a-z][a-z\d]*|#\d+|#x[\da-f]+);)/i.test(encoded);
      const unchanged = name === 'width' || name === 'height' ? imageDimension(original) === value : String(value) === original;
      result += unchanged && !unsafeEncoding ? match[0] : `${/^\s+/.exec(match[0])?.[0] ?? ' '}${spelling}="${escapeImageAttribute(value)}"`;
    }
    seen.add(name);
    end = attributes.lastIndex;
  }
  for (const key of imageAttributeNames) {
    if (seen.has(key.toLowerCase()) || !Object.hasOwn(overrides, key)) continue;
    const value = imageValue(key.toLowerCase(), overrides[key]);
    if (value !== null) result += ` ${key}="${escapeImageAttribute(value)}"`;
  }
  const tail = raw.slice(end);
  return result + (/^\s*\/?>$/.test(tail) ? tail : ' />');
}

/** Capture authored HTML before the DOM lowercases className and normalizes quotes/order. */
export const setupImageSource: NonNullable<MarkdownNodeSpec['parse']>['setup'] = (markdownit) => {
  if (imageParsers.has(markdownit)) return;
  // Existing inline images have a separate preservation node. New clipboard
  // images still pass through the upload policy, never this source-only path.
  for (const rule of ['html_block', 'html_inline', 'image']) {
    const render = markdownit.renderer.rules[rule];
    if (!render) continue;
    markdownit.renderer.rules[rule] = (...args) =>
      render(...args).replace(/<img(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*\/?>/gi, (raw) => {
        const container = document.implementation.createHTMLDocument('').createElement('div');
        container.innerHTML = raw;
        const image = container.querySelector('img');
        const src = image?.getAttribute('src') ?? '';
        // Only the saved-source parser creates this compatibility node. Clipboard slices
        // are scrubbed separately, and regular image nodes never accept base64.
        if (isLegacyImageSource(src))
          return safeImageTag(raw, {}, true).replace(
            /\s*\/?>$/,
            (ending) =>
              ` data-nibleaf-legacy="true"${rule === 'image' ? ' data-nibleaf-markdown-image="true"' : ''} data-mdx-source-open="${encodeMdxSource(safeImageTag(raw, {}, true))}"${ending}`,
          );
        if (!allowedURL(src, ['http', 'https'])) return escapeImageAttribute(image?.getAttribute('alt') ?? '');
        if (rule === 'image') return raw;
        const safe = safeImageTag(raw);
        return safe.replace(/\s*\/?>$/, (ending) => ` data-mdx-source-open="${encodeMdxSource(safe)}"${ending}`);
      });
  }
  imageParsers.add(markdownit);
};

/** The snapshot uses parsed values, so equivalent spellings such as width='0480' remain untouched. */
export function snapshotImageSource(element: HTMLElement) {
  for (const image of element.querySelectorAll<HTMLImageElement>('img[data-mdx-source-open]')) {
    const original = Object.fromEntries(imageAttributeNames.map((name) => [name, imageValue(name.toLowerCase(), sourceImageAttribute(image, name))]));
    image.setAttribute('data-mdx-source-original', encodeMdxSource(JSON.stringify(original)));
  }
}
