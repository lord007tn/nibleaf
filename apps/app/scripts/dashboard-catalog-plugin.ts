import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { generateDashboardCatalogs } from '../../../packages/i18n/scripts/generate-dashboard-catalogs.mjs';

const catalogs = fileURLToPath(new URL('../../../packages/i18n/messages', import.meta.url));

/** The documented dev flow and direct builds need no extra setup step. */
export function dashboardCatalogPlugin(): Plugin {
  return {
    name: 'nibleaf-dashboard-catalogs',
    async buildStart() {
      this.addWatchFile(catalogs);
      await generateDashboardCatalogs();
    },
    async handleHotUpdate({ file }) {
      if (dirname(resolve(file)) === catalogs && extname(file) === '.json') await generateDashboardCatalogs();
    },
  };
}
