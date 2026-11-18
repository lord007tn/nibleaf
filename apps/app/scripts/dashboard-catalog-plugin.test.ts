import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generation = vi.hoisted(() => ({ run: vi.fn<() => Promise<void>>() }));
vi.mock('../../../packages/i18n/scripts/generate-dashboard-catalogs.mjs', () => ({ generateDashboardCatalogs: generation.run }));

import { dashboardCatalogPlugin } from './dashboard-catalog-plugin';

const catalog = fileURLToPath(new URL('../../../packages/i18n/messages/ar.json', import.meta.url));

function startPlugin() {
  const watcher = new EventEmitter();
  const error = vi.fn();
  const server = { watcher, config: { logger: { error } } } as unknown as ViteDevServer;
  (dashboardCatalogPlugin().configureServer as (server: ViteDevServer) => void)(server);
  return { error, watcher };
}

beforeEach(() => {
  generation.run.mockReset();
  generation.run.mockResolvedValue(undefined);
});

describe('dashboard catalog plugin', () => {
  it.each(['add', 'unlink'])('regenerates after a catalog file %s event', (event) => {
    startPlugin().watcher.emit(event, catalog);
    expect(generation.run).toHaveBeenCalledOnce();
  });

  it('ignores other files', () => {
    const { watcher } = startPlugin();
    watcher.emit('add', fileURLToPath(new URL('../../../packages/i18n/messages/notes.txt', import.meta.url)));
    watcher.emit('unlink', fileURLToPath(new URL('../src/ar.json', import.meta.url)));
    expect(generation.run).not.toHaveBeenCalled();
  });

  it('reports a failed regeneration without stopping the dev server', async () => {
    generation.run.mockRejectedValue(new Error('fixture failure'));
    const { error, watcher } = startPlugin();
    watcher.emit('unlink', catalog);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('fixture failure')));
  });
});
