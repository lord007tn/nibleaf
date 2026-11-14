/**
 * What a page renders that the pre-publish checks look at: its links, images
 * without alt text, stray text and embeds, read the way the reader renders the
 * page. Browser-safe (no Node built-ins), so the editor counts a check's
 * findings with the check's own reading of the page (P1-ED-002), and
 * `./publish-checks` (server) adds its cache and the link routing on top.
 *
 * - Links are read the way the reader renders the page: its own source
 *   normalization (`normalizeMdxBlocks`), then CommonMark, then raw HTML
 *   through parse5 (rehype-raw). A link counts only when it renders as one.
 * - Reference links resolve through their definition (the first one wins).
 */
import type { Root } from 'mdast';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { documentationComponentContractEntries, documentationReaderTag } from './documentation-component-contract';
import { matchTags } from './markup-scan';
import { READER_EMBED_TAG } from './reader-embeds';
import { normalizeMdxBlocks } from './reader-markdown';
import { isAllowedMediaUrl, isSiteMediaPath, videoEmbedFrom, videoPageUrl } from './video-embeds';

/* ------------------------------------------------------------------------ */
/* Page content, from the parsed tree                                        */
/* ------------------------------------------------------------------------ */

type JsxAttribute = { type: string; name?: string; value?: unknown };
type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  name?: string | null;
  attributes?: JsxAttribute[];
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hProperties?: Record<string, unknown> };
};

/** What one page renders that the checks look at. */
export interface PageContentFacts {
  /** Destinations of links that render, in document order. */
  links: string[];
  /** Sources of images that render without alt text. */
  imagesWithoutAlt: string[];
  /** Stray text left over from imports: a paragraph of only `/` or a literal `---`. */
  strayText: string[];
  /** Provider videos without a title (they get a generic accessible name), by their page address. */
  untitledEmbeds: string[];
  /** Iframes the reader shows as a link or as text instead of a player, by their address. */
  embedsAsLinks: string[];
  /** `<video>`/`<source>` addresses the reader won't play: not https and not on this site. */
  insecureVideos: string[];
  /** Iframes the reader doesn't show because no closer ends their block, by their address. */
  unclosedEmbeds: string[];
  /** Video posters the reader leaves out (anything but a file on this site), by their address. */
  hiddenPosters: string[];
}

type EmbedFacts = Pick<PageContentFacts, 'untitledEmbeds' | 'embedsAsLinks' | 'insecureVideos' | 'unclosedEmbeds' | 'hiddenPosters'>;

// The same parse as #426's link rewriter (micromark MDX + mdast-util-mdx, via
// remark-mdx). GFM is left out on purpose: it roughly doubles the cost and
// changes nothing the checks read (links in table cells parse the same, its
// autolink literals are external), except footnotes, handled below.
const mdxParser = unified().use(remarkParse).use(remarkMdx);
// The reader renders CommonMark (+ GFM): what it treats as code (indented code
// included, which MDX disables) comes from this parse, and invalid MDX is read
// with it entirely, where JSX and comments are raw HTML.
const markdownParser = unified().use(remarkParse);
// Invalid MDX is read for images and stray text as the reader reads it.
const htmlParser = unified().use(remarkParse).use(remarkGfm);
// Links use the reader's CommonMark -> HAST -> parse5 (rehype-raw) pipeline.
// GFM is left out for speed: of what it adds, only footnotes render links, and
// those are in-page (their labels are filtered below); table cells, task lists
// and strikethrough parse links the same, and its autolink literals are external.
const readerLinkParser = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
/** Without GFM a footnote (`[^1]` with `[^1]: text`) parses as a reference
 *  link; the reader renders it as an in-page footnote, never a page link. */
const isFootnoteLabel = (identifier: string | undefined): boolean => identifier?.startsWith('^') === true;

/** Excluded from the MDX walk (images and stray text); links are collected separately. */
const SILENT = new Set(['code', 'inlineCode', 'html', 'mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm', 'yaml', 'toml']);
// The reader's plain <a>, plus every component whose reader contract declares
// an `href` (the same contract mdx-config's sanitizer and component map use),
// by the lowercase tag name the HTML parser gives it.
const LINK_ELEMENTS = new Set([
  'a',
  ...documentationComponentContractEntries().flatMap(([tag, component]) => ('href' in component.attributes ? [documentationReaderTag(tag)] : [])),
]);
/** Elements the embed checks read (see `collectEmbed`). */
const EMBED_ELEMENTS = new Set([READER_EMBED_TAG, 'video', 'source']);
const NON_LINK_CONTEXTS = new Set(['script', 'textarea', 'template', 'style', 'noscript', 'iframe', 'title']);
const STRAY = /^(?:\/|-{3,})$/;
const HTML_IMAGE = /<img\b[^>]*>/gi;
const HTML_STRAY_PARAGRAPH = /<p>\s*(\/|-{3,})\s*<\/p>/gi;

const textOf = (node: MarkdownNode): string => (node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join(''));

const jsxAttribute = (node: MarkdownNode, name: string): JsxAttribute | undefined =>
  node.attributes?.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === name);

type HtmlNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  position?: { start: { offset?: number } };
};

/** CommonMark may end a raw HTML node at a blank line inside e.g. <title>.
 * Keep the source HTML context even if rehype-raw reparents generated nodes.
 * Only the raw HTML nodes CommonMark found are parsed (everything else is
 * blanked), so Markdown text that looks like a tag (`\<script>`) opens no context. */
const htmlNonLinkRanges = (tree: Root, content: string): { start: number; end: number }[] => {
  // UTF-16 units, matching the offsets of both parsers.
  const masked: string[] = content.split('').map((char) => (char === '\n' ? char : ' '));
  const keepHtml = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'html' && start !== undefined && end !== undefined) {
      for (let index = start; index < end; index++) masked[index] = content[index] ?? ' ';
    } else for (const child of node.children ?? []) keepHtml(child);
  };
  keepHtml(tree);
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
    if ('tagName' in node && NON_LINK_CONTEXTS.has(node.tagName) && node.sourceCodeLocation) {
      // An unclosed context runs to the end of the page.
      ranges.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset ?? content.length });
      return;
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  for (const child of parseFragment(masked.join(''), { sourceCodeLocationInfo: true }).childNodes) visit(child);
  return ranges;
};

/**
 * Whether an offset lies inside any of the ranges, answered in O(log n) per
 * offset: the ranges are sorted once by start, with the largest end seen so
 * far, so a page with many contexts and many links or embeds stays linear.
 * Same answer as checking every range (an unclosed context can overlap later ones).
 */
export const offsetInRanges = (ranges: { start: number; end: number }[]): ((offset: number) => boolean) => {
  if (ranges.length === 0) return () => false;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const starts = sorted.map((range) => range.start);
  const maxEnds: number[] = [];
  for (const range of sorted) maxEnds.push(Math.max(range.end, maxEnds.at(-1) ?? range.end));
  return (offset) => {
    // The last range starting at or before the offset.
    let low = 0;
    let high = starts.length - 1;
    let last = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((starts[middle] as number) <= offset) {
        last = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return last >= 0 && (maxEnds[last] as number) > offset;
  };
};

/** A raw HTML node that may open one of the NON_LINK_CONTEXTS (it can span later nodes). */
const NON_LINK_TAG = new RegExp(`<(?:${[...NON_LINK_CONTEXTS].join('|')})(?![a-z0-9-])`, 'i');

/** HAST property holding a Markdown link's destination as authored. */
const AUTHORED_HREF = 'dataAuthoredHref';

const propertyText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** What one element contributes to the embed checks, read as the reader's renderer reads it. */
const collectEmbed = (node: HtmlNode, parent: HtmlNode | undefined, embeds: EmbedFacts): void => {
  const properties = node.properties ?? {};
  if (node.tagName === READER_EMBED_TAG) {
    const video = videoEmbedFrom(properties.provider, properties.videoid, properties.start);
    if (video) {
      if (!propertyText(properties.title)) embeds.untitledEmbeds.push(videoPageUrl(video));
    } else {
      const address = propertyText(properties.href) || propertyText(properties.text);
      if (address) embeds.embedsAsLinks.push(address);
    }
  } else if (node.tagName === 'video' || (node.tagName === 'source' && parent?.tagName === 'video')) {
    const src = propertyText(properties.src);
    if (src && !isAllowedMediaUrl(src)) embeds.insecureVideos.push(src);
    const poster = node.tagName === 'video' ? propertyText(properties.poster) : '';
    if (poster && !isSiteMediaPath(poster)) embeds.hiddenPosters.push(poster);
  }
};

/** Link destinations after HTML parsing, never text that merely looks like a tag;
 *  embeds (iframes as the reader rewrites them, and videos) from the same tree. */
const htmlLinks = (tree: Root, content: string, embeds: EmbedFacts): string[] => {
  const links: string[] = [];
  // CommonMark: the first definition of a label wins.
  const definitions = new Map<string, string>();
  let hasHtml = false;
  let hasNonLinkContext = false;
  const survey = (node: MarkdownNode) => {
    if (
      node.type === 'definition' &&
      node.identifier &&
      !isFootnoteLabel(node.identifier) &&
      node.url !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
    if (node.type === 'html') {
      hasHtml = true;
      if (NON_LINK_TAG.test(node.value ?? '')) hasNonLinkContext = true;
    }
    for (const child of node.children ?? []) survey(child);
  };
  survey(tree as MarkdownNode);
  // Without raw HTML, the rendered links are exactly the Markdown links
  // (a reference renders as a link only when its label is defined).
  if (!hasHtml) {
    const markdownLinks = (node: MarkdownNode) => {
      const url = node.type === 'link' ? node.url : node.type === 'linkReference' && node.identifier ? definitions.get(node.identifier) : undefined;
      if (url) links.push(url);
      for (const child of node.children ?? []) markdownLinks(child);
    };
    markdownLinks(tree as MarkdownNode);
    return links;
  }
  const suppressed = offsetInRanges(hasNonLinkContext ? htmlNonLinkRanges(tree, content) : []);
  // HAST percent-encodes Markdown destinations (`/دليل` → `/%D8%AF…`). Carry the
  // authored one through, so the checks report what the author wrote.
  const markAuthored = (node: MarkdownNode) => {
    // A footnote reference is in-page: marked empty, so it is never checked.
    const authored =
      node.type === 'link'
        ? node.url
        : node.type === 'linkReference' && node.identifier
          ? isFootnoteLabel(node.identifier)
            ? ''
            : definitions.get(node.identifier)
          : undefined;
    if (authored !== undefined) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [AUTHORED_HREF]: authored } };
    for (const child of node.children ?? []) markAuthored(child);
  };
  markAuthored(tree as MarkdownNode);
  const visit = (node: HtmlNode, parent?: HtmlNode) => {
    // Every complete iframe became the reader's embed element (./reader-embeds), so one
    // still here has no closer in its block (or a tag the rewrite couldn't read).
    if (node.tagName === 'iframe') embeds.unclosedEmbeds.push(propertyText(node.properties?.src) || '<iframe>');
    if (node.tagName && NON_LINK_CONTEXTS.has(node.tagName)) return;
    if (node.tagName && (LINK_ELEMENTS.has(node.tagName) || EMBED_ELEMENTS.has(node.tagName))) {
      const offset = node.position?.start.offset;
      if (offset !== undefined && suppressed(offset)) return;
      collectEmbed(node, parent, embeds);
    }
    if (node.tagName && LINK_ELEMENTS.has(node.tagName)) {
      // An element exists here only when the reader parses it as HTML. A JSX
      // spread on its own line is text to CommonMark and never gets this far;
      // inside a raw HTML block it is an unknown attribute the sanitizer drops,
      // and the element still renders its href.
      const href = node.properties?.[AUTHORED_HREF] ?? node.properties?.href;
      if (typeof href === 'string' && href && !href.trimStart().startsWith('{')) links.push(href);
    }
    for (const child of node.children ?? []) visit(child, node);
  };
  visit(readerLinkParser.runSync(tree));
  return links;
};

/** Raw `<img>` tags (as rehype-raw renders them) without a usable alt. */
const htmlImagesWithoutAlt = (html: string): string[] =>
  // matchTags: the same tags as matchAll, read in linear time when a `>` is missing.
  matchTags(html, HTML_IMAGE).flatMap(([tag]) => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (alt && (alt[1] ?? alt[2] ?? '').trim()) return [];
    return [
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i
        .exec(tag)
        ?.slice(1)
        .find((value) => value !== undefined) ?? '',
    ];
  });

/** What one page renders that the checks look at, read as the reader reads it (not cached). */
export const collectPageContentFacts = (content: string): PageContentFacts => {
  let tree: MarkdownNode;
  let isMdx = true;
  try {
    tree = mdxParser.parse(content) as MarkdownNode;
  } catch {
    tree = htmlParser.parse(content) as MarkdownNode;
    isMdx = false;
  }
  // Code ranges as the reader sees them. Only needed when the MDX parse may have
  // read indented code as prose (a line indented by four spaces or a tab).
  const codeRanges: { start: number; end: number }[] = [];
  if (isMdx && /^(?: {4}|\t)/m.test(content)) {
    const collectCode = (node: MarkdownNode) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if ((node.type === 'code' || node.type === 'inlineCode') && start !== undefined && end !== undefined) codeRanges.push({ start, end });
      else for (const child of node.children ?? []) collectCode(child);
    };
    collectCode(markdownParser.parse(content) as MarkdownNode);
  }
  const inCode = (node: MarkdownNode): boolean => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start !== undefined && end !== undefined && codeRanges.some((range) => start >= range.start && end <= range.end);
  };

  // CommonMark: the first definition of a label wins.
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: MarkdownNode) => {
    if (SILENT.has(node.type) || inCode(node) || NON_LINK_CONTEXTS.has(node.name?.toLowerCase() ?? '')) return;
    if (
      node.type === 'definition' &&
      node.identifier &&
      !isFootnoteLabel(node.identifier) &&
      node.url !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
    for (const child of node.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(tree);

  const facts: PageContentFacts = {
    links: [],
    imagesWithoutAlt: [],
    strayText: [],
    untitledEmbeds: [],
    embedsAsLinks: [],
    insecureVideos: [],
    unclosedEmbeds: [],
    hiddenPosters: [],
  };
  const visit = (node: MarkdownNode) => {
    if (inCode(node) || NON_LINK_CONTEXTS.has(node.name?.toLowerCase() ?? '')) return;
    if (SILENT.has(node.type)) {
      if (node.type === 'html' && !node.value?.trimStart().startsWith('<!--')) {
        facts.imagesWithoutAlt.push(...htmlImagesWithoutAlt(node.value ?? ''));
        for (const [, text] of (node.value ?? '').matchAll(HTML_STRAY_PARAGRAPH)) if (text) facts.strayText.push(text.startsWith('-') ? '---' : '/');
      }
      return;
    }
    switch (node.type) {
      case 'image':
        if (!node.alt?.trim()) facts.imagesWithoutAlt.push(node.url ?? '');
        break;
      case 'imageReference': {
        // Without a definition it renders as text, not an image.
        const url = node.identifier ? definitions.get(node.identifier) : undefined;
        if (url !== undefined && !node.alt?.trim()) facts.imagesWithoutAlt.push(url);
        break;
      }
      case 'paragraph': {
        const text = textOf(node).trim();
        if (STRAY.test(text)) facts.strayText.push(text.startsWith('-') ? '---' : '/');
        break;
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        if (node.name === 'img') {
          const alt = jsxAttribute(node, 'alt');
          // `alt={expression}` is authored on purpose; only a missing or blank alt is flagged.
          const altText = typeof alt?.value === 'string' ? alt.value : alt?.value ? 'expression' : '';
          if (!altText.trim()) {
            const src = jsxAttribute(node, 'src')?.value;
            facts.imagesWithoutAlt.push(typeof src === 'string' ? src : '');
          }
        }
        for (const child of node.children ?? []) visit(child);
        return;
      }
      default:
        break;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  // Links as the reader renders them: its normalized source, through its pipeline.
  const readerSource = normalizeMdxBlocks(content);
  facts.links = htmlLinks(readerLinkParser.parse(readerSource) as Root, readerSource, facts);
  return facts;
};
