/**
 * Detection of MDX component tags the visual (TipTap) editor cannot round-trip.
 *
 * The visual editor only models the tags below; any other JSX-like component in
 * a page's Markdown would be SILENTLY DROPPED the first time the visual editor
 * serializes the document. The editor uses this detector to lock such pages to
 * Markdown mode so nothing is ever lost.
 */

/**
 * Tags (lowercased) the editor round-trips. Keep in sync with:
 *  - components/editor/extensions/mdx-nodes.ts (block/inline MDX nodes)
 *  - components/editor/extensions/callout.ts   (callout tag aliases)
 * Not imported from those modules on purpose: they pull in TipTap/React, and
 * this detector must stay a dependency-free, unit-testable string utility.
 */
const EDITOR_SUPPORTED_TAGS = new Set([
  // mdx-nodes.ts
  'steps',
  'step',
  'cardgroup',
  'card',
  'tabs',
  'tab',
  'accordiongroup',
  'accordion',
  'frame',
  'expandable',
  'update',
  'paramfield',
  'responsefield',
  'codegroup',
  'tooltip',
  'icon',
  // callout.ts — <Callout type="…"> plus the Mintlify-style variant tags
  'callout',
  'note',
  'tip',
  'check',
  'warning',
  'danger',
  'info',
]);

// A JSX-like component tag: capitalized name right after `<` or `</`, followed
// by whitespace, `>` or `/`. Lowercase tags are plain HTML (the editor keeps
// them via html:true), and the lookahead keeps autolinks/emails (<Foo@bar>)
// from matching.
const COMPONENT_TAG = /<\/?([A-Z][A-Za-z0-9]*)(?=[\s/>])/g;

/**
 * Component tags in `markdown` that the visual editor does NOT support.
 * Fenced code blocks and inline code spans are ignored (tags inside them are
 * content, not components). Returns each tag once, in order of first
 * appearance, with its original casing.
 */
export function detectUnsupportedMdxTags(markdown: string): string[] {
  if (!markdown?.includes('<')) {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    // Drop inline code spans before scanning for tags.
    const scannable = line.replace(/`[^`]*`/g, '');
    for (const match of scannable.matchAll(COMPONENT_TAG)) {
      const name = match[1];
      if (!name) {
        continue;
      }
      const lower = name.toLowerCase();
      if (!EDITOR_SUPPORTED_TAGS.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        found.push(name);
      }
    }
  }
  return found;
}
