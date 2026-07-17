/** Turn a free-form string into a url-safe slug. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Join a parent path and a slug into a full doc path (no leading/trailing slash). */
export const joinPath = (parentPath: string | null | undefined, slug: string): string => {
  const base = (parentPath ?? '').replace(/^\/+|\/+$/g, '');
  return base ? `${base}/${slug}` : slug;
};

/** First non-empty line of markdown, stripped of common markup — used for excerpts. */
export const excerpt = (markdown: string, max = 160): string => {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images (never leak their URL into the excerpt)
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ') // HTML / MDX component tags (<Note>, <Card …>)
    .replace(/\[!\w+\]/gi, ' ') // admonition markers ([!NOTE])
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[#>*_`~-]+/g, ' ') // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Pluralise a noun against a count. */
export const plural = (count: number, noun: string, suffix = 's'): string => `${count} ${noun}${count === 1 ? '' : suffix}`;
