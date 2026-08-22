import { describe, expect, it } from 'vitest';
import { nibleafPublicOpenApi } from './nibleaf-openapi';

describe('nibleafPublicOpenApi', () => {
  const document = nibleafPublicOpenApi('https://nibleaf.com');
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));

  it('publishes a stable OpenAPI 3.1 contract at the cloud origin', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('Nibleaf Public Reader API');
    expect(document.servers).toEqual([{ url: 'https://nibleaf.com', description: 'Nibleaf Cloud' }]);
    expect(document.paths).toHaveProperty('/openapi.json');
    expect(document.paths).toHaveProperty('/api/public/sites/{siteId}/page');
  });

  it('gives every operation a unique operationId, description, typed parameters, and response schemas', () => {
    const operationIds = operations.map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);

    for (const operation of operations) {
      expect(operation.operationId).toMatch(/^[a-z][A-Za-z0-9]+$/);
      expect(operation.description.length).toBeGreaterThan(20);
      for (const parameter of operation.parameters ?? []) {
        expect(parameter.description.length).toBeGreaterThan(10);
        expect(parameter.schema).toHaveProperty('type');
      }
      for (const response of Object.values(operation.responses) as Array<{ description: string; content?: Record<string, { schema: unknown }> }>) {
        expect(response.description.length).toBeGreaterThan(3);
        for (const representation of Object.values(response.content ?? {})) {
          expect(representation).toHaveProperty('schema');
        }
      }
    }
  });
});
