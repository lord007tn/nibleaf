import { THEME_TEMPLATE_KIND } from '@nibleaf/shared/themes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findFirst: vi.fn(),
  transaction: vi.fn(),
  txFindFirst: vi.fn(),
  updateManyAndReturn: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findFirst: database.findFirst },
    $transaction: database.transaction,
  },
}));

import type { AppError } from '@/errors';
import { exportProjectTheme, getProjectThemeCatalog, importProjectTheme } from './themes';

const project = {
  id: 'project-1',
  organizationId: 'org-1',
  config: {
    seo: { metaTitle: 'Keep' },
    styling: { theme: 'dark', primaryColor: '#5546e8' },
    theme: { preset: 'harbor' },
  },
};
const updatedAt = new Date('2026-08-24T08:00:00.000Z');
const signalTemplate = {
  kind: THEME_TEMPLATE_KIND,
  version: 1 as const,
  metadata: { name: 'Signal custom', description: 'A test theme' },
  config: { theme: { preset: 'signal' as const }, styling: { theme: 'light' as const } },
};

describe('theme template actions', () => {
  beforeEach(() => {
    database.findFirst.mockReset();
    database.transaction.mockReset();
    database.txFindFirst.mockReset();
    database.updateManyAndReturn.mockReset();
    database.findFirst.mockResolvedValue(project);
    database.txFindFirst.mockResolvedValue({ config: project.config, updatedAt });
    database.updateManyAndReturn.mockResolvedValue([{ id: project.id, config: project.config, updatedAt }]);
    database.transaction.mockImplementation((run) =>
      run({ project: { findFirst: database.txFindFirst, updateManyAndReturn: database.updateManyAndReturn } }),
    );
  });

  it('exports deterministic v1 JSON from an existing project', async () => {
    const first = await exportProjectTheme('org-1', 'project-1');
    const second = await exportProjectTheme('org-1', 'project-1');
    expect(first).toEqual(second);
    expect(first.template).toMatchObject({ kind: THEME_TEMPLATE_KIND, version: 1, config: { theme: { preset: 'harbor' } } });
    expect(first.json.endsWith('\n')).toBe(true);
  });

  it('returns a sanitized, versioned capability catalog without project content or repository internals', async () => {
    const catalog = await getProjectThemeCatalog('org-1', 'project-1');

    expect(catalog).toMatchObject({
      schemaVersion: 1,
      repositorySchemaVersion: 1,
      runtimeContractVersion: 1,
      componentSchemaVersion: 1,
      current: { id: 'harbor' },
    });
    expect(catalog.presets.map((preset) => preset.id)).toEqual(['harbor', 'manuscript', 'signal']);
    expect(catalog.presets[0]?.messageKeys).toEqual({
      name: 'settings.theme.preset.harbor.name',
      description: 'settings.theme.preset.harbor.description',
      rationale: 'settings.theme.preset.harbor.rationale',
    });
    expect(catalog.presets[0]).not.toHaveProperty('metadata');
    expect(catalog.authoring.map((component) => component.id)).toEqual(expect.arrayContaining(['file-tree', 'api-example', 'related-content']));
    expect(JSON.stringify(catalog)).not.toMatch(/"(?:snapshot|manifest|filesystem|repositoryPath|content)"\s*:/i);
  });

  it('previews without persistence and applies all theme sections atomically after confirmation', async () => {
    const preview = await importProjectTheme('org-1', 'project-1', { template: signalTemplate, mode: 'replace', apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(database.transaction).not.toHaveBeenCalled();

    const applied = await importProjectTheme('org-1', 'project-1', { template: signalTemplate, mode: 'replace', apply: true });
    expect(applied.publishedChangesPending).toBe(true);
    expect(database.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1', organizationId: 'org-1', updatedAt },
        data: { config: expect.objectContaining({ seo: { metaTitle: 'Keep' }, theme: expect.objectContaining({ preset: 'signal' }) }) },
      }),
    );
  });

  it('recomputes from the fresh revision after contention and preserves malformed or unknown sibling JSON', async () => {
    const first = { config: project.config, updatedAt };
    const freshUpdatedAt = new Date('2026-08-24T08:00:01.000Z');
    const fresh = {
      config: {
        ...project.config,
        styling: 'malformed-owned-section',
        search: { maxResults: 24 },
        addons: { feedback: true },
        futureSection: { nested: ['preserve', 7] },
      },
      updatedAt: freshUpdatedAt,
    };
    database.txFindFirst.mockResolvedValueOnce(first).mockResolvedValueOnce(fresh);
    database.updateManyAndReturn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: project.id, config: fresh.config, updatedAt: new Date('2026-08-24T08:00:02.000Z') }]);

    const applied = await importProjectTheme('org-1', 'project-1', { template: signalTemplate, mode: 'replace', apply: true });

    expect(applied.theme.id).toBe('signal');
    expect(database.updateManyAndReturn).toHaveBeenCalledTimes(2);
    expect(database.updateManyAndReturn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'project-1', organizationId: 'org-1', updatedAt: freshUpdatedAt },
        data: {
          config: expect.objectContaining({
            search: { maxResults: 24 },
            addons: { feedback: true },
            futureSection: { nested: ['preserve', 7] },
            theme: expect.objectContaining({ preset: 'signal' }),
            styling: { theme: 'light' },
          }),
        },
      }),
    );
  });

  it('returns an opaque not-found for a tenant mismatch', async () => {
    database.txFindFirst.mockResolvedValue(null);

    await expect(importProjectTheme('other-org', 'project-1', { template: signalTemplate, mode: 'replace', apply: true })).rejects.toMatchObject({
      code: 'database:not_found',
      entityType: 'project',
      status: 404,
    });
    expect(database.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns a conflict after all four current-revision CAS attempts lose contention', async () => {
    database.updateManyAndReturn.mockResolvedValue([]);

    await expect(importProjectTheme('org-1', 'project-1', { template: signalTemplate, mode: 'merge', apply: true })).rejects.toMatchObject({
      code: 'database:conflict',
      status: 409,
    });
    expect(database.txFindFirst).toHaveBeenCalledTimes(4);
    expect(database.updateManyAndReturn).toHaveBeenCalledTimes(4);
  });

  it('returns an actionable application error for unsafe input', async () => {
    const unsafe = JSON.parse('{"kind":"nibleaf-theme","version":1,"__proto__":{"polluted":true}}');
    await expect(importProjectTheme('org-1', 'project-1', { template: unsafe, mode: 'merge', apply: false })).rejects.toMatchObject({
      name: 'AppError',
      status: 400,
    } satisfies Partial<AppError>);
    expect(database.findFirst).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
