import { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize';
import {
  type DocumentationComponentContract,
  documentationComponentContractEntries,
  documentationReaderTag,
} from './documentation-component-contract';
import { READER_EMBED_TAG } from './reader-embeds';

/*
 * The reader's sanitize schema, shared by the article renderer and by the parser
 * that reads a page's headings the way the reader renders them
 * (`@nibleaf/shared/reader-headings`): what it strips or keeps decides a
 * heading's text, and an id the author set is prefixed by it.
 */

// Everything component-specific below is derived from the reader contract in
// ./documentation-component-contract; add components there.
const CONTRACT = documentationComponentContractEntries();
const readerTagsWhere = (predicate: (component: DocumentationComponentContract) => boolean): string[] =>
  CONTRACT.flatMap(([tag, component]) => (predicate(component) ? [documentationReaderTag(tag)] : []));

/** The custom component tag names the renderer understands (lowercased, as
 *  rehype-raw emits them). `<mermaid>` is synthesized by rehypeMermaid from
 *  ```mermaid fences rather than authored. */
const COMPONENT_TAGS = [...readerTagsWhere(() => true), 'mermaid'];

/** Sanitizer attributes for one component. HTML parsing lowercases attribute
 *  names, so camelCase props are also allowed in their lowercase spelling;
 *  `name` arrives as `dataDisplayName` (see rehypeAuthoredComponentProps). */
const readerAttributes = (component: DocumentationComponentContract): string[] =>
  Object.keys(component.attributes).flatMap((name) => {
    if (name === 'name') return ['dataDisplayName'];
    return name === name.toLowerCase() ? [name] : [name, name.toLowerCase()];
  });
const COMPONENT_ATTRIBUTES: Record<string, string[]> = Object.fromEntries(
  CONTRACT.flatMap(([tag, component]) => {
    const attributes = readerAttributes(component);
    return attributes.length > 0 ? [[documentationReaderTag(tag), attributes]] : [];
  }),
);

/** Component props that hold a URL or may one day hold an image URL (icons):
 *  the sanitizer checks their scheme, so `javascript:` or `data:` never reaches
 *  a renderer. `href` is already checked by the default schema. An Icon's
 *  `name` alias travels as `dataDisplayName`, shared with display-only names,
 *  so it is not protocol-checked; the Icon renderer resolves it as an icon name. */
const COMPONENT_PROTOCOLS: Record<string, string[]> = Object.fromEntries(
  CONTRACT.flatMap(([, component]) =>
    Object.entries(component.attributes).flatMap(([name, type]) =>
      (type === 'url' || type === 'icon') && name !== 'name' && !defaultSchema.protocols?.[name] ? [[name, ['http', 'https']]] : [],
    ),
  ),
);

/** Sanitize schema: the GitHub-safe default, extended to permit our component
 *  tags and their props, plus className/id passthrough for headings & code
 *  highlighting. Scripts, event handlers, and unknown attributes are still
 *  stripped — this is what makes raw component HTML safe to render. */
export const readerSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  // `u`: the editor's Underline (and pasted underlines) save `<u>…</u>`; the
  // GitHub default allows `sub`/`sup` but not `u`. No attributes of its own.
  // `video`, its captions (`track`) and its `source` (already allowed for `picture`): see below.
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'video', 'track', READER_EMBED_TAG, ...COMPONENT_TAGS],
  // `poster` is an image address: https or a path on this site, never `data:`/`javascript:`.
  protocols: { ...defaultSchema.protocols, ...COMPONENT_PROTOCOLS, poster: ['https'] },
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
    ...COMPONENT_ATTRIBUTES,
    // An authored iframe, as `normalizeMdxBlocks` rewrites it (./reader-embeds):
    // the renderer validates these again and builds the player address itself.
    [READER_EMBED_TAG]: ['provider', 'videoid', 'start', 'title', 'href', 'text'],
    // A video plays only on request: autoplay, muted, loop and event attributes
    // are dropped here, and the renderer forces controls and keeps only https
    // (or same-site) addresses (`isAllowedMediaUrl` in ./video-embeds).
    video: ['src', 'poster'],
    source: [...(defaultSchema.attributes?.source ?? []), 'src', 'type'],
    track: [['kind', 'captions', 'subtitles', 'descriptions', 'chapters'], 'src', 'srcLang', 'label', 'default'],
    // `dataTitle`/`dataLang` (hast camelCase → data-title/data-lang) carry the
    // fenced-code header (filename + language). mdast→hast may place a code
    // node's hProperties on the wrapping <pre>, so allow them on both elements.
    pre: [...(defaultSchema.attributes?.pre ?? []), 'dataTitle', 'dataLang'],
    // Keep only the code classes used by highlighting and the trusted math
    // renderer. MathML and layout styles are generated after sanitization.
    code: [['className', /^language-./, 'math-inline', 'math-display'], 'dataTitle', 'dataLang'],
    // How an image loads: only the values browsers define (set by the reader's
    // rehypeImageLoading, or written by an author to override it).
    img: [...(defaultSchema.attributes?.img ?? []), ['loading', 'eager', 'lazy'], ['decoding', 'sync', 'async', 'auto']],
  },
};
