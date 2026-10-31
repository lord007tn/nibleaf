import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { inferSafeInlineAssetContentType, isSafeInlineAssetContentType, normalizeAssetContentType } from '@nibleaf/validators';
import got from 'got';
import { isPublicAddress } from '@/lib/domain-checks';
import { findImportedAsset, storeAsset } from '../assets';

const MAX_REMOTE_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_ASSETS = 2000;
const MAX_REDIRECTS = 3;
const MARKDOWN_IMAGE = /(!\[[^\]]*\]\()(https?:\/\/[^\s)]+)((?:\s+["'][^)]*["'])?\))/gi;
const HTML_IMAGE = /(<(?:img|Image)\b[^>]*\bsrc\s*=\s*["'])(https?:\/\/[^"']+)(["'][^>]*>)/gi;
const MAX_CONCURRENT_DOWNLOADS = 4;
// Image downloads never share connections with other outbound requests.
const DOWNLOAD_AGENTS = { http: new HttpAgent({ keepAlive: false }), https: new HttpsAgent({ keepAlive: false }) };

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

const publicHttpUrl = (value: string): URL => {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('unsupported URL');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('non-public host');
  return url;
};

// Validate every answer in the lookup the connection uses.
const publicDnsLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }).then(
    (addresses) => {
      const selected = addresses[0];
      if (!selected || addresses.some(({ address }) => !isPublicAddress(address))) {
        callback(new Error('non-public host'), '', 4);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, selected.address, selected.family);
    },
    () => callback(new Error('host lookup failed'), '', 4),
  );
};

const importIdForSource = (namespace: string, source: string): string =>
  `${namespace}-${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;

const fetchPublicImage = async (source: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> => {
  let url = publicHttpUrl(source);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const request = got.stream(url, {
      headers: { 'User-Agent': 'nibleaf-content-importer/1.0' },
      followRedirect: false,
      retry: { limit: 0 },
      throwHttpErrors: false,
      timeout: { request: 20_000 },
      dnsLookup: publicDnsLookup,
      agent: DOWNLOAD_AGENTS,
    });
    try {
      const [response] = (await once(request, 'response')) as [IncomingMessage];
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        const location = response.headers.location;
        if (!(location && redirect < MAX_REDIRECTS)) throw new Error('too many redirects');
        url = publicHttpUrl(new URL(location, url).toString());
        continue;
      }
      if (status < 200 || status >= 300) throw new Error('remote response failed');
      const announcedSize = Number(response.headers['content-length'] ?? 0);
      if (announcedSize > MAX_REMOTE_ASSET_BYTES) throw new Error('image exceeds 50 MiB');
      const filename = filenameFromUrl(url);
      const contentType = normalizeAssetContentType(response.headers['content-type'] ?? '') || inferSafeInlineAssetContentType(filename) || '';
      if (!isSafeInlineAssetContentType(contentType)) throw new Error('unsupported image type');

      const chunks: Buffer[] = [];
      let total = 0;
      // Got streams decoded bytes, so this also bounds compressed responses.
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > MAX_REMOTE_ASSET_BYTES) throw new Error('image exceeds 50 MiB');
        chunks.push(bytes);
      }
      if (total === 0) throw new Error('invalid image size');
      return { bytes: Buffer.concat(chunks, total), contentType, filename };
    } finally {
      request.destroy();
    }
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
  private active = 0;
  private readonly waiting: Array<() => void> = [];
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
      if (this.active >= MAX_CONCURRENT_DOWNLOADS) await new Promise<void>((resolve) => this.waiting.push(resolve));
      else this.active++;
      try {
        const filename = filenameFromUrl(new URL(source));
        const importId = importIdForSource(this.namespace, source);
        const existing = await findImportedAsset(this.projectId, importId, filename);
        if (existing) return existing.url;
        const image = await fetchPublicImage(source);
        const asset = await storeAsset({ projectId: this.projectId, importId, ...image });
        this.migrated++;
        return asset.url;
      } catch {
        this.skipped++;
        this.failures.add('image migration failed');
        return source;
      } finally {
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
      }
    })();
    this.cache.set(source, pending);
    return pending;
  }

  async rewrite(markdown: string): Promise<string> {
    const protectedCode = protectMarkdownCode(markdown, { maxFenceIndent: this.namespace === 'mintlify' ? Number.POSITIVE_INFINITY : 3 });
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
