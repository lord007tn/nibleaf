import { describe, expect, it } from 'vitest';
import { scalarOpenApiConfiguration } from './openapi-reference';

describe('scalarOpenApiConfiguration', () => {
  it('uses the access-gated same-origin published spec endpoint', () => {
    expect(scalarOpenApiConfiguration('project/a').url).toBe('/api/public/sites/project%2Fa/openapi.json');
  });

  it('keeps try-it credentials browser-only and disables cloud agent upload', () => {
    const configuration = scalarOpenApiConfiguration('project');
    expect(configuration.persistAuth).toBe(false);
    expect(configuration.agent).toEqual({ disabled: true });
    expect(configuration).not.toHaveProperty('proxyUrl');
    expect(configuration).not.toHaveProperty('authentication');
  });

  it('keeps schemas, downloads, generated clients, and the interactive client visible', () => {
    const configuration = scalarOpenApiConfiguration('project');
    expect(configuration.hideModels).toBe(false);
    expect(configuration.hideDownloadButton).toBe(false);
    expect(configuration.hideClientButton).toBe(false);
  });
});
