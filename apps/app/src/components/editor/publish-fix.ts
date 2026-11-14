import type { MessageKey } from '@nibleaf/i18n';
import { isLocatablePublishCheck, type PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
import { readerEmbedSource } from '@nibleaf/shared/reader-embeds';
import { videoPageUrl } from '@nibleaf/shared/video-embeds';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';

/*
 * A publish check's Fix, on the editor's side (P1-ED-002). The publish sheet
 * opens `editor?page=<id>&fix=<code>&fixTarget=<evidence>`
 * (`@nibleaf/shared/publish-check-codes`). The evidence is what the server's
 * checks read in the page's Markdown, so it is found here in the document the
 * editor shows: by the link mark, the node or the text that carries it. There
 * is no line number to go by, and every occurrence counts (a link written
 * twice is two places to fix).
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

/** An address the evidence may be, as the node or mark holds it. */
interface Address {
  value: string;
  role: 'href' | 'src' | 'poster';
}

/** Authored HTML or MDX attributes inside a block the editor keeps as source. */
const SOURCE_ATTRIBUTE = /\b(href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** Markdown link and image destinations inside such a block. */
const SOURCE_DESTINATION = /(!?)\]\(\s*<?([^\s)>]+)/g;

const decodeEntities = (value: string): string =>
  value.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_entity, name: string) =>
    name === 'amp' ? '&' : name === 'quot' ? '"' : name === 'lt' ? '<' : name === 'gt' ? '>' : "'",
  );

const sourceAddresses = (source: string): Address[] => {
  const found: Address[] = [];
  for (const [, name, double, single] of source.matchAll(SOURCE_ATTRIBUTE)) {
    found.push({ value: decodeEntities(double ?? single ?? ''), role: (name ?? '').toLowerCase() as Address['role'] });
  }
  for (const [, image, url] of source.matchAll(SOURCE_DESTINATION)) found.push({ value: url ?? '', role: image ? 'src' : 'href' });
  return found;
};

/** The addresses one node holds: its own `href`/`src`/`poster`, and those in the source it keeps (an embed, an opaque block). */
const nodeAddresses = (node: PMNode): Address[] => {
  const attrs = node.attrs as Record<string, unknown>;
  const found: Address[] = [];
  for (const role of ['href', 'src', 'poster'] as const) {
    const value = attrs[role];
    if (typeof value === 'string' && value) found.push({ value, role });
  }
  if (typeof attrs.source === 'string' && attrs.source) found.push(...sourceAddresses(attrs.source));
  return found;
};

/** The address as the checks report an embed shown as a link: its parsed URL, or the text the reader shows. */
const embedLinkAddress = (value: string): string | null => {
  const source = readerEmbedSource(value);
  return source?.kind === 'link' ? source.url.href : source?.kind === 'text' ? source.text : null;
};

/** The address as the checks report a provider video: the provider's own page. */
const videoPageAddress = (value: string): string | null => {
  const source = readerEmbedSource(value);
  return source?.kind === 'video' ? videoPageUrl(source.video) : null;
};

/** Whether `address` is the evidence `target` of a check `code`. */
const addressMatches = (code: PublishCheckCode, address: Address, target: string): boolean => {
  const value = address.value.trim();
  switch (code) {
    case 'broken-internal-link':
      return address.role === 'href' && value === target;
    case 'missing-alt':
    case 'video-not-https':
      return address.role === 'src' && value === target;
    case 'video-poster-hidden':
      return address.role === 'poster' && value === target;
    case 'embed-as-link':
      return address.role !== 'poster' && (value === target || embedLinkAddress(value) === target);
    case 'embed-untitled':
      return address.role === 'src' && (value === target || videoPageAddress(value) === target);
    case 'embed-unclosed':
      return address.role === 'src' && value === target;
    default:
      return false;
  }
};

const STRAY = /^(?:\/|-{3,})$/;
const IFRAME = '<iframe';

const linkHref = (marks: readonly Mark[]): string | null => {
  const link = marks.find((mark) => mark.type.name === 'link');
  return typeof link?.attrs.href === 'string' ? link.attrs.href : null;
};

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
  const unclosedFrame = code === 'embed-unclosed';
  doc.descendants((node, pos) => {
    if (code === 'stray-characters') {
      if (!node.isTextblock) return true;
      const text = node.textContent.trim();
      if (STRAY.test(text) && (text === target || (target.startsWith('-') && text.startsWith('-')))) {
        matches.push({ from: pos + 1, to: pos + node.nodeSize - 1, node: false });
      }
      return false;
    }
    if (node.isText) {
      const href = linkHref(node.marks);
      if (href !== null && addressMatches(code, { value: href, role: 'href' }, target)) addText(pos, pos + node.nodeSize);
      // An iframe without its closer can reach the editor as text.
      else if (unclosedFrame && node.text?.includes(IFRAME) && (target === '<iframe>' || node.text.includes(target))) {
        const at = node.text.indexOf(IFRAME);
        addText(pos + at, pos + node.nodeSize);
      }
      return false;
    }
    const source = typeof node.attrs.source === 'string' ? node.attrs.source : '';
    const hit = unclosedFrame
      ? source.includes(IFRAME) && (target === '<iframe>' || nodeAddresses(node).some((address) => addressMatches(code, address, target)))
      : nodeAddresses(node).some((address) => addressMatches(code, address, target));
    if (hit) {
      matches.push({ from: pos, to: pos + node.nodeSize, node: true });
      return false;
    }
    return true;
  });
  return matches;
}
