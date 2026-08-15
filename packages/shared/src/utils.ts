/** Turn a free-form string into a url-safe slug. */
export const slugify = (value: string): string => {
  let slug = '';
  let separatorPending = false;
  for (const char of value.toLowerCase().trim()) {
    const code = char.charCodeAt(0);
    const isAsciiLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAsciiLetter || isDigit) {
      if (separatorPending && slug) {
        slug += '-';
      }
      slug += char;
      separatorPending = false;
    } else if (slug) {
      separatorPending = true;
    }
  }
  return slug;
};

const trimEdgeSlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') {
    start += 1;
  }
  while (end > start && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(start, end);
};

/** Join a parent path and a slug into a full doc path (no leading/trailing slash). */
export const joinPath = (parentPath: string | null | undefined, slug: string): string => {
  const base = trimEdgeSlashes(parentPath ?? '');
  return base ? `${base}/${slug}` : slug;
};

/** Strip Markdown links to their labels and remove Markdown images. This
 * single-pass parser intentionally handles the common inline form only; malformed
 * markup is preserved instead of inviting regex backtracking on user content. */
export const stripMarkdownLinks = (value: string): string => {
  let output = '';
  let cursor = 0;
  while (cursor < value.length) {
    const image = value[cursor] === '!' && value[cursor + 1] === '[';
    const link = value[cursor] === '[';
    if (!image && !link) {
      output += value[cursor];
      cursor += 1;
      continue;
    }

    const markerStart = cursor;
    const labelStart = cursor + (image ? 2 : 1);
    let labelEnd = labelStart;
    while (labelEnd < value.length && value[labelEnd] !== ']') {
      labelEnd += 1;
    }
    if (labelEnd >= value.length || value[labelEnd + 1] !== '(') {
      output += value.slice(markerStart, Math.min(labelEnd + 1, value.length));
      cursor = Math.min(labelEnd + 1, value.length);
      continue;
    }

    let destinationEnd = labelEnd + 2;
    while (destinationEnd < value.length && value[destinationEnd] !== ')') {
      destinationEnd += 1;
    }
    if (destinationEnd >= value.length) {
      output += value.slice(markerStart);
      break;
    }

    if (!image) {
      output += value.slice(labelStart, labelEnd);
    }
    cursor = destinationEnd + 1;
  }
  return output;
};

/** First non-empty line of markdown, stripped of common markup — used for excerpts. */
export const excerpt = (markdown: string, max = 160): string => {
  const text = stripMarkdownLinks(markdown)
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ') // HTML / MDX component tags (<Note>, <Card …>)
    .replace(/\[!\w+\]/gi, ' ') // admonition markers ([!NOTE])
    .replace(/[#>*_`~-]+/g, ' ') // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Pluralise a noun against a count. */
export const plural = (count: number, noun: string, suffix = 's'): string => `${count} ${noun}${count === 1 ? '' : suffix}`;
