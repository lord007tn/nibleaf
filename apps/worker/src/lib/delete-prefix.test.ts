import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { deletePrefix, type StorageTarget } from '@nibleaf/storage';

const SENSITIVE_KEY = 'projects/project-a/assets/passport-scan.png';

const stub = { pages: [] as string[][], failedKeys: new Set<string>(), deletedKeys: [] as string[], errorCode: 'AccessDenied' };

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const listResponse = (url: URL): string => {
  const index = Number(url.searchParams.get('continuation-token') ?? 0);
  const keys = stub.pages[index] ?? [];
  const next = index + 1 < stub.pages.length ? `<NextContinuationToken>${index + 1}</NextContinuationToken>` : '';
  const contents = keys.map((key) => `<Contents><Key>${key}</Key></Contents>`).join('');
  return `<ListBucketResult><KeyCount>${keys.length}</KeyCount><IsTruncated>${next !== ''}</IsTruncated>${next}${contents}</ListBucketResult>`;
};

const deleteResponse = (body: string): string => {
  const keys = [...body.matchAll(/<Key>([^<]*)<\/Key>/g)].flatMap((match) => (match[1] ? [match[1]] : []));
  const failed = keys.filter((key) => stub.failedKeys.has(key));
  stub.deletedKeys.push(...keys.filter((key) => !stub.failedKeys.has(key)));
  const errors = failed.map((key) => `<Error><Key>${key}</Key><Code>${stub.errorCode}</Code><Message>denied ${key}</Message></Error>`).join('');
  return `<DeleteResult>${errors}</DeleteResult>`;
};

const respond = async (request: IncomingMessage): Promise<string> => {
  const url = new URL(request.url ?? '/', 'http://storage.test');
  return request.method === 'POST' ? deleteResponse(await readBody(request)) : listResponse(url);
};

/** `packages/storage` has no test runner of its own. This drives the real S3
 * client against a local stub, so it also proves how the SDK surfaces per-object
 * failures from an HTTP 200 `DeleteObjects` response. */
describe('deletePrefix', () => {
  let server: Server;
  let target: StorageTarget;

  beforeAll(async () => {
    server = createServer((request, response) => {
      void respond(request).then((body) => {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(body);
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    target = {
      accessKeyId: 'synthetic-access',
      bucket: 'synthetic',
      endpoint: `http://127.0.0.1:${port}`,
      forcePathStyle: true,
      region: 'us-east-1',
      secretAccessKey: 'synthetic-secret',
    };
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  beforeEach(() => {
    stub.pages = [];
    stub.failedKeys = new Set();
    stub.deletedKeys = [];
    stub.errorCode = 'AccessDenied';
  });

  it('counts every object when all deletions succeed, across listing pages', async () => {
    stub.pages = [['projects/project-a/assets/a.png', 'projects/project-a/assets/b.png'], ['projects/project-a/exports/run/c.zip']];
    await expect(deletePrefix('projects/project-a/', target)).resolves.toBe(3);
    expect(stub.deletedKeys).toHaveLength(3);
  });

  it('returns zero for an empty prefix', async () => {
    stub.pages = [[]];
    await expect(deletePrefix('projects/project-a/', target)).resolves.toBe(0);
  });

  it('keeps deleting after a partial failure, then rejects with counts and an error code but no key', async () => {
    stub.pages = [[SENSITIVE_KEY, 'projects/project-a/assets/a.png'], ['projects/project-a/assets/b.png']];
    stub.failedKeys = new Set([SENSITIVE_KEY]);

    const error = await deletePrefix('projects/project-a/', target).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'StorageDeleteError', failedCount: 1, deletedCount: 2, firstErrorCode: 'AccessDenied' });
    expect(stub.deletedKeys).toEqual(['projects/project-a/assets/a.png', 'projects/project-a/assets/b.png']);
    expect(String(error)).not.toContain('passport-scan');
    expect(JSON.stringify(error)).not.toContain('passport-scan');
  });

  it('replaces an error code that is not a short identifier', async () => {
    stub.pages = [[SENSITIVE_KEY]];
    stub.failedKeys = new Set([SENSITIVE_KEY]);
    stub.errorCode = SENSITIVE_KEY;

    const error = await deletePrefix('projects/project-a/', target).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ name: 'StorageDeleteError', firstErrorCode: 'unknown' });
    expect(String(error)).not.toContain('passport-scan');
  });
});
