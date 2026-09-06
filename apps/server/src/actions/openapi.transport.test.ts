import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import got from 'got';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));
// Only the synthetic loopback fixture bypasses public-IP classification. Got,
// its socket/DNS callback, redirects, response events and body streams are real.
vi.mock('@/lib/client-ip', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/client-ip')>();
  return { ...original, isPrivateIp: (ip: string) => (ip === '127.0.0.1' ? false : original.isPrivateIp(ip)) };
});

import { fetchPublicOpenApi, MAX_OPENAPI_BYTES } from './openapi';

let server: Server;
let base: string;
const hits: Array<{ path: string; host: string | undefined }> = [];

beforeEach(async () => {
  vi.clearAllMocks();
  hits.length = 0;
  network.lookup.mockImplementation(async (hostname: string) => [{ address: hostname === 'private.invalid' ? '10.0.0.1' : '127.0.0.1', family: 4 }]);
  server = createServer((request, response) => {
    hits.push({ path: request.url ?? '', host: request.headers.host });
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `${base.replace('fixture.invalid', 'next.invalid')}/spec` });
      response.end();
    } else if (request.url === '/private') {
      response.writeHead(302, { location: `${base.replace('fixture.invalid', 'private.invalid')}/spec` });
      response.end();
    } else if (request.url === '/chunked-oversize') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write(Buffer.alloc(1024));
      response.end(Buffer.alloc(MAX_OPENAPI_BYTES));
    } else if (request.url === '/announced-oversize') {
      response.writeHead(200, { 'content-length': MAX_OPENAPI_BYTES + 1 });
      response.flushHeaders();
    } else if (request.url === '/slow') {
      // Deliberately keep the socket pending for the real request timeout.
    } else if (request.url === '/unavailable') {
      response.writeHead(503);
      response.end('unavailable');
    } else if (request.url === '/json') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            method: request.method,
            body: JSON.parse(Buffer.concat(chunks).toString()),
            authorization: request.headers.authorization,
          }),
        );
      });
    } else {
      response.setHeader('content-type', 'application/yaml');
      response.write('openapi: 3.1.0\n');
      response.end('info: {title: Synthetic, version: "1"}\npaths: {}\n');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://fixture.invalid:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('OpenAPI over the actual Got transport', () => {
  it('streams a spec through the validated DNS pin and preserves the original Host', async () => {
    const result = await fetchPublicOpenApi(`${base}/spec`);
    expect(result).toContain('openapi: 3.1.0');
    expect(hits).toEqual([{ path: '/spec', host: new URL(base).host }]);
    expect(network.lookup).toHaveBeenCalledExactlyOnceWith('fixture.invalid', { all: true, verbatim: true });
  });

  it('returns redirects to application validation before connecting to the next host', async () => {
    expect(await fetchPublicOpenApi(`${base}/redirect`)).toContain('Synthetic');
    expect(network.lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['fixture.invalid', 'next.invalid']);
    expect(hits.map(({ host }) => host)).toEqual([new URL(base).host, new URL(base.replace('fixture.invalid', 'next.invalid')).host]);
  });

  it('rejects a redirect to a private address before any second HTTP request', async () => {
    await expect(fetchPublicOpenApi(`${base}/private`)).rejects.toThrow('must resolve only to public IP addresses');
    expect(hits).toHaveLength(1);
  });

  it.each(['/chunked-oversize', '/announced-oversize'])('bounds a real response body at %s', async (path) => {
    await expect(fetchPublicOpenApi(`${base}${path}`)).rejects.toThrow('larger than 5 MB');
    expect(hits).toHaveLength(1);
  });

  it('does not retry a failing HTTP response', async () => {
    await expect(fetchPublicOpenApi(`${base}/unavailable`)).rejects.toThrow('returned HTTP 503');
    expect(hits).toHaveLength(1);
  });

  it('applies the actual application request timeout without retrying', async () => {
    await expect(fetchPublicOpenApi(`${base}/slow`)).rejects.toThrow('publicly reachable');
    expect(hits).toHaveLength(1);
  }, 15_000);
});

describe('Got buffered API option compatibility', () => {
  const local = () => base.replace('fixture.invalid', '127.0.0.1');

  it('preserves JSON requests, explicit authorization, parsed bodies and response.ok', async () => {
    const response = await got(`${local()}/json`, {
      method: 'POST',
      json: { synthetic: true },
      responseType: 'json',
      headers: { authorization: 'Bearer synthetic-test' },
      retry: { limit: 0 },
      throwHttpErrors: false,
      timeout: { request: 1000 },
    });
    expect(response.ok).toBe(true);
    expect(response.body).toEqual({ method: 'POST', body: { synthetic: true }, authorization: 'Bearer synthetic-test' });
  });

  it('returns a raw terminal redirect when redirect following is disabled', async () => {
    const response = await got(`${local()}/redirect`, { followRedirect: false, retry: { limit: 0 }, throwHttpErrors: false });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('next.invalid');
    expect(response.rawBody).toBeInstanceOf(Uint8Array);
    expect(hits).toHaveLength(1);
  });

  it('honors cancellation of a pending buffered request', async () => {
    const controller = new AbortController();
    const pending = got(`${local()}/slow`, { signal: controller.signal, retry: { limit: 0 } });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await once(server, 'request');
    controller.abort();
    await rejected;
    expect(hits).toHaveLength(1);
  });
});
