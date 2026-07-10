import { safeInlineAssetContentType } from '@nibleaf/validators';

/**
 * Turn untrusted object-storage metadata into safe browser response headers.
 *
 * Asset URLs share an origin with the dashboard. Anything other than our small
 * raster-image allowlist must therefore download rather than render as HTML,
 * SVG, or another active document.
 */
export const publicAssetResponseHeaders = (storedContentType: string | undefined) => {
  const inlineContentType = safeInlineAssetContentType(storedContentType);
  if (inlineContentType) {
    return { contentType: inlineContentType, contentDisposition: undefined, contentSecurityPolicy: undefined };
  }
  return {
    contentType: 'application/octet-stream',
    contentDisposition: 'attachment',
    // Defense in depth for clients that choose to render a downloaded response.
    contentSecurityPolicy: 'sandbox',
  };
};
