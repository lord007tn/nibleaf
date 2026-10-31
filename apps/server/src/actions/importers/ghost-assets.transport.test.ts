import type { IncomingMessage } from 'node:http';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ lookup: vi.fn(), stream: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('got', () => ({ default: { stream: network.stream } }));
vi.mock('../assets', () => ({ findImportedAsset: vi.fn(), storeAsset: vi.fn() }));

import { findImportedAsset, storeAsset } from '../assets';
import { RemoteAssetMigrator } from './ghost-assets';

type Options = { dnsLookup: LookupFunction; followRedirect: boolean; timeout: { request: number } };
type Fixture = { status?: number; headers?: Record<string, string>; body?: () => AsyncIterable<Buffer> };
const source = 'https://images.example/image.png';
const markdown = `![Image](${source})`;
const limit = 50 * 1024 * 1024;
const { default: realGot } = await vi.importActual<typeof import('got')>('got');
let requests: Array<ReturnType<typeof realGot.stream>>;
let produced: number;

function respond(fixtures: Fixture[]) {
  network.stream.mockImplementation((url: URL, options: Options) => {
    expect(options.followRedirect).toBe(false);
    expect(options.timeout.request).toBe(20_000);
    const fixture = fixtures.shift() ?? {};
    const request = realGot.stream(url, {
      ...options,
      retry: { limit: 0 },
      throwHttpErrors: false,
      request: async (_url, nativeOptions) => {
        await new Promise<void>((resolve, reject) => {
          const connectionLookup = nativeOptions.lookup as LookupFunction;
          connectionLookup(url.hostname, { all: true }, (error) => (error ? reject(error) : resolve()));
        });
        const response = Object.assign(Readable.from(fixture.body?.() ?? [Buffer.from('image')], { objectMode: false }), {
          statusCode: fixture.status ?? 200,
          statusMessage: 'OK',
          complete: false,
          headers: { 'content-type': 'image/png', ...fixture.headers },
          rawHeaders: [],
          url: url.toString(),
        }) as unknown as IncomingMessage;
        response.once('end', () => {
          response.complete = true;
        });
        return response;
      },
    });
    requests.push(request);
    return request;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  requests = [];
  produced = 0;
  network.lookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
  vi.mocked(findImportedAsset).mockResolvedValue(null);
  vi.mocked(storeAsset).mockResolvedValue({ url: '/stored.png' } as never);
});

describe('remote image transport', () => {
  it('stores a public image and reuses it within one import', async () => {
    respond([{}]);
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe('![Image](/stored.png)');
    await migrator.rewrite(markdown);
    expect(storeAsset).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from('image'), contentType: 'image/png' }));
    expect(network.lookup).toHaveBeenCalledTimes(1);
    expect(migrator.migrated).toBe(1);
  });

  it('checks each download independently', async () => {
    respond([{}, {}]);
    await new RemoteAssetMigrator('synthetic').rewrite(markdown);
    network.lookup.mockResolvedValueOnce([
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe(markdown);
    expect(storeAsset).toHaveBeenCalledTimes(1);
    expect(migrator.failures).toEqual(new Set(['image migration failed']));
    expect(requests.every((request) => request.destroyed)).toBe(true);
  });

  it('validates a redirect hostname at its connection', async () => {
    respond([{ status: 302, headers: { location: 'https://redirect.example/image.png' } }, {}]);
    network.lookup.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]).mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }]);
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe(markdown);
    expect(network.lookup).toHaveBeenCalledTimes(2);
    expect(storeAsset).not.toHaveBeenCalled();
    expect(migrator.skipped).toBe(1);
  });

  it.each([
    'http://127.0.0.1/image.png',
    'http://[::ffff:7f00:1]/image.png',
    'ftp://images.example/image.png',
    'https://user:pass@images.example/image.png',
  ])('refuses a redirect to %s before requesting it', async (location) => {
    respond([{ status: 302, headers: { location } }]);
    expect(await new RemoteAssetMigrator('synthetic').rewrite(markdown)).toBe(markdown);
    expect(network.stream).toHaveBeenCalledTimes(1);
    expect(storeAsset).not.toHaveBeenCalled();
  });

  it('keeps image downloads on their own connections', async () => {
    respond([{}]);
    await new RemoteAssetMigrator('synthetic').rewrite(markdown);
    const options = network.stream.mock.calls[0]?.[1];
    expect(options.agent.http.keepAlive).toBe(false);
    expect(options.agent.https.keepAlive).toBe(false);
  });

  it.each(['http://127.0.0.1/image.png', 'http://[::ffff:7f00:1]/image.png', 'http://[::a00:1]/image.png'])(
    'validates literal address %s before requesting',
    async (url) => {
      const input = `![Image](${url})`;
      expect(await new RemoteAssetMigrator('synthetic').rewrite(input)).toBe(input);
      expect(network.stream).not.toHaveBeenCalled();
    },
  );

  it('stops an oversized chunked stream before consuming the rest', async () => {
    respond([
      {
        async *body() {
          for (let i = 0; i < 100; i++) {
            produced++;
            yield Buffer.alloc(1024 * 1024);
          }
        },
      },
    ]);
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe(markdown);
    expect(produced).toBeLessThan(100);
    expect(storeAsset).not.toHaveBeenCalled();
    expect(requests[0]?.destroyed).toBe(true);
  });

  it('handles compressed responses over the size limit', async () => {
    const compressed = gzipSync(Buffer.alloc(limit + 1));
    expect(compressed.length).toBeLessThan(limit);
    // Exercise Got's decoder with a compressed response and no network.
    respond([
      {
        headers: { 'content-encoding': 'gzip', 'content-length': String(compressed.length) },
        async *body() {
          yield compressed;
        },
      },
    ]);
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe(markdown);
    expect(storeAsset).not.toHaveBeenCalled();
    expect(requests[0]?.destroyed).toBe(true);
  });

  it('stores decoded bytes from a normal compressed public image', async () => {
    const compressed = gzipSync(Buffer.from('image'));
    respond([
      {
        headers: { 'content-encoding': 'gzip' },
        async *body() {
          yield compressed;
        },
      },
    ]);
    expect(await new RemoteAssetMigrator('synthetic').rewrite(markdown)).toBe('![Image](/stored.png)');
    expect(storeAsset).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from('image') }));
  });

  it('keeps transport details out of warnings', async () => {
    respond([{}]);
    network.lookup.mockRejectedValueOnce(new Error('synthetic connection detail'));
    const migrator = new RemoteAssetMigrator('synthetic');
    expect(await migrator.rewrite(markdown)).toBe(markdown);
    expect([...migrator.failures]).toEqual(['image migration failed']);
  });

  it('bounds concurrent downloads across rewrites', async () => {
    respond(
      Array.from({ length: 12 }, () => ({
        async *body() {
          expect(requests.filter((request) => !request.destroyed).length).toBeLessThanOrEqual(4);
          await new Promise((resolve) => setTimeout(resolve, 1));
          yield Buffer.from('image');
        },
      })),
    );
    const migrator = new RemoteAssetMigrator('synthetic');
    await Promise.all(Array.from({ length: 12 }, (_, i) => migrator.rewrite(`![Image](https://images.example/${i}.png)`)));
    expect(migrator.migrated).toBe(12);
  });
});
