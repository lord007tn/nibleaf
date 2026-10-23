import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { inferSafeInlineAssetContentType, isSafeInlineAssetContentType, normalizeAssetContentType } from '@nibleaf/validators';
import got from 'got';
import { isPrivateIp } from '@/lib/client-ip';
import { findImportedAsset, storeAsset } from '../assets';

const MAX_REMOTE_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_ASSETS = 2000;
const MAX_REDIRECTS = 3;
const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()(https?:\/\/[^\s)]+)((?:\s+["'][^)]*["'])?\))/gi;
const HTML_IMAGE = /(<(?:img|Image)\b[^>]*\bsrc\s*=\s*["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi;
const publicHostChecks = new Map<string, Promise<void>>();

export const remoteImageSources = (content: string): string[] => {
  const prose = protectMarkdownCode(content).content;
  return [
    ...new Set(
      [...prose.matchAll(MARKDOWN_IMAGE), ...prose.matchAll(HTML_IMAGE)].map((match) => match[2]).filter((value): value is string => Boolean(value)),
    ),
  ];
};

const filenameFromUrl = (url: URL): string => {
  const encoded = url.pathname.split('/').filter(Boolean).pop() ?? 'image';
  try {
    return decodeURIComponent(encoded).slice(0, 255) || 'image';
  } catch {
    return encoded.slice(0, 255) || 'image';
  }
};

const publicHttpUrl = async (value: string): Promise<URL> => {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('unsupported URL');
  }
  let check = publicHostChecks.get(url.hostname);
  if (!check) {
    check = lookup(url.hostname, { all: true, verbatim: true }).then((addresses) => {
      if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address.address))) throw new Error('non-public host');
    });
    publicHostChecks.set(url.hostname, check);
    check.catch(() => publicHostChecks.delete(url.hostname));
  }
  await check;
  return url;
};

const importIdForSource = (namespace: string, source: string): string =>
  `${namespace}-${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;

/** Image type from magic bytes. GitBook stores many uploads without an
 * extension, which raw.githubusercontent.com serves as application/octet-stream. */
const sniffImageType = (bytes: Uint8Array): string => {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return '';
};

const fetchPublicImage = async (source: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> => {
  let url = await publicHttpUrl(source);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await got(url, {
      headers: { 'User-Agent': 'nibleaf-content-importer/1.0' },
      followRedirect: false,
      retry: { limit: 0 },
      throwHttpErrors: false,
      timeout: { request: 20_000 },
    });
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (!(location && redirect < MAX_REDIRECTS)) throw new Error('too many redirects');
      url = await publicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`remote response ${response.statusCode}`);

    const announcedSize = Number(response.headers['content-length'] ?? 0);
    if (announcedSize > MAX_REMOTE_ASSET_BYTES) throw new Error('image exceeds 50 MiB');
    const bytes = new Uint8Array(response.rawBody);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REMOTE_ASSET_BYTES) throw new Error('invalid image size');

    const filename = filenameFromUrl(url);
    const announced = normalizeAssetContentType(response.headers['content-type'] ?? '') || inferSafeInlineAssetContentType(filename) || '';
    const contentType = isSafeInlineAssetContentType(announced) ? announced : sniffImageType(bytes);
    if (!isSafeInlineAssetContentType(contentType)) throw new Error('unsupported image type');
    return { bytes, contentType, filename };
  }
  throw new Error('too many redirects');
};

/** Per-import remote-image cache. The same Ghost image may appear in multiple
 * localized pages; one promise per source URL guarantees it is fetched and
 * stored only once while allowing images within a page to migrate in parallel.
 * The cap bounds downloads only: images a previous import stored are reused. */
export class RemoteAssetMigrator {
  readonly failures = new Set<string>();
  migrated = 0;
  skipped = 0;
  private downloads = 0;
  private readonly cache = new Map<string, Promise<string>>();
  private readonly capMessage: string;

  constructor(
    private readonly projectId: string,
    private readonly namespace = 'ghost',
    private readonly maxDownloads = MAX_REMOTE_ASSETS,
  ) {
    this.capMessage = `Asset migration was capped at ${maxDownloads} downloaded images.`;
  }

  /** Up to `limit` distinct failure reasons, the download cap first when it was hit. */
  failureReasons(limit = 3): string {
    const reasons = [...this.failures].sort((a, b) => Number(b === this.capMessage) - Number(a === this.capMessage));
    return reasons.slice(0, limit).join('; ');
  }

  private migrate(source: string): Promise<string> {
    const cached = this.cache.get(source);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const filename = filenameFromUrl(new URL(source));
        const importId = importIdForSource(this.namespace, source);
        const existing = await findImportedAsset(this.projectId, importId, filename);
        if (existing) return existing.url;
        if (this.downloads >= this.maxDownloads) {
          this.skipped++;
          this.failures.add(this.capMessage);
          return source;
        }
        this.downloads++;
        const image = await fetchPublicImage(source);
        const asset = await storeAsset({ projectId: this.projectId, importId, ...image });
        this.migrated++;
        return asset.url;
      } catch (error) {
        this.skipped++;
        this.failures.add(error instanceof Error ? error.message : 'image migration failed');
        return source;
      }
    })();
    this.cache.set(source, pending);
    return pending;
  }

  async rewrite(markdown: string): Promise<string> {
    const protectedCode = protectMarkdownCode(markdown, { maxFenceIndent: this.namespace === 'ghost' ? 3 : Number.POSITIVE_INFINITY });
    const sources = remoteImageSources(protectedCode.content);
    if (sources.length === 0) return markdown;
    const replacements = new Map(await Promise.all(sources.map(async (source) => [source, await this.migrate(source)] as const)));
    const replace = (_match: string, before: string, source: string, after: string) => `${before}${replacements.get(source) ?? source}${after}`;
    return protectedCode.restore(protectedCode.content.replace(MARKDOWN_IMAGE, replace).replace(HTML_IMAGE, replace));
  }
}

/** Compatibility name for the Ghost importer; the implementation is shared
 * with Mintlify because both now take ownership of imported remote images. */
export class GhostAssetMigrator extends RemoteAssetMigrator {}
