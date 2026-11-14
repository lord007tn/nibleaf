import type { MessageKey } from '@nibleaf/i18n';
import { isLocatablePublishCheck, type PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
import { readerEmbedSource } from '@nibleaf/shared/reader-embeds';
import { isAllowedMediaUrl, isSiteMediaPath, videoPageUrl } from '@nibleaf/shared/video-embeds';
import type { Node as PMNode } from '@tiptap/pm/model';

/*
 * A publish check's Fix, on the editor's side (P1-ED-002). The publish sheet
 * opens `editor?page=<id>&fix=<code>&fixTarget=<evidence>`
 * (`@nibleaf/shared/publish-check-codes`). The evidence is what the server's
 * checks read in the page's Markdown, so it is found here in the document the
 * editor shows: by the link mark, the node or the text that carries it. There
 * is no line number to go by, and every occurrence counts (a link written
 * twice is two places to fix).
 *
 * Each code is matched only where its check looks (`collectFacts` and
 * `collectEmbed` in `@nibleaf/shared/publish-checks`): never in code (a code
 * block, inline code, a fence or a code span kept in an opaque block), in an
 * HTML comment, an MDX expression or module, or inside the elements the reader
 * never renders links in (`<script>`, `<iframe>`, …). The count in the bar is
 * the number of places the check's rule finds on the page.
 */

/** One place in the document that carries the evidence: a text range (a link,
 *  stray text) or a whole node (an image, a video, an opaque block). */
export interface FixMatch {
  from: number;
  to: number;
  node: boolean;
}

/** Where a page-level check sends the writer. `null`: nowhere to focus, the bar explains. */
type PageLevelTarget = 'title' | 'body' | 'address' | null;

const PAGE_LEVEL_TARGETS: Partial<Record<PublishCheckCode, PageLevelTarget>> = {
  'untitled-page': 'title',
  'duplicate-title': 'title',
  'empty-page': 'body',
  'unreadable-slug': 'address',
  'home-untranslated': null,
  'blog-root-group': null,
};

/** Where a page-level check focuses (null for none, and for a check found by its evidence). */
export const pageLevelFixTarget = (code: PublishCheckCode): PageLevelTarget => PAGE_LEVEL_TARGETS[code] ?? null;

/** The bar's name for one problem of each kind (the publish sheet's group titles are plural). */
export const FIX_LABELS: Record<PublishCheckCode, MessageKey> = {
  'broken-internal-link': 'editor.fix.label.brokenLink',
  'missing-alt': 'editor.fix.label.missingAlt',
  'untitled-page': 'editor.fix.label.untitledPage',
  'stray-characters': 'editor.fix.label.strayCharacters',
  'unreadable-slug': 'editor.fix.label.unreadableSlug',
  'empty-page': 'editor.fix.label.emptyPage',
  'duplicate-title': 'editor.fix.label.duplicateTitle',
  'embed-untitled': 'editor.fix.label.embedUntitled',
  'embed-as-link': 'editor.fix.label.embedAsLink',
  'video-not-https': 'editor.fix.label.videoNotHttps',
  'embed-unclosed': 'editor.fix.label.embedUnclosed',
  'video-poster-hidden': 'editor.fix.label.videoPosterHidden',
  'home-untranslated': 'editor.fix.label.homeUntranslated',
  'blog-root-group': 'editor.fix.label.blogRootGroup',
};

/** What to do about a page-level problem, said in the bar. Locatable checks show their evidence instead. */
export const FIX_EXPLANATIONS: Partial<Record<PublishCheckCode, MessageKey>> = {
  'untitled-page': 'editor.fix.explain.untitledPage',
  'duplicate-title': 'editor.fix.explain.duplicateTitle',
  'empty-page': 'editor.fix.explain.emptyPage',
  'unreadable-slug': 'editor.fix.explain.unreadableSlug',
  'home-untranslated': 'editor.fix.explain.homeUntranslated',
  'blog-root-group': 'editor.fix.explain.blogRootGroup',
};

/** One thing on the page a check reads: a link, an image, an iframe, a video or a video source. */
interface Element {
  tag: 'a' | 'img' | 'iframe' | 'video' | 'source';
  attrs: ReadonlyMap<string, string>;
  /** An iframe followed by its closer (the reader shows only those). */
  closed: boolean;
  /** Where it starts and ends in the text it was read from (for an iframe left as text). */
  start: number;
  end: number;
}

/** An attribute written as an expression (`alt={caption}`): set, with no text to read. */
const EXPRESSION = '\u0000expression';

/** Raw HTML or MDX the reader never renders as content: code, comments, and the inside of
 *  `<script>`, `<style>`, `<iframe>` and the other contexts the checks skip. Blanked, so offsets stay. */
const NOT_CONTENT = [/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, /(`+)[^`]+?\1/g, /<!--[\s\S]*?(?:-->|(?![\s\S]))/g];
/** An element whose inside the reader never renders as content; its opening tag stays (an iframe's `src`). */
const SKIPPED_INSIDE = /(<(script|style|textarea|template|noscript|title|iframe)\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(?=<\/\2\s*>)/gi;
const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
const contentOf = (source: string): string =>
  NOT_CONTENT.reduce((text, pattern) => text.replace(pattern, blank), source).replace(
    SKIPPED_INSIDE,
    (_match, opener: string, _name: string, inside: string) => opener + blank(inside),
  );

const TAG = /<([A-Za-z][\w:.-]*)((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*)\/?>/g;
const ATTRIBUTE = /([^\s=/>"'{]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\})))?/g;
const DESTINATION = /(!?)\[([^\]]*)\]\(\s*<?([^\s)>]+)/g;

const decodeEntities = (value: string): string =>
  value.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_entity, name: string) =>
    name === 'amp' ? '&' : name === 'quot' ? '"' : name === 'lt' ? '<' : name === 'gt' ? '>' : "'",
  );

const readAttributes = (text: string): Map<string, string> => {
  const attrs = new Map<string, string>();
  for (const [, name, double, single, expression] of text.matchAll(ATTRIBUTE)) {
    if (!name) continue;
    const value = expression ? EXPRESSION : decodeEntities(double ?? single ?? '');
    attrs.set(name.toLowerCase(), value);
  }
  return attrs;
};

const ELEMENT_TAGS = new Set(['a', 'img', 'iframe', 'video', 'source']);

/** The links, images, iframes and videos written in raw HTML/MDX (an opaque block, an embed's source). */
function sourceElements(source: string): Element[] {
  const content = contentOf(source);
  const found: Element[] = [];
  let videoOpen = false;
  for (const match of content.matchAll(TAG)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const name = (match[1] ?? '').toLowerCase();
    const attrs = readAttributes(match[2] ?? '');
    if (name === 'video') videoOpen = true;
    // Components whose reader contract declares an `href` render a link too (a Card).
    const tag = ELEMENT_TAGS.has(name) ? (name as Element['tag']) : attrs.has('href') ? 'a' : null;
    if (!tag || (tag === 'source' && !videoOpen)) continue;
    found.push({ tag, attrs, closed: tag !== 'iframe' || /<\/iframe\s*>/i.test(content.slice(end)), start, end });
  }
  for (const match of content.matchAll(DESTINATION)) {
    const start = match.index ?? 0;
    const attrs = new Map(
      match[1]
        ? [
            ['src', match[3] ?? ''],
            ['alt', match[2] ?? ''],
          ]
        : [['href', match[3] ?? '']],
    );
    found.push({ tag: match[1] ? 'img' : 'a', attrs, closed: true, start, end: start + match[0].length });
  }
  return found;
}

const attr = (element: Element, name: string): string => {
  const value = element.attrs.get(name) ?? '';
  return value === EXPRESSION ? value : value.trim();
};

/** The address as the checks report an iframe shown as a link: its parsed URL, or the text the reader shows. */
const embedLinkAddress = (src: string): string | null => {
  const source = readerEmbedSource(src);
  return source?.kind === 'link' ? source.url.href : source?.kind === 'text' ? source.text : null;
};

/** The address as the checks report a provider video: the provider's own page. */
const videoPageAddress = (src: string): string | null => {
  const source = readerEmbedSource(src);
  return source?.kind === 'video' ? videoPageUrl(source.video) : null;
};

/** Whether `element` is a problem of check `code` with evidence `target`, by the check's own rule. */
function elementMatches(code: PublishCheckCode, element: Element, target: string): boolean {
  switch (code) {
    case 'broken-internal-link': {
      const href = attr(element, 'href');
      return element.tag === 'a' && href !== EXPRESSION && href === target;
    }
    case 'missing-alt':
      return element.tag === 'img' && !attr(element, 'alt') && attr(element, 'src') === target;
    case 'video-poster-hidden': {
      const poster = attr(element, 'poster');
      return element.tag === 'video' && poster === target && !isSiteMediaPath(poster);
    }
    case 'video-not-https': {
      const src = attr(element, 'src');
      return (element.tag === 'video' || element.tag === 'source') && src === target && !isAllowedMediaUrl(src);
    }
    case 'embed-as-link':
      return element.tag === 'iframe' && element.closed && embedLinkAddress(attr(element, 'src')) === target;
    case 'embed-untitled':
      return element.tag === 'iframe' && element.closed && !attr(element, 'title') && videoPageAddress(attr(element, 'src')) === target;
    case 'embed-unclosed':
      return element.tag === 'iframe' && !element.closed && (attr(element, 'src') || '<iframe>') === target;
    default:
      return false;
  }
}

/** Opaque ranges the checks never read: code, comments, MDX expressions and modules. */
const SILENT_OPAQUE = new Set(['Code', 'HTML comment', 'Expression', 'MDX module']);
const OPAQUE = new Set(['mdxOpaqueBlock', 'mdxOpaqueInline']);
const IMAGES = new Set(['image', 'legacyImage']);
const STRAY = /^(?:\/|-{3,})$/;
const HTML_STRAY_PARAGRAPH = /<p>\s*(\/|-{3,})\s*<\/p>/gi;

const isCode = (node: PMNode): boolean => node.marks.some((mark) => mark.type.name === 'code');
const linkHref = (node: PMNode): string | null => {
  const link = node.marks.find((mark) => mark.type.name === 'link');
  return typeof link?.attrs.href === 'string' ? link.attrs.href : null;
};
const strayEvidence = (text: string): string => (text.startsWith('-') ? '---' : '/');

/** A paragraph's text as the check reads it: its text, without inline code or anything opaque. */
const paragraphText = (paragraph: PMNode): string => {
  let text = '';
  paragraph.descendants((child) => {
    if (child.isText && !isCode(child)) text += child.text ?? '';
    return !OPAQUE.has(child.type.name);
  });
  return text;
};

/** The elements a node carries: an image, the Video/Embed block, a component's `href`, an opaque block's source. */
function nodeElements(node: PMNode): Element[] {
  const attrs = node.attrs as Record<string, unknown>;
  const text = (name: string) => (typeof attrs[name] === 'string' ? (attrs[name] as string) : '');
  const at = { closed: true, start: 0, end: 0 };
  if (IMAGES.has(node.type.name))
    return [
      {
        tag: 'img',
        attrs: new Map([
          ['src', text('src')],
          ['alt', text('alt')],
        ]),
        ...at,
      },
    ];
  if (node.type.name === 'videoEmbed') {
    // The block's own values (the writer may have changed them), and what else its source holds (a poster, sources).
    const kind = text('kind') === 'video' ? 'video' : 'iframe';
    const authored = sourceElements(text('source'));
    const media = authored.find((element) => element.tag === kind);
    const values = new Map(media?.attrs ?? []);
    values.set('src', text('src'));
    if (kind === 'iframe') values.set('title', text('title'));
    return [{ tag: kind, attrs: values, ...at }, ...authored.filter((element) => element.tag === 'source')];
  }
  if (OPAQUE.has(node.type.name)) return SILENT_OPAQUE.has(text('name')) ? [] : sourceElements(text('source'));
  const href = text('href');
  return href ? [{ tag: 'a', attrs: new Map([['href', href]]), ...at }] : [];
}

/**
 * Every place in `doc` that carries `target`, the evidence of check `code`, in
 * document order. One walk over the document (linear in its size): it runs
 * once on arrival and again on Next, never per keystroke.
 */
export function findFixMatches(doc: PMNode, code: PublishCheckCode, rawTarget: string): FixMatch[] {
  const target = rawTarget.trim();
  if (!target || !isLocatablePublishCheck(code)) return [];
  const matches: FixMatch[] = [];
  // A link written with formatting inside spans several text nodes: one range.
  const addText = (from: number, to: number) => {
    const last = matches.at(-1);
    if (last && !last.node && last.to === from) last.to = to;
    else matches.push({ from, to, node: false });
  };
  doc.descendants((node, pos) => {
    // A code block is code: nothing in it renders as a link, an image, an embed or stray text.
    if (node.type.name === 'codeBlock') return false;
    if (node.isText) {
      if (isCode(node)) return false;
      const href = linkHref(node);
      if (code === 'broken-internal-link' && href !== null && href.trim() === target) addText(pos, pos + node.nodeSize);
      // An iframe without its closer can reach the editor as text.
      if (code === 'embed-unclosed' && node.text?.includes('<iframe')) {
        for (const element of sourceElements(node.text)) {
          if (elementMatches(code, element, target)) addText(pos + element.start, pos + element.end);
        }
      }
      return false;
    }
    if (code === 'stray-characters') {
      // Without GFM (as the check parses) a table is one paragraph of pipes, never a stray character.
      if (node.type.name === 'table') return false;
      if (node.type.name === 'paragraph') {
        const text = paragraphText(node).trim();
        if (STRAY.test(text) && strayEvidence(text) === target) matches.push({ from: pos + 1, to: pos + node.nodeSize - 1, node: false });
        return false;
      }
      if (OPAQUE.has(node.type.name) && !SILENT_OPAQUE.has(String(node.attrs.name ?? ''))) {
        const html = contentOf(String(node.attrs.source ?? ''));
        if ([...html.matchAll(HTML_STRAY_PARAGRAPH)].some(([, text]) => strayEvidence(text ?? '') === target)) {
          matches.push({ from: pos, to: pos + node.nodeSize, node: true });
        }
        return false;
      }
      return true;
    }
    if (nodeElements(node).some((element) => elementMatches(code, element, target))) {
      matches.push({ from: pos, to: pos + node.nodeSize, node: true });
      return false;
    }
    return !OPAQUE.has(node.type.name);
  });
  return matches;
}
