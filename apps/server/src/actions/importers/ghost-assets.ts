import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { inferSafeInlineAssetContentType, isSafeInlineAssetContentType, normalizeAssetContentType } from '@nibleaf/validators';
import { isPrivateIp } from '@/lib/client-ip';
import { findImportedAsset, storeAsset } from '../assets';

const MAX_REMOTE_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_ASSETS = 2000;
const MAX_REDIRECTS = 3;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+["'][^)]*["'])?\)/gi;
const HTML_IMAGE = /<(?:img|Image)\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const publicHostChecks = new Map<string, Promise<void>>();

export const remoteImageSources = (content: string): string[] => [
  ...new Set(
    [...content.matchAll(MARKDOWN_IMAGE), ...content.matchAll(HTML_IMAGE)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value)),
  ),
];

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

const fetchPublicImage = async (source: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> => {
  let url = await publicHttpUrl(source);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'nibleaf-content-importer/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!(location && redirect < MAX_REDIRECTS)) throw new Error('too many redirects');
      url = await publicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`remote response ${response.status}`);

    const announcedSize = Number(response.headers.get('content-length') ?? 0);
    if (announcedSize > MAX_REMOTE_ASSET_BYTES) throw new Error('image exceeds 50 MiB');
    const filename = filenameFromUrl(url);
    const contentType = normalizeAssetContentType(response.headers.get('content-type') ?? '') || inferSafeInlineAssetContentType(filename) || '';
    if (!isSafeInlineAssetContentType(contentType)) throw new Error('unsupported image type');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REMOTE_ASSET_BYTES) throw new Error('invalid image size');
    return { bytes, contentType, filename };
  }
  throw new Error('too many redirects');
};

/** Per-import remote-image cache. The same Ghost image may appear in multiple
 * localized pages; one promise per source URL guarantees it is fetched and
 * stored only once while allowing images within a page to migrate in parallel. */
export class RemoteAssetMigrator {
  readonly failures = new Set<string>();
  migrated = 0;
  skipped = 0;
  private readonly cache = new Map<string, Promise<string>>();

  constructor(
    private readonly projectId: string,
    private readonly namespace = 'ghost',
  ) {}

  private migrate(source: string): Promise<string> {
    const cached = this.cache.get(source);
    if (cached) return cached;
    if (this.cache.size >= MAX_REMOTE_ASSETS) {
      this.skipped++;
      this.failures.add(`Asset migration was capped at ${MAX_REMOTE_ASSETS} unique images.`);
      return Promise.resolve(source);
    }
    const pending = (async () => {
      try {
        const filename = filenameFromUrl(new URL(source));
        const importId = importIdForSource(this.namespace, source);
        const existing = await findImportedAsset(this.projectId, importId, filename);
        if (existing) return existing.url;
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
    const sources = remoteImageSources(markdown);
    if (sources.length === 0) return markdown;
    const replacements = new Map(await Promise.all(sources.map(async (source) => [source, await this.migrate(source)] as const)));
    let rewritten = markdown;
    for (const [source, hosted] of replacements) rewritten = rewritten.replaceAll(source, hosted);
    return rewritten;
  }
}

/** Compatibility name for the Ghost importer; the implementation is shared
 * with Mintlify because both now take ownership of imported remote images. */
export class GhostAssetMigrator extends RemoteAssetMigrator {}
