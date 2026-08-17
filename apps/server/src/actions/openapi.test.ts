import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetch: vi.fn(),
  close: vi.fn(async () => undefined),
  agentOptions: [] as Array<{ connect?: { lookup?: (...args: unknown[]) => void } }>,
}));

vi.mock('@nibleaf/database', () => ({ prisma: {} }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('undici', () => ({
  Agent: class MockAgent {
    constructor(options: { connect?: { lookup?: (...args: unknown[]) => void } }) {
      network.agentOptions.push(options);
    }

    close = network.close;
  },
  fetch: network.fetch,
}));

import { AppError } from '@/errors';
import { fetchPublicOpenApi, MAX_OPENAPI_BYTES, parseAndValidateOpenApi, publicOpenApiMetadata, readBoundedOpenApiResponse } from './openapi';

const valid = `
openapi: 3.1.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets:
    get:
      responses:
        '200':
          description: OK
components:
  schemas:
    Pet:
      type: object
      properties:
        name: { type: string }
`;

beforeEach(() => {
  vi.clearAllMocks();
  network.agentOptions.length = 0;
  network.lookup.mockImplementation(async (hostname: string) => [{ address: hostname === '127.0.0.1' ? '127.0.0.1' : '203.0.113.10', family: 4 }]);
  network.fetch.mockResolvedValue(new Response(valid));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseAndValidateOpenApi', () => {
  it('parses and validates an OpenAPI 3.x YAML document', async () => {
    const document = await parseAndValidateOpenApi(valid);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty('/pets');
  });

  it('returns actionable parser and standards validation errors', async () => {
    await expect(parseAndValidateOpenApi('openapi: 3.1.0\ninfo: [broken')).rejects.toMatchObject({
      message: 'The OpenAPI document is not valid JSON or YAML.',
    });
    await expect(parseAndValidateOpenApi('openapi: 3.1.0\ninfo: {}\npaths: {}')).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && Array.isArray(error.details?.errors),
    );
  });

  it('rejects Swagger 2 and external references before publication', async () => {
    await expect(parseAndValidateOpenApi('{"swagger":"2.0","info":{"title":"Old","version":"1"},"paths":{}}')).rejects.toThrow(
      'Only OpenAPI 3.x documents are supported.',
    );
    await expect(parseAndValidateOpenApi(valid.replace('type: object', '$ref: https://internal.example/schema.json'))).rejects.toThrow(
      'External $ref values are not supported.',
    );
  });

  it('rejects alias expansion bombs and oversized chunked responses', async () => {
    const aliases = `openapi: 3.1.0\ninfo: &info { title: Pets, version: 1 }\npaths:\n${Array.from({ length: 22 }, (_, index) => `  /p${index}: *info`).join('\n')}`;
    await expect(parseAndValidateOpenApi(aliases)).rejects.toThrow('unsafe or excessively complex YAML aliases');
    await expect(readBoundedOpenApiResponse(new Response(new Uint8Array(MAX_OPENAPI_BYTES + 1)))).rejects.toThrow('larger than 5 MB');
  });

  it('never includes editable source details in published metadata', () => {
    expect(
      publicOpenApiMetadata({
        title: 'API',
        path: 'api-reference',
        contentHash: 'abc',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }),
    ).toEqual({ title: 'API', path: 'api-reference', contentHash: 'abc', updatedAt: '2026-08-16T00:00:00.000Z' });
  });

  it('rejects credential-bearing and private-network source URLs before fetch', async () => {
    await expect(fetchPublicOpenApi('https://token@example.com/openapi.json')).rejects.toThrow('must not include embedded credentials');
    await expect(fetchPublicOpenApi('http://127.0.0.1/openapi.json')).rejects.toThrow('must resolve only to public IP addresses');
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it('pins each redirect connection to the address validated for that hostname', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    network.lookup.mockImplementation(async (hostname: string) => [
      { address: hostname === 'first.example' ? '203.0.113.11' : '198.51.100.22', family: 4 },
    ]);
    network.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://second.example/openapi.json' } }))
      .mockResolvedValueOnce(new Response(valid));

    await expect(fetchPublicOpenApi('https://first.example/openapi.json')).resolves.toContain('openapi: 3.1.0');

    expect(network.lookup.mock.calls.map(([hostname]) => hostname)).toEqual(['first.example', 'second.example']);
    expect(network.fetch).toHaveBeenCalledTimes(2);
    expect((network.fetch.mock.calls[0]?.[0] as URL).hostname).toBe('first.example');
    expect((network.fetch.mock.calls[1]?.[0] as URL).hostname).toBe('second.example');
    expect(network.fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', dispatcher: expect.anything(), signal: expect.any(AbortSignal) });
    expect(timeout).toHaveBeenNthCalledWith(1, 10_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 10_000);
    expect(network.fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Host');

    const pinned = await Promise.all(
      network.agentOptions.map(
        (options) =>
          new Promise<{ address: string; family: number }>((resolve, reject) => {
            options.connect?.lookup?.('rebinding.example', {}, (error: Error | null, address: string, family: number) => {
              if (error) reject(error);
              else resolve({ address, family });
            });
          }),
      ),
    );
    expect(pinned).toEqual([
      { address: '203.0.113.11', family: 4 },
      { address: '198.51.100.22', family: 4 },
    ]);
    expect(network.close).toHaveBeenCalledTimes(2);
  });

  it('retains redirect and declared-size bounds while closing pinned dispatchers', async () => {
    network.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: '/next' } }));
    await expect(fetchPublicOpenApi('https://public.example/openapi.json')).rejects.toThrow('redirected too many times');
    expect(network.fetch).toHaveBeenCalledTimes(4);
    expect(network.close).toHaveBeenCalledTimes(4);

    vi.clearAllMocks();
    network.agentOptions.length = 0;
    network.lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    network.fetch.mockResolvedValue(new Response(null, { headers: { 'content-length': String(MAX_OPENAPI_BYTES + 1) } }));
    await expect(fetchPublicOpenApi('https://public.example/openapi.json')).rejects.toThrow('larger than 5 MB');
    expect(network.close).toHaveBeenCalledOnce();
  });
});
