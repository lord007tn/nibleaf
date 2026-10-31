import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { isSafeInlineAssetContentType, normalizeAssetContentType } from '@nibleaf/validators';
import got from 'got';
import { isPublicAddress } from '@/lib/domain-checks';
import { findImportedAsset, storeAsset } from '../assets';
import { htmlImageReferences, markdownReferences, replaceImportReferences } from './import-references';

const MAX_REMOTE_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_ASSETS = 2000;
const MAX_REDIRECTS = 3;
const MAX_CONCURRENT_DOWNLOADS = 4;
// Image downloads never share connections with other outbound requests.
const DOWNLOAD_AGENTS = { http: new HttpAgent({ keepAlive: false }), https: new HttpsAgent({ keepAlive: false }) };

export const remoteImageSources = (content: string): string[] => {
  const prose = protectMarkdownCode(content).content;
  return [
    ...new Set(
      [...markdownReferences(prose).filter((reference) => reference.image), ...htmlImageReferences(prose)]
        .map((reference) => reference.value)
        .filter((value) => /^https?:\/\//i.test(value)),
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
      const announced = normalizeAssetContentType(response.headers['content-type'] ?? '');
      if (announced && announced !== 'application/octet-stream' && !isSafeInlineAssetContentType(announced)) {
        throw new Error('unsupported image type');
      }

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
      const bytes = Buffer.concat(chunks, total);
      const contentType = isSafeInlineAssetContentType(announced) ? announced : sniffImageType(bytes);
      if (!isSafeInlineAssetContentType(contentType)) throw new Error('unsupported image type');
      return { bytes, contentType, filename };
    } finally {
      request.destroy();
    }
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
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly cache = new Map<string, Promise<string>>();
  private readonly capMessage: string;

  constructor(
    private readonly projectId: string,
    private readonly namespace = 'ghost',
    private readonly maxDownloads = MAX_REMOTE_ASSETS,
    private readonly checkBudget: () => void = () => undefined,
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
      if (this.active >= MAX_CONCURRENT_DOWNLOADS) await new Promise<void>((resolve) => this.waiting.push(resolve));
      else this.active++;
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
    const protectedCode = protectMarkdownCode(markdown, { maxFenceIndent: this.namespace === 'ghost' ? 3 : Number.POSITIVE_INFINITY });
    const sources = remoteImageSources(protectedCode.content);
    if (sources.length === 0) return markdown;
    const replacements = new Map<string, string>();
    for (let index = 0; index < sources.length; index += MAX_CONCURRENT_DOWNLOADS) {
      this.checkBudget();
      await Promise.all(
        sources.slice(index, index + MAX_CONCURRENT_DOWNLOADS).map(async (source) => {
          replacements.set(source, await this.migrate(source));
        }),
      );
    }
    const rewrittenMarkdown = replaceImportReferences(
      protectedCode.content,
      markdownReferences(protectedCode.content).filter((reference) => reference.image),
      (reference) => replacements.get(reference.value) ?? reference.value,
    );
    return protectedCode.restore(
      replaceImportReferences(
        rewrittenMarkdown,
        htmlImageReferences(rewrittenMarkdown),
        (reference) => replacements.get(reference.value) ?? reference.value,
      ),
    );
  }
}

/** Compatibility name for the Ghost importer; the implementation is shared
 * with Mintlify because both now take ownership of imported remote images. */
export class GhostAssetMigrator extends RemoteAssetMigrator {}
