import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Opt-in Rollup module attribution for production bundle investigations.
 * The report stays outside `.output/public`, so absolute source paths are never
 * deployed. Enable it with `BUNDLE_ANALYZE=true pnpm build:app`. */
export function bundleAnalysisPlugin(): Plugin {
  return {
    name: 'nibleaf-bundle-analysis',
    apply: 'build',
    generateBundle(outputOptions, bundle) {
      if (process.env.BUNDLE_ANALYZE !== 'true' || !outputOptions.dir?.replaceAll('\\', '/').endsWith('/.output/public')) return;

      const chunks = Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .map((chunk) => ({
          fileName: chunk.fileName,
          facadeModuleId: chunk.facadeModuleId,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules)
            .map(([id, details]) => ({ id, renderedLength: details.renderedLength }))
            .sort((a, b) => b.renderedLength - a.renderedLength),
        }));

      const analysisDir = resolve(process.cwd(), '.bundle-analysis');
      mkdirSync(analysisDir, { recursive: true });
      writeFileSync(resolve(analysisDir, 'client-modules.json'), `${JSON.stringify({ chunks }, null, 2)}\n`);
    },
  };
}
