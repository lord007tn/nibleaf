/** Decode like HTML, with a bound on nested encodings from an untrusted clipboard. */
export function normalizedURL(value: string): string | null {
  const decoder = document.implementation.createHTMLDocument('').createElement('textarea');
  let decoded = value;
  for (let round = 0; round < 4; round++) {
    decoder.innerHTML = decoded;
    const next = decoder.value;
    if (next === decoded) return decoded.replace(/[\p{Cc}\p{Cf}\s]/gu, '');
    decoded = next;
  }
  return null;
}

export function allowedURL(value: string, schemes: readonly string[]): boolean {
  const normalized = normalizedURL(value);
  if (normalized === null) return false;
  const scheme = /^([^/?#]*):/.exec(normalized)?.[1];
  return scheme === undefined || schemes.includes(scheme.toLowerCase());
}

export function imageDimension(value: unknown): number | string | null {
  const text = String(value ?? '');
  if (/^\d+%$/.test(text)) {
    const percent = Number(text.slice(0, -1));
    return percent >= 1 && percent <= 100 ? `${percent}%` : null;
  }
  if (!/^\d+$/.test(text)) return null;
  const pixels = Number(text);
  return Number.isInteger(pixels) && pixels >= 16 && pixels <= 4000 ? pixels : null;
}

export function imageClasses(value: unknown): string | null {
  // Arbitrary utility classes could overlay or restyle the published page.
  // Images support only display tokens used for light/dark alternatives.
  const classes = String(value ?? '')
    .split(/\s+/)
    .filter((token) => /^(?:dark:)?(?:block|hidden|inline|inline-block)$/.test(token));
  return classes.length ? classes.join(' ') : null;
}

export const escapeImageAttribute = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

export const IMAGE_UPLOAD_PLACEHOLDER_PREFIX = '/__nibleaf-paste-upload-';

/** Only existing raster content can use the source-only compatibility node. */
export const isLegacyRasterImageSource = (source: string): boolean =>
  /^data:image\/(?:png|jpeg|gif|webp|avif)(?:;|$)/i.test(normalizedURL(source.split(',', 1)[0] ?? '') ?? '');
