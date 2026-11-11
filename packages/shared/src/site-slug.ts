import { slugify } from './utils';

/** Keep a usable Latin brand ("Jood وثائق" → "jood"). If more than two thirds of the letters
 * would disappear, use a stable neutral address instead of stray digits or
 * initials. A shared deterministic suffix keeps local preview and API equal;
 * the server still checks collisions. This does not transliterate names. */
export function deriveSiteSlug(name: string) {
  const normalized = name.trim().normalize('NFC').toLowerCase();
  const slug = slugify(name).slice(0, 63).replace(/-+$/g, '');
  const latinLetters = name.match(/[a-z]/gi)?.length ?? 0;
  const otherLetters = [...normalized].filter((letter) => /\p{L}/u.test(letter) && !/\p{Script=Latin}/u.test(letter)).length;
  const needsCustomAddress = !/[a-z]/.test(slug) || otherLetters > 2 * latinLetters;
  if (!needsCustomAddress) return { slug, needsCustomAddress };

  // FNV-1a is a stable name fingerprint, not an identifier or a security token.
  let hash = 2_166_136_261;
  for (let i = 0; i < normalized.length; i++) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16_777_619);
  return { slug: `site-${(hash >>> 0).toString(36).padStart(7, '0')}`, needsCustomAddress };
}
