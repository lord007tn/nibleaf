type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const LOADING = new Set(['eager', 'lazy']);
const DECODING = new Set(['sync', 'async', 'auto']);

const classNames = (node: HastNode): string[] => {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : [];
};

/** One image of a light/dark pair: only one of the two is ever shown. */
const isAppearanceVariant = (node: HastNode): boolean => {
  const classes = classNames(node);
  return (
    classes.includes('dark:hidden') || (classes.includes('hidden') && classes.some((name) => name.startsWith('dark:') && name !== 'dark:hidden'))
  );
};

/** An inline icon by its authored size: never the image the page opens on. */
const isTiny = (node: HastNode): boolean =>
  [node.properties?.width, node.properties?.height].some((value) => {
    const size = Number(value);
    return Number.isFinite(size) && size > 0 && size <= 64;
  });

/**
 * How a page's images load. The first real image (the one a page usually opens
 * on) loads right away; when it is one of a light/dark pair, both variants do,
 * since either may be the one shown. Tiny inline icons don't take that slot.
 * Every other image waits until the reader scrolls near it, so a long,
 * screenshot-heavy article doesn't fetch everything up front. All decode off the
 * main thread. An author's own valid `loading` or `decoding` wins.
 *
 * Runs before the sanitizer, which drops the authored sizes and classes it
 * doesn't allow, and keeps only the valid `loading`/`decoding` values.
 */
export const rehypeImageLoading = () => (tree: HastNode) => {
  const images: HastNode[] = [];
  const collect = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'img') images.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(tree);
  const eager = new Set<HastNode>();
  const first = images.findIndex((image) => !isTiny(image));
  const lead = images[first];
  if (lead) {
    eager.add(lead);
    if (isAppearanceVariant(lead)) {
      const twin = images.slice(first + 1).find((image) => !isTiny(image));
      if (twin && isAppearanceVariant(twin)) eager.add(twin);
    }
  }
  for (const image of images) {
    image.properties ??= {};
    const properties = image.properties;
    if (!LOADING.has(String(properties.loading))) properties.loading = eager.has(image) ? 'eager' : 'lazy';
    if (!DECODING.has(String(properties.decoding))) properties.decoding = 'async';
  }
};
