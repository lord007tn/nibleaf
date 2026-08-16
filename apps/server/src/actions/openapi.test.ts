import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {} }));

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
  });
});
