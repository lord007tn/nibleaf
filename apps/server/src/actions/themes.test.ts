import { THEME_TEMPLATE_KIND } from '@nibleaf/shared/themes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  prisma: { project: { findFirst: database.findFirst, update: database.update } },
}));

import type { AppError } from '@/errors';
import { exportProjectTheme, importProjectTheme } from './themes';

const project = {
  id: 'project-1',
  organizationId: 'org-1',
  config: { seo: { metaTitle: 'Keep' }, styling: { theme: 'dark', primaryColor: '#5546e8' }, theme: { preset: 'harbor' } },
};

describe('theme template actions', () => {
  beforeEach(() => {
    database.findFirst.mockReset();
    database.update.mockReset();
    database.findFirst.mockResolvedValue(project);
    database.update.mockResolvedValue(project);
  });

  it('exports deterministic v1 JSON from an existing project', async () => {
    const first = await exportProjectTheme('org-1', 'project-1');
    const second = await exportProjectTheme('org-1', 'project-1');
    expect(first).toEqual(second);
    expect(first.template).toMatchObject({ kind: THEME_TEMPLATE_KIND, version: 1, config: { theme: { preset: 'harbor' } } });
    expect(first.json.endsWith('\n')).toBe(true);
  });

  it('previews without persistence and applies only after confirmation', async () => {
    const template = {
      kind: THEME_TEMPLATE_KIND,
      version: 1 as const,
      metadata: { name: 'Signal custom', description: 'A test theme' },
      config: { theme: { preset: 'signal' as const }, styling: { theme: 'light' as const } },
    };
    const preview = await importProjectTheme('org-1', 'project-1', { template, mode: 'replace', apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.changes.length).toBeGreaterThan(0);
    expect(database.update).not.toHaveBeenCalled();

    const applied = await importProjectTheme('org-1', 'project-1', { template, mode: 'replace', apply: true });
    expect(applied.publishedChangesPending).toBe(true);
    expect(database.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { config: expect.objectContaining({ seo: { metaTitle: 'Keep' }, theme: expect.objectContaining({ preset: 'signal' }) }) },
      }),
    );
  });

  it('returns an actionable application error for unsafe input', async () => {
    const unsafe = JSON.parse('{"kind":"nibleaf-theme","version":1,"__proto__":{"polluted":true}}');
    await expect(importProjectTheme('org-1', 'project-1', { template: unsafe, mode: 'merge', apply: false })).rejects.toMatchObject({
      name: 'AppError',
      status: 400,
    } satisfies Partial<AppError>);
    expect(database.findFirst).not.toHaveBeenCalled();
  });
});
