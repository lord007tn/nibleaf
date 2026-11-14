import type { MessageKey } from '@nibleaf/i18n';
import type { PageContentFacts } from '@nibleaf/shared/page-content-facts';
import { isLocatablePublishCheck, type LOCATABLE_PUBLISH_CHECK_CODES, type PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
import { readerEmbedSource } from '@nibleaf/shared/reader-embeds';
import { videoPageUrl } from '@nibleaf/shared/video-embeds';
import type { Node as PMNode } from '@tiptap/pm/model';

/*
 * A publish check's Fix, on the editor's side (P1-ED-002). The publish sheet
 * opens `editor?page=<id>&fix=<code>&fixTarget=<evidence>`
 * (`@nibleaf/shared/publish-check-codes`). The evidence is what the check read
 * in the page's Markdown.
 *
 * Two questions, answered separately so they can never disagree with the check:
 * - HOW MANY places have the problem: the check's own reading of the page
 *   (`collectPageContentFacts`, the code the publish checks run), on the page's
 *   current Markdown (`loadFixCounter`). The editor never re-implements the check.
 * - WHERE each one is, in document order (`findFixMatches`): the exact
 *   characters or node that make up the finding, and nothing around them, so
 *   replacing or deleting the selection removes only the finding. A finding
 *   inside a block the editor keeps as written (an MDX module, an unsupported
 *   component, raw HTML) is only marked and scrolled to, never selected: the
 *   block holds other content. Code is never a place.
 * A finding that can't be placed is still counted: the bar says how many were
 * highlighted, never a smaller total.
 */

/** One place in the document that carries the evidence: a text range (a link,
 *  stray text), a node that is the finding (an image, an embed, a Card), or a
 *  block the editor keeps as written with the finding somewhere inside it. */
export interface FixMatch {
  from: number;
  to: number;
  node: boolean;
  /** Inside a block kept as written (an MDX module, an unsupported component,
   *  raw HTML): never selected, since that would take its other content with it. */
  inside: boolean;
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

type LocatableCode = (typeof LOCATABLE_PUBLISH_CHECK_CODES)[number];

/** Where each locatable check's evidence comes from in the check's reading of a page. */
const FACT_FIELDS: Record<LocatableCode, keyof PageContentFacts> = {
  'broken-internal-link': 'links',
  'missing-alt': 'imagesWithoutAlt',
  'video-poster-hidden': 'hiddenPosters',
  'video-not-https': 'insecureVideos',
  'embed-as-link': 'embedsAsLinks',
  'embed-untitled': 'untitledEmbeds',
  'embed-unclosed': 'unclosedEmbeds',
  'stray-characters': 'strayText',
};

type FactsModule = typeof import('@nibleaf/shared/page-content-facts');
let factsModule: Promise<FactsModule> | undefined;
/** The check's page reading (its Markdown and HTML parsers), loaded the first time a Fix arrives. */
const loadFacts = () => {
  factsModule ??= import('@nibleaf/shared/page-content-facts');
  return factsModule;
};
/** How many findings of one check, with one evidence, a piece of Markdown holds, by the check's own reading. */
export type FixCounter = (markdown: string) => number;

/** The texts read last (the whole page, and the blocks kept as source): Next asks again for the same ones. */
const FACTS_MEMO_LIMIT = 64;
const factsMemo = new Map<string, PageContentFacts>();

/**
 * The publish check's own count of `target` for `code`, for any Markdown: the
 * whole page (the bar's total) or one block the editor keeps as source. Null
 * when the check's reading can't be loaded.
 */
export async function loadFixCounter(code: PublishCheckCode, target: string): Promise<FixCounter | null> {
  if (!isLocatablePublishCheck(code)) return null;
  try {
    const { collectPageContentFacts } = await loadFacts();
    const field = FACT_FIELDS[code as LocatableCode];
    return (markdown) => {
      let facts = factsMemo.get(markdown);
      if (!facts) {
        facts = collectPageContentFacts(markdown);
        if (factsMemo.size >= FACTS_MEMO_LIMIT) factsMemo.delete(factsMemo.keys().next().value ?? '');
        factsMemo.set(markdown, facts);
      }
      return facts[field].filter((detail) => detail === target).length;
    };
  } catch {
    return null;
  }
}

/** Blocks the editor keeps whole whose text the check never reads as content. */
const UNREAD_OPAQUE = new Set(['Code', 'HTML comment']);
const OPAQUE = new Set(['mdxOpaqueBlock', 'mdxOpaqueInline']);
const IMAGES = new Set(['image', 'legacyImage']);
const STRAY = /^(?:\/|-{3,})$/;
const HTML_STRAY_PARAGRAPH = /<p>[ \t\n]*(\/|-{3,})[ \t\n]*<\/p>/gi;
/** What may stand right before and after an address written in raw HTML or Markdown. */
const OPENS_ADDRESS = new Set(['"', "'", '(', '<', '=', ' ', '\t', '\n']);
const CLOSES_ADDRESS = new Set(['"', "'", ')', '>', ' ', '\t', '\n']);
const WORD = /[A-Za-z0-9_-]/;

/**
 * How many times `needle` is written in `source` as a whole address (or, for a
 * video id, a whole word). One forward pass with `indexOf`: linear in the
 * source whatever it holds (no pattern rescans an unfinished tag).
 */
function countIn(source: string, needle: string, word: boolean): number {
  if (!needle) return 0;
  let count = 0;
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) {
    const before = source.charAt(at - 1);
    const after = source.charAt(at + needle.length);
    const ok = word
      ? !WORD.test(before) && !WORD.test(after)
      : (at === 0 || OPENS_ADDRESS.has(before)) && (after === '' || CLOSES_ADDRESS.has(after));
    if (ok) count += 1;
  }
  return count;
}

/** The address as the checks report an iframe shown as a link: its parsed URL, or the text the reader shows. */
const embedLinkAddress = (src: string): string | null => {
  const source = readerEmbedSource(src);
  return source?.kind === 'link' ? source.url.href : source?.kind === 'text' ? source.text : null;
};

/** The provider video an address plays, or null. */
const providerVideo = (src: string) => {
  const source = readerEmbedSource(src);
  return source?.kind === 'video' ? source.video : null;
};

/**
 * How many findings of `code` a block the editor keeps as source holds. With
 * the check's reading, the check counts that block (only when the block holds
 * the evidence's text at all: a linear test first, so a long malformed block
 * costs one scan). Without it, the written text is searched in one pass.
 */
function opaqueCount(code: LocatableCode, source: string, target: string, counter: FixCounter | undefined): number {
  const needle =
    code === 'embed-untitled' ? (providerVideo(target)?.id ?? '') : code === 'stray-characters' ? target : target === '<iframe>' ? '<iframe' : target;
  if (!(needle && source.includes(needle))) return 0;
  if (counter) return counter(source);
  return writtenCount(code, source, target);
}

/** The findings of `code` in raw text, without the check's reading: one forward pass. */
function writtenCount(code: LocatableCode, source: string, target: string): number {
  switch (code) {
    case 'stray-characters':
      return [...source.matchAll(HTML_STRAY_PARAGRAPH)].filter(([, text]) => (text?.startsWith('-') ? '---' : '/') === target).length;
    case 'embed-untitled': {
      // The check reports the provider's page; the page holds the player address. Both carry the video id.
      const id = providerVideo(target)?.id ?? '';
      return countIn(source, id, true);
    }
    case 'embed-unclosed':
      return target === '<iframe>' ? countIn(source, '<iframe', true) : countIn(source, target, false);
    default:
      return countIn(source, target, false);
  }
}

/** Whether a node the editor shows as one block (an image, the Video/Embed block, a Card) is a finding of `code`. */
function nodeIsFinding(code: LocatableCode, node: PMNode, target: string): boolean {
  const text = (name: string) => (typeof node.attrs[name] === 'string' ? (node.attrs[name] as string).trim() : '');
  if (IMAGES.has(node.type.name)) return code === 'missing-alt' && text('src') === target && !text('alt');
  if (node.type.name === 'videoEmbed') {
    const src = text('src');
    const iframe = text('kind') !== 'video';
    switch (code) {
      case 'video-poster-hidden':
      case 'video-not-https':
        return !iframe && (src === target || countIn(text('source'), target, false) > 0);
      case 'embed-as-link':
        return iframe && !providerVideo(src) && embedLinkAddress(src) === target;
      case 'embed-untitled': {
        const video = providerVideo(src);
        return iframe && !text('title') && video !== null && videoPageUrl(video) === target;
      }
      default:
        return false;
    }
  }
  // A component that renders a link (a Card's `href`).
  return code === 'broken-internal-link' && text('href') === target;
}

const isCode = (node: PMNode): boolean => node.marks.some((mark) => mark.type.name === 'code');

/** The stray characters of a paragraph, as positions: only them, never the inline code or text beside them. */
function strayRange(paragraph: PMNode, pos: number, target: string): FixMatch | null {
  let text = '';
  paragraph.forEach((child) => {
    if (child.isText && !isCode(child)) text += child.text ?? '';
  });
  const stray = text.trim();
  if (!STRAY.test(stray) || (stray.startsWith('-') ? '---' : '/') !== target) return null;
  let found = null as FixMatch | null;
  paragraph.forEach((child, offset) => {
    if (found || !child.isText || isCode(child)) return;
    const value = child.text ?? '';
    const start = value.search(/[^\s]/);
    if (start < 0) return;
    let end = start + 1;
    while (stray.startsWith('-') && value.charAt(end) === '-') end += 1;
    const from = pos + 1 + offset + start;
    found = { from, to: from + end - start, node: false, inside: false };
  });
  return found;
}

/**
 * Where each finding of `code` with evidence `target` is in `doc`, in document
 * order: the exact range of each (a link's text, the stray characters, an
 * unclosed iframe's opening tag) or its node (an image, an embed, a component,
 * a block kept as source, once per finding the check counts in it). One walk
 * over the document, linear in its size; `counter` (the check's own count) is
 * asked only about blocks that hold the evidence's text.
 */
export function findFixMatches(doc: PMNode, code: PublishCheckCode, rawTarget: string, counter?: FixCounter): FixMatch[] {
  const target = rawTarget.trim();
  if (!target || !isLocatablePublishCheck(code)) return [];
  const locatable = code as LocatableCode;
  const matches: FixMatch[] = [];
  doc.descendants((node, pos) => {
    // Code is never a place: nothing in it renders as a link, an image, an embed or stray text.
    if (node.type.name === 'codeBlock') return false;
    if (node.isText) {
      if (isCode(node)) return false;
      const link = node.marks.find((mark) => mark.type.name === 'link');
      if (locatable === 'broken-internal-link' && typeof link?.attrs.href === 'string' && link.attrs.href.trim() === target) {
        // One link written with formatting inside spans several text nodes with the same link mark.
        const last = matches.at(-1);
        if (last && !last.node && last.to === pos) last.to = pos + node.nodeSize;
        else matches.push({ from: pos, to: pos + node.nodeSize, node: false, inside: false });
      }
      // An iframe without its closer can reach the editor as text: its opening tag.
      if (locatable === 'embed-unclosed') {
        const value = node.text ?? '';
        // Each opening tag ends at its `>` or where the next one starts: every character is read once.
        let close = value.indexOf('>');
        for (let at = value.indexOf('<iframe'); at >= 0; ) {
          const next = value.indexOf('<iframe', at + 1);
          // The first `>` after this tag's start; it only ever moves forward.
          while (close >= 0 && close < at) close = value.indexOf('>', close + 1);
          const end = close >= 0 && (next < 0 || close < next) ? close + 1 : next < 0 ? value.length : next;
          const tag = value.slice(at, end);
          if (target === '<iframe>' ? !/\ssrc\s*=/.test(tag) : countIn(tag, target, false) > 0) {
            matches.push({ from: pos + at, to: pos + end, node: false, inside: false });
          }
          at = next;
        }
      }
      return false;
    }
    if (OPAQUE.has(node.type.name)) {
      if (!UNREAD_OPAQUE.has(String(node.attrs.name ?? ''))) {
        const count = opaqueCount(locatable, String(node.attrs.source ?? ''), target, counter);
        for (let index = 0; index < count; index += 1) matches.push({ from: pos, to: pos + node.nodeSize, node: true, inside: true });
      }
      return false;
    }
    if (locatable === 'stray-characters') {
      // Without GFM (as the check parses) a table is never a paragraph of stray characters.
      if (node.type.name === 'table') return false;
      if (node.type.name !== 'paragraph') return true;
      const stray = strayRange(node, pos, target);
      if (stray) matches.push(stray);
      return false;
    }
    if (nodeIsFinding(locatable, node, target)) {
      matches.push({ from: pos, to: pos + node.nodeSize, node: true, inside: false });
      return false;
    }
    return true;
  });
  return matches;
}
