import { describe, expect, it } from 'vitest';
import { SCALAR_THEME, scalarOpenApiConfiguration } from './openapi-reference';

describe('scalarOpenApiConfiguration', () => {
  it('uses the access-gated same-origin published spec endpoint', () => {
    expect(scalarOpenApiConfiguration('project/a').url).toBe('/api/public/sites/project%2Fa/openapi.json');
  });

  it('keeps try-it credentials browser-only and disables every Scalar cloud upload surface', () => {
    const configuration = scalarOpenApiConfiguration('project');
    expect(configuration.persistAuth).toBe(false);
    expect(configuration.telemetry).toBe(false);
    expect(configuration.agent).toEqual({ disabled: true });
    expect(configuration.mcp).toEqual({ disabled: true });
    expect(configuration.showDeveloperTools).toBe('never');
    expect(configuration).not.toHaveProperty('proxyUrl');
    expect(configuration).not.toHaveProperty('authentication');
  });

  it('maps Scalar interactive controls to accessible site-theme foreground and background tokens', () => {
    expect(SCALAR_THEME).toContain('--scalar-link-color: var(--foreground)');
    expect(SCALAR_THEME).toContain('--scalar-sidebar-background-1: var(--background)');
    expect(SCALAR_THEME).toContain('--scalar-sidebar-color-1: var(--foreground)');
    expect(SCALAR_THEME).toContain('--scalar-sidebar-color-2: var(--muted-foreground)');
    expect(SCALAR_THEME).toContain('--scalar-sidebar-search-color: var(--foreground)');
    expect(SCALAR_THEME).toContain('--scalar-button-1-color: var(--background)');
  });

  it('keeps schemas, downloads, generated clients, and the interactive client visible', () => {
    const configuration = scalarOpenApiConfiguration('project');
    expect(configuration.hideModels).toBe(false);
    expect(configuration.hideDownloadButton).toBe(false);
    expect(configuration.hideClientButton).toBe(false);
  });
});
