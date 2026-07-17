import { createHash } from 'node:crypto';

/**
 * Shared, dependency-free content helpers used by the Git import and the
 * importer framework (Mintlify, Ghost, …). Kept pure — no prisma / fetch /
 * `@/…` imports (node builtins are fine) — so unit tests run without a database.
 */

/** Hard cap so an accidental import of a huge source can't fan out unbounded. */
export const MAX_IMPORT_FILES = 250;

/** Deterministic 8-hex digest of a string. Used to derive stable fallback slugs
 *  for content whose name has no Latin characters (e.g. Arabic titles), so
 *  distinct items never collapse onto one shared literal like `post`. */
export const stableHash = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 8);

/** Minimal YAML-frontmatter reader: enough for `title`/`sidebarTitle`/`description`/`icon`. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match?.[1]) {
    return { meta: {}, body: raw };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv?.[1]) {
      let value = (kv[2] ?? '').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[kv[1].toLowerCase()] = value;
    }
  }
  return { meta, body: raw.slice(match[0].length) };
}

export const humanize = (name: string): string =>
  name
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Untitled';

export function deriveTitle(meta: Record<string, string>, body: string, fallbackName: string): string {
  if (meta.title) {
    return meta.title.slice(0, 200);
  }
  if (meta.sidebartitle) {
    return meta.sidebartitle.slice(0, 200);
  }
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) {
    return h1[1].trim().slice(0, 200);
  }
  return humanize(fallbackName);
}
