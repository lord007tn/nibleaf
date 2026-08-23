import { describe, expect, it } from 'vitest';
import { publicAssetResponseHeaders } from './asset-response';

describe('publicAssetResponseHeaders', () => {
  it.each(['image/png', 'IMAGE/JPEG; charset=binary', 'image/webp', 'image/avif', 'image/vnd.microsoft.icon'])(
    'keeps safe raster image type inline: %s',
    (contentType) => {
      expect(publicAssetResponseHeaders(contentType)).toEqual({
        contentType: contentType.toLowerCase().split(';')[0],
        contentDisposition: undefined,
        contentSecurityPolicy: undefined,
      });
    },
  );

  it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/plain', undefined])(
    'forces unsafe stored content to download: %s',
    (contentType) => {
      expect(publicAssetResponseHeaders(contentType)).toEqual({
        contentType: 'application/octet-stream',
        contentDisposition: 'attachment',
        contentSecurityPolicy: 'sandbox',
      });
    },
  );
});
