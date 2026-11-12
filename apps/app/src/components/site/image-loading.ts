type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/**
 * How a page's images load. The first image is usually near the top (often the
 * largest thing on screen), so it loads right away; every later image waits
 * until the reader scrolls near it, so a long, screenshot-heavy article doesn't
 * fetch everything up front. All of them decode off the main thread. An author's
 * own `loading` or `decoding` attribute wins.
 */
export const rehypeImageLoading = () => (tree: HastNode) => {
  let first = true;
  const visit = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'img') {
      node.properties ??= {};
      const properties = node.properties;
      properties.loading ??= first ? 'eager' : 'lazy';
      properties.decoding ??= 'async';
      first = false;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
};
