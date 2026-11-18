import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { generateDashboardCatalogs } from '../../../packages/i18n/scripts/generate-dashboard-catalogs.mjs';

const catalogs = fileURLToPath(new URL('../../../packages/i18n/messages', import.meta.url));

const isCatalogFile = (file: string) => dirname(resolve(file)) === catalogs && extname(file) === '.json';

/** The documented dev flow and direct builds need no extra setup step. */
export function dashboardCatalogPlugin(): Plugin {
  return {
    name: 'nibleaf-dashboard-catalogs',
    async buildStart() {
      this.addWatchFile(catalogs);
      await generateDashboardCatalogs();
    },
    // Vite reports only edits through handleHotUpdate. A catalog that is created
    // or deleted arrives through the watcher.
    configureServer(server) {
      const regenerate = (file: string) => {
        if (!isCatalogFile(file)) return;
        generateDashboardCatalogs().catch((error: unknown) => server.config.logger.error(`Dashboard catalog generation failed: ${String(error)}`));
      };
      server.watcher.on('add', regenerate);
      server.watcher.on('unlink', regenerate);
    },
    async handleHotUpdate({ file }) {
      if (isCatalogFile(file)) await generateDashboardCatalogs();
    },
  };
}
