// @vitest-environment jsdom
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isBuildRetired } from './build-retired';

// Real requests to a server that answers as production does for /assets: a file
// from the current build, the 404 of a replaced build's file, and a refused connection.
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.statusCode = request.url === '/assets/current.js' ? 200 : request.url === '/assets/removed.js' ? 410 : 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
afterEach(() => {
  vi.restoreAllMocks();
  document.head.replaceChildren();
});

const importFailure = (asset: string) => new TypeError(`Failed to fetch dynamically imported module: ${origin}${asset}`);

describe('whether a failed load came from a replaced build', () => {
  it('is yes when the server no longer has the requested asset', async () => {
    await expect(isBuildRetired(importFailure('/assets/ar-OLD.js'))).resolves.toBe(true);
    await expect(isBuildRetired(importFailure('/assets/removed.js'))).resolves.toBe(true);
  });

  it('reads the asset from an error wrapped by the catalog loader', async () => {
    await expect(isBuildRetired(new Error('catalog failed', { cause: importFailure('/assets/ar-OLD.js') }))).resolves.toBe(true);
  });

  it('is no when the asset still exists, so the same request can be repeated', async () => {
    await expect(isBuildRetired(importFailure('/assets/current.js'))).resolves.toBe(false);
  });

  it('falls back to the entry script for browsers that do not name the failed file', async () => {
    const entry = document.createElement('script');
    entry.type = 'module';
    entry.setAttribute('src', `${origin}/assets/index-OLD.js`);
    // Not executed: jsdom runs no external scripts by default.
    document.head.append(entry);
    await expect(isBuildRetired(new TypeError('Importing a module script failed.'))).resolves.toBe(true);
    entry.setAttribute('src', `${origin}/assets/current.js`);
    await expect(isBuildRetired(new TypeError('Importing a module script failed.'))).resolves.toBe(false);
  });

  it('is no when the server cannot be reached', async () => {
    await expect(isBuildRetired(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1:1/assets/ar.js'))).resolves.toBe(false);
  });

  it('asks nothing while offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const request = vi.spyOn(globalThis, 'fetch');
    await expect(isBuildRetired(importFailure('/assets/ar-OLD.js'))).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
